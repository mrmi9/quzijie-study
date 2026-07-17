import { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import {
  publicQuestion,
  sameAnswer,
  shuffle,
  validateSelection,
  type QuestionSnapshot
} from "../domain/questions.js";
import type { ExamService } from "./exam.js";
import { GamificationService, unlockedKeys } from "./gamification.js";
import { normalizeFillAnswer, sameFillAnswer } from "../domain/question-bank.js";
import type { CatalogService } from "./catalog.js";

const MODE_TO_DATABASE = {
  chapter: "CHAPTER",
  random: "RANDOM",
  wrong: "WRONG",
  favorite: "FAVORITE"
} as const;

type PublicMode = keyof typeof MODE_TO_DATABASE;

function modeFromDatabase(mode: string): PublicMode {
  return mode.toLowerCase() as PublicMode;
}

function statusFromDatabase(status: string): "active" | "completed" | "abandoned" {
  return status.toLowerCase() as "active" | "completed" | "abandoned";
}

function jsonStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function jsonNestedStrings(value: Prisma.JsonValue): string[][] {
  return Array.isArray(value)
    ? value.map((item) => Array.isArray(item) ? item.map(String) : [String(item)])
    : [];
}

function answerResult(answer: {
  questionId: string;
  answerType: string;
  textAnswer: string | null;
  selfAssessment: string | null;
  selectedOptionIds: Prisma.JsonValue;
  correctOptionIds: Prisma.JsonValue;
  isCorrect: boolean | null;
  explanation: string;
  submittedAt: Date;
  pointsAwarded: number;
  unlockedAchievements: Prisma.JsonValue;
}, snapshot?: QuestionSnapshot) {
  const textAnswers = answer.textAnswer
    ? (() => { try { const parsed = JSON.parse(answer.textAnswer); return Array.isArray(parsed) ? parsed.map(String) : [answer.textAnswer]; } catch { return [answer.textAnswer]; } })()
    : [];
  return {
    questionId: answer.questionId,
    answerType: answer.answerType.toLowerCase(),
    selectedOptionIds: jsonStrings(answer.selectedOptionIds),
    textAnswers,
    correctOptionIds: jsonStrings(answer.correctOptionIds),
    isCorrect: answer.isCorrect,
    selfAssessment: answer.selfAssessment?.toLowerCase() || null,
    evaluationRequired: answer.answerType === "SHORT_ANSWER" && answer.isCorrect === null,
    acceptedAnswers: snapshot?.type === "fill_blank" ? snapshot.acceptedAnswers : [],
    referenceAnswer: snapshot?.type === "short_answer" ? snapshot.referenceAnswer : "",
    explanation: answer.explanation,
    submittedAt: answer.submittedAt.toISOString(),
    pointsAwarded: answer.pointsAwarded,
    unlockedAchievementKeys: unlockedKeys(answer.unlockedAchievements)
  };
}

function sessionSummary(session: {
  id: string;
  subjectId: string | null;
  mode: string;
  updatedAt: Date;
  _count?: { questions: number; answers: number };
}) {
  return {
    id: session.id,
    subjectId: session.subjectId,
    subject: session.subjectId,
    scope: session.subjectId === null ? "all" : "subject",
    mode: modeFromDatabase(session.mode),
    answeredCount: session._count?.answers || 0,
    totalCount: session._count?.questions || 0,
    updatedAt: session.updatedAt.toISOString()
  };
}

function startOfShanghaiDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
}

function accuracy(correct: number, total: number): number {
  return total ? Math.round((correct / total) * 100) : 0;
}

function snapshotFromCandidate(candidate: {
  id: string;
  subjectId: string;
  chapterId: string;
  chapter: { name: string };
  currentVersion: {
    version: number;
    type: string;
    stem: string;
    code: string | null;
    explanation: string;
    difficulty: number;
    tags: Prisma.JsonValue;
    images: Prisma.JsonValue;
    correctOptionIds: Prisma.JsonValue;
    acceptedAnswers: Prisma.JsonValue;
    answerConfig: Prisma.JsonValue;
    referenceAnswer: string | null;
    options: Array<{ optionId: string; label: string; text: string; position: number }>;
  } | null;
}): QuestionSnapshot {
  const version = candidate.currentVersion;
  if (!version) throw new AppError("题目缺少当前版本", "QUESTION_VERSION_MISSING", 500);
  return {
    id: candidate.id,
    subjectId: candidate.subjectId,
    chapterId: candidate.chapterId,
    chapterName: candidate.chapter.name,
    type: version.type.toLowerCase() as QuestionSnapshot["type"],
    stem: version.stem,
    code: version.code || "",
    images: Array.isArray(version.images) ? version.images as QuestionSnapshot["images"] : [],
    options: version.options.sort((a, b) => a.position - b.position).map((option) => ({
      id: option.optionId,
      label: option.label,
      text: option.text
    })),
    correctOptionIds: jsonStrings(version.correctOptionIds),
    acceptedAnswers: jsonNestedStrings(version.acceptedAnswers),
    answerConfig: version.answerConfig && typeof version.answerConfig === "object" && !Array.isArray(version.answerConfig)
      ? version.answerConfig as QuestionSnapshot["answerConfig"]
      : {},
    referenceAnswer: version.referenceAnswer || "",
    explanation: version.explanation,
    difficulty: version.difficulty,
    tags: jsonStrings(version.tags),
    version: version.version
  };
}

export class PracticeService {
  constructor(
    private readonly prisma: DatabaseClient,
    private readonly gamification: GamificationService,
    private readonly examService?: ExamService,
    private readonly catalogService?: CatalogService
  ) {}

  private async requireSubject(subjectId: string): Promise<void> {
    if (this.catalogService) {
      const catalog = await this.catalogService.getCatalog();
      const published = catalog.modules.some((module) => module.subjects.some((subject) => subject.id === subjectId));
      if (!published) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
      return;
    }
    const subject = await this.prisma.subject.findFirst({ where: { id: subjectId, active: true } });
    if (!subject) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
  }

  async getLearningOverview(userId: string) {
    const [totalQuestions, answers, attemptedRows, examAnswers, wrongCount, favoriteCount, activeSession, activeExam, questionSubjects, catalogModules] = await Promise.all([
      this.prisma.question.count({ where: { status: "ACTIVE" } }),
      this.prisma.practiceAnswer.findMany({ where: { userId }, select: { isCorrect: true, submittedAt: true } }),
      this.prisma.practiceAnswer.findMany({ where: { userId }, distinct: ["questionId"], select: { questionId: true, question: { select: { subjectId: true } } } }),
      this.prisma.examQuestion.findMany({
        where: { exam: { userId, status: "COMPLETED" }, isCorrect: { not: null } },
        select: { questionId: true, subjectId: true, isCorrect: true, exam: { select: { submittedAt: true } } }
      }),
      this.prisma.wrongQuestionRecord.count({ where: { userId, mastered: false } }),
      this.prisma.favorite.count({ where: { userId } }),
      this.prisma.practiceSession.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { questions: true, answers: true } } }
      }),
      this.examService ? this.examService.getActiveExamSummary(userId) : Promise.resolve(null),
      this.prisma.question.groupBy({ by: ["subjectId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
      this.prisma.catalogModule.findMany({
        where: { active: true },
        orderBy: { order: "asc" },
        include: { subjects: { orderBy: { order: "asc" }, include: { subject: true } } }
      })
    ]);
    const attemptedBySubject = new Map<string, number>();
    const attemptedQuestionSubjects = new Map<string, string>();
    attemptedRows.forEach((row) => attemptedQuestionSubjects.set(row.questionId, row.question.subjectId));
    examAnswers.forEach((row) => attemptedQuestionSubjects.set(row.questionId, row.subjectId));
    attemptedQuestionSubjects.forEach((subjectId) => attemptedBySubject.set(subjectId, (attemptedBySubject.get(subjectId) || 0) + 1));
    const totalsBySubject = new Map(questionSubjects.map((row) => [row.subjectId, row._count._all]));
    const publishedCatalog = this.catalogService ? await this.catalogService.getCatalog() : null;
    const moduleInputs = publishedCatalog
      ? publishedCatalog.modules.map((module) => ({ ...module, subjectIds: module.subjects.map((subject) => subject.id) }))
      : catalogModules.map((module) => ({
          id: module.id,
          name: module.name,
          subtitle: module.subtitle || "",
          color: module.color,
          type: module.type.toLowerCase(),
          subjectIds: module.subjects.filter((link) => link.subject.active).map((link) => link.subjectId)
        }));
    const modules = moduleInputs.map((module) => {
      const subjectIds = module.subjectIds.filter((subjectId) => (totalsBySubject.get(subjectId) || 0) > 0);
      const moduleTotal = subjectIds.reduce((sum, id) => sum + (totalsBySubject.get(id) || 0), 0);
      const moduleAttempted = subjectIds.reduce((sum, id) => sum + (attemptedBySubject.get(id) || 0), 0);
      return {
        id: module.id,
        name: module.name,
        subtitle: module.subtitle || "",
        color: module.color,
        type: module.type.toLowerCase(),
        subjectIds,
        totalQuestions: moduleTotal,
        attemptedCount: moduleAttempted,
        progressPercent: accuracy(moduleAttempted, moduleTotal)
      };
    }).filter((module) => module.totalQuestions > 0);
    const correct = answers.filter((answer) => answer.isCorrect).length + examAnswers.filter((answer) => answer.isCorrect).length;
    const totalAttempts = answers.length + examAnswers.length;
    const dayStart = startOfShanghaiDay();
    return {
      totalQuestions,
      attemptedCount: attemptedQuestionSubjects.size,
      progressPercent: accuracy(attemptedQuestionSubjects.size, totalQuestions),
      todayAttempts: answers.filter((answer) => answer.submittedAt >= dayStart).length
        + examAnswers.filter((answer) => answer.exam.submittedAt && answer.exam.submittedAt >= dayStart).length,
      totalAttempts,
      accuracy: accuracy(correct, totalAttempts),
      unmasteredWrongCount: wrongCount,
      favoriteCount,
      modules,
      activeSession: activeSession ? sessionSummary(activeSession) : null,
      activeExam
    };
  }

  async getSubjectOverview(userId: string, subjectId: string) {
    await this.requireSubject(subjectId);
    const [totalQuestions, answers, attempted, examAnswers, wrongCount, favoriteCount, activeSession] = await Promise.all([
      this.prisma.question.count({ where: { subjectId, status: "ACTIVE" } }),
      this.prisma.practiceAnswer.findMany({ where: { userId, question: { subjectId } }, select: { isCorrect: true } }),
      this.prisma.practiceAnswer.findMany({ where: { userId, question: { subjectId } }, distinct: ["questionId"], select: { questionId: true } }),
      this.prisma.examQuestion.findMany({
        where: { subjectId, exam: { userId, status: "COMPLETED" }, isCorrect: { not: null } },
        select: { questionId: true, isCorrect: true }
      }),
      this.prisma.wrongQuestionRecord.count({ where: { userId, mastered: false, question: { subjectId } } }),
      this.prisma.favorite.count({ where: { userId, question: { subjectId } } }),
      this.prisma.practiceSession.findFirst({
        where: { userId, subjectId, status: "ACTIVE" },
        include: { _count: { select: { questions: true, answers: true } } }
      })
    ]);
    const attemptedIds = new Set([...attempted.map((answer) => answer.questionId), ...examAnswers.map((answer) => answer.questionId)]);
    const correct = answers.filter((answer) => answer.isCorrect).length + examAnswers.filter((answer) => answer.isCorrect).length;
    const totalAttempts = answers.length + examAnswers.length;
    return {
      subjectId,
      totalQuestions,
      attemptedCount: attemptedIds.size,
      progressPercent: accuracy(attemptedIds.size, totalQuestions),
      totalAttempts,
      accuracy: accuracy(correct, totalAttempts),
      unmasteredWrongCount: wrongCount,
      favoriteCount,
      activeSession: activeSession ? sessionSummary(activeSession) : null
    };
  }

  async getChapters(userId: string, subjectId: string) {
    await this.requireSubject(subjectId);
    const publishedCatalog = this.catalogService ? await this.catalogService.getCatalog() : null;
    const publishedChapters = publishedCatalog?.chapters.filter((chapter) => chapter.subjectId === subjectId) || null;
    const publishedChapterById = new Map((publishedChapters || []).map((chapter) => [chapter.id, chapter]));
    const [chapters, answers, examAnswers] = await Promise.all([
      this.prisma.chapter.findMany({
        where: publishedChapters ? { id: { in: publishedChapters.map((chapter) => chapter.id) } } : { subjectId, active: true },
        orderBy: { order: "asc" },
        include: { questions: { where: { status: "ACTIVE" }, select: { id: true } } }
      }),
      this.prisma.practiceAnswer.findMany({
        where: { userId, question: { subjectId } },
        select: { questionId: true, isCorrect: true, question: { select: { chapterId: true } } }
      }),
      this.prisma.examQuestion.findMany({
        where: { subjectId, exam: { userId, status: "COMPLETED" }, isCorrect: { not: null } },
        select: { questionId: true, isCorrect: true, question: { select: { chapterId: true } } }
      })
    ]);
    const combinedAnswers = [...answers, ...examAnswers];
    return chapters.map((chapter) => {
      const chapterAnswers = combinedAnswers.filter((answer) => answer.question.chapterId === chapter.id);
      const attempted = new Set(chapterAnswers.map((answer) => answer.questionId)).size;
      const correct = chapterAnswers.filter((answer) => answer.isCorrect).length;
      return {
        id: chapter.id,
        name: publishedChapterById.get(chapter.id)?.name || chapter.name,
        order: publishedChapterById.get(chapter.id)?.order ?? chapter.order,
        totalCount: chapter.questions.length,
        attemptedCount: attempted,
        progressPercent: accuracy(attempted, chapter.questions.length),
        accuracy: accuracy(correct, chapterAnswers.length)
      };
    });
  }

  async createSession(userId: string, payload: {
    scope?: string;
    subject?: string;
    mode: string;
    chapterId?: string;
    count: number | "all";
  }) {
    const scope = payload.scope || "subject";
    if (scope !== "subject" && scope !== "all") {
      throw new AppError("练习范围只能是 subject 或 all", "INVALID_SCOPE", 400);
    }
    if (!(payload.mode in MODE_TO_DATABASE)) throw new AppError("不支持的练习模式", "INVALID_MODE", 400);
    const mode = payload.mode as PublicMode;

    if (scope === "all") {
      if (mode !== "favorite" || payload.subject !== undefined || payload.chapterId !== undefined) {
        throw new AppError("全局范围仅支持不指定学科和章节的收藏重练", "INVALID_GLOBAL_SESSION", 400);
      }
      if (payload.count !== "all" && ![5, 10, 20].includes(Number(payload.count))) {
        throw new AppError("全局收藏题量只能选择 5、10、20 或全部", "INVALID_COUNT", 400);
      }
    } else {
      if (!payload.subject) throw new AppError("单学科练习缺少 subject", "SUBJECT_REQUIRED", 400);
      await this.requireSubject(payload.subject);
      if (payload.count === "all" || ![5, 10, 20].includes(Number(payload.count))) {
        throw new AppError("题量只能选择 5、10 或 20", "INVALID_COUNT", 400);
      }
      if (mode === "chapter" && !payload.chapterId) throw new AppError("章节练习缺少 chapterId", "CHAPTER_REQUIRED", 400);
      if (mode !== "chapter" && payload.chapterId !== undefined) {
        throw new AppError("仅章节练习可以指定 chapterId", "CHAPTER_NOT_ALLOWED", 400);
      }
      if (payload.chapterId) {
        if (this.catalogService) {
          const catalog = await this.catalogService.getCatalog();
          if (!catalog.chapters.some((chapter) => chapter.id === payload.chapterId && chapter.subjectId === payload.subject)) {
            throw new AppError("章节不存在", "CHAPTER_NOT_FOUND", 404);
          }
        } else {
          const chapter = await this.prisma.chapter.findFirst({ where: { id: payload.chapterId, subjectId: payload.subject, active: true } });
          if (!chapter) throw new AppError("章节不存在", "CHAPTER_NOT_FOUND", 404);
        }
      }
    }

    const where: Prisma.QuestionWhereInput = {
      ...(scope === "subject" ? { subjectId: payload.subject } : {}),
      status: "ACTIVE",
      currentVersionId: { not: null }
    };
    if (mode === "chapter") where.chapterId = payload.chapterId;
    if (mode === "wrong") where.wrongRecords = { some: { userId, mastered: false } };
    if (mode === "favorite") where.favorites = { some: { userId } };
    const candidates = await this.prisma.question.findMany({
      where,
      include: { chapter: true, currentVersion: { include: { options: true } } }
    });
    if (!candidates.length) throw new AppError("当前没有可练习的题目", "EMPTY_QUESTION_POOL", 400);
    const requestedCount = payload.count === "all" ? candidates.length : payload.count;
    const selected = shuffle(candidates).slice(0, Math.min(requestedCount, candidates.length));
    const now = new Date();
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await tx.practiceSession.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { status: "ABANDONED", abandonedAt: now }
      });
      const session = await tx.practiceSession.create({
        data: {
          userId,
          subjectId: scope === "all" ? null : payload.subject!,
          mode: MODE_TO_DATABASE[mode],
          chapterId: payload.chapterId || null,
          requestedCount,
          questions: {
            create: selected.map((question, position) => ({
              questionId: question.id,
              questionVersionId: question.currentVersionId!,
              position,
              snapshot: snapshotFromCandidate(question) as unknown as Prisma.InputJsonValue
            }))
          }
        }
      });
      return session.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getSession(userId, sessionId);
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.practiceSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        questions: { orderBy: { position: "asc" } },
        answers: { orderBy: { submittedAt: "asc" } }
      }
    });
    if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
    if (session.status === "ABANDONED") throw new AppError("练习已被新会话替代", "SESSION_FINISHED", 409);
    const questionIds = session.questions.map((item) => item.questionId);
    const favorites = await this.prisma.favorite.findMany({ where: { userId, questionId: { in: questionIds } }, select: { questionId: true } });
    const favoriteIds = new Set(favorites.map((favorite) => favorite.questionId));
    const snapshotByQuestion = new Map(session.questions.map((item) => [item.questionId, item.snapshot as unknown as QuestionSnapshot]));
    const answers = Object.fromEntries(session.answers.map((answer) => [answer.questionId, answerResult(answer, snapshotByQuestion.get(answer.questionId))]));
    const completedAnswerCount = session.answers.filter((answer) => answer.isCorrect !== null).length;
    return {
      ...sessionSummary({ ...session, _count: { questions: session.questions.length, answers: session.answers.length } }),
      subject: session.subjectId,
      chapterId: session.chapterId || "",
      status: statusFromDatabase(session.status),
      createdAt: session.createdAt.toISOString(),
      currentIndex: Math.min(completedAnswerCount, Math.max(0, session.questions.length - 1)),
      questions: session.questions.map((item) => publicQuestion(item.snapshot as unknown as QuestionSnapshot, favoriteIds.has(item.questionId))),
      answers
    };
  }

  async submitAnswer(userId: string, sessionId: string, payload: {
    questionId: string;
    selectedOptionIds?: string[];
    textAnswer?: string | string[];
    answer?: { kind: "choice"; optionIds: string[] } | { kind: "fill"; values: string[] } | { kind: "short"; value: string };
    clientAnswerId: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const idempotent = await tx.practiceAnswer.findUnique({
        where: { userId_clientAnswerId: { userId, clientAnswerId: payload.clientAnswerId } }
      });
      if (idempotent) {
        if (idempotent.sessionId !== sessionId || idempotent.questionId !== payload.questionId) {
          throw new AppError("clientAnswerId 已用于其他答题请求", "IDEMPOTENCY_KEY_REUSED", 409);
        }
        const savedQuestion = await tx.practiceSessionQuestion.findUnique({ where: { sessionId_questionId: { sessionId, questionId: payload.questionId } } });
        return { answer: idempotent, snapshot: savedQuestion?.snapshot as unknown as QuestionSnapshot };
      }
      const session = await tx.practiceSession.findFirst({
        where: { id: sessionId, userId },
        include: { questions: { where: { questionId: payload.questionId } } }
      });
      if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
      if (session.status !== "ACTIVE") throw new AppError("当前练习已结束", "SESSION_FINISHED", 409);
      const sessionQuestion = session.questions[0];
      if (!sessionQuestion) throw new AppError("题目不属于当前练习", "QUESTION_NOT_IN_SESSION", 400);
      const existing = await tx.practiceAnswer.findUnique({ where: { sessionId_questionId: { sessionId, questionId: payload.questionId } } });
      if (existing) throw new AppError("该题已经提交，不能修改答案", "ANSWER_ALREADY_SUBMITTED", 409);
      const snapshot = sessionQuestion.snapshot as unknown as QuestionSnapshot;
      let selected: string[] = [];
      let textAnswers: string[] = [];
      let isCorrect: boolean | null;
      if (["single", "multiple", "judge"].includes(snapshot.type)) {
        try {
          selected = validateSelection(snapshot, payload.answer?.kind === "choice" ? payload.answer.optionIds : (payload.selectedOptionIds || []));
        } catch (error) {
          const code = error instanceof Error ? error.message : "INVALID_OPTION";
          throw new AppError(code === "ANSWER_REQUIRED" ? "请先选择答案" : "提交的选项不存在或数量不合法", code, 400);
        }
        isCorrect = sameAnswer(selected, snapshot.correctOptionIds);
      } else if (snapshot.type === "fill_blank") {
        const raw = payload.answer?.kind === "fill" ? payload.answer.values : (Array.isArray(payload.textAnswer) ? payload.textAnswer : [payload.textAnswer || ""]);
        textAnswers = raw.map((item) => String(item).normalize("NFKC").trim());
        if (textAnswers.some((item) => !item)) throw new AppError("请完成全部填空", "ANSWER_REQUIRED", 400);
        isCorrect = sameFillAnswer(textAnswers, snapshot.acceptedAnswers, snapshot.answerConfig);
      } else {
        const value = payload.answer?.kind === "short" ? payload.answer.value : (Array.isArray(payload.textAnswer) ? payload.textAnswer[0] : payload.textAnswer);
        const normalized = String(value || "").normalize("NFKC").trim();
        if (!normalized) throw new AppError("请先填写简答内容", "ANSWER_REQUIRED", 400);
        textAnswers = [normalized];
        isCorrect = null;
      }
      const answer = await tx.practiceAnswer.create({
        data: {
          sessionId,
          questionId: payload.questionId,
          userId,
          clientAnswerId: payload.clientAnswerId,
          answerType: snapshot.type.toUpperCase() as never,
          selectedOptionIds: selected,
          textAnswer: textAnswers.length ? JSON.stringify(textAnswers) : null,
          normalizedTextAnswer: snapshot.type === "fill_blank" ? JSON.stringify(textAnswers.map((item) => normalizeFillAnswer(item, snapshot.answerConfig))) : null,
          correctOptionIds: snapshot.correctOptionIds,
          explanation: snapshot.explanation,
          isCorrect,
          unlockedAchievements: []
        }
      });
      if (isCorrect === false) {
        await tx.wrongQuestionRecord.upsert({
          where: { userId_questionId: { userId, questionId: payload.questionId } },
          update: { wrongCount: { increment: 1 }, mastered: false, lastWrongAt: answer.submittedAt, masteredAt: null },
          create: { userId, questionId: payload.questionId, firstWrongAt: answer.submittedAt, lastWrongAt: answer.submittedAt }
        });
      } else if (isCorrect === true && session.mode === "WRONG") {
        await tx.wrongQuestionRecord.updateMany({
          where: { userId, questionId: payload.questionId },
          data: { mastered: true, masteredAt: answer.submittedAt }
        });
      }
      const reward = await this.gamification.awardAnswers(tx, userId, [{
        questionId: payload.questionId,
        isCorrect: Boolean(isCorrect),
        allowCorrectReward: snapshot.type !== "short_answer",
        occurredAt: answer.submittedAt,
        sourceType: "practice",
        sourceId: answer.id
      }]);
      const updated = await tx.practiceAnswer.update({
        where: { id: answer.id },
        data: {
          pointsAwarded: reward.pointsAwarded,
          unlockedAchievements: reward.unlockedAchievements.map((achievement) => achievement.key)
        }
      });
      return { answer: updated, snapshot };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return answerResult(result.answer, result.snapshot);
  }

  async assessShortAnswer(userId: string, sessionId: string, questionId: string, assessment: "mastered" | "unmastered") {
    if (!["mastered", "unmastered"].includes(assessment)) throw new AppError("自评结果无效", "INVALID_SELF_ASSESSMENT", 400);
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.practiceSession.findFirst({
        where: { id: sessionId, userId, status: "ACTIVE" },
        include: { questions: { where: { questionId } } }
      });
      if (!session) throw new AppError("练习不存在或已经结束", "SESSION_NOT_FOUND", 404);
      const item = session.questions[0];
      if (!item) throw new AppError("题目不属于当前练习", "QUESTION_NOT_IN_SESSION", 400);
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      if (snapshot.type !== "short_answer") throw new AppError("只有简答题需要自评", "SELF_ASSESSMENT_NOT_ALLOWED", 400);
      const answer = await tx.practiceAnswer.findUnique({ where: { sessionId_questionId: { sessionId, questionId } } });
      if (!answer) throw new AppError("请先提交简答内容", "ANSWER_REQUIRED", 409);
      if (answer.isCorrect !== null) return { answer, snapshot };
      const mastered = assessment === "mastered";
      const updated = await tx.practiceAnswer.update({
        where: { id: answer.id },
        data: { selfAssessment: mastered ? "MASTERED" : "UNMASTERED", isCorrect: mastered }
      });
      if (!mastered) {
        await tx.wrongQuestionRecord.upsert({
          where: { userId_questionId: { userId, questionId } },
          update: { wrongCount: { increment: 1 }, mastered: false, lastWrongAt: updated.submittedAt, masteredAt: null },
          create: { userId, questionId, firstWrongAt: updated.submittedAt, lastWrongAt: updated.submittedAt }
        });
      } else if (session.mode === "WRONG") {
        await tx.wrongQuestionRecord.updateMany({ where: { userId, questionId }, data: { mastered: true, masteredAt: new Date() } });
      }
      return { answer: updated, snapshot };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return answerResult(result.answer, result.snapshot);
  }

  private async buildResult(userId: string, sessionId: string) {
    const session = await this.prisma.practiceSession.findFirst({
      where: { id: sessionId, userId },
      include: { questions: true, answers: true }
    });
    if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
    const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer]));
    const chapters = new Map<string, { subjectId: string; chapterId: string; chapterName: string; totalCount: number; correctCount: number }>();
    const subjects = new Map<string, { subjectId: string; totalCount: number; correctCount: number }>();
    session.questions.forEach((item) => {
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const chapterKey = `${snapshot.subjectId}:${snapshot.chapterId}`;
      const chapter = chapters.get(chapterKey) || {
        subjectId: snapshot.subjectId,
        chapterId: snapshot.chapterId,
        chapterName: snapshot.chapterName,
        totalCount: 0,
        correctCount: 0
      };
      chapter.totalCount += 1;
      chapter.correctCount += answerMap.get(item.questionId)?.isCorrect ? 1 : 0;
      chapters.set(chapterKey, chapter);
      const subject = subjects.get(snapshot.subjectId) || {
        subjectId: snapshot.subjectId,
        totalCount: 0,
        correctCount: 0
      };
      subject.totalCount += 1;
      subject.correctCount += answerMap.get(item.questionId)?.isCorrect ? 1 : 0;
      subjects.set(snapshot.subjectId, subject);
    });
    const correctCount = session.answers.filter((answer) => answer.isCorrect).length;
    return {
      sessionId: session.id,
      subjectId: session.subjectId,
      subject: session.subjectId,
      scope: session.subjectId === null ? "all" : "subject",
      mode: modeFromDatabase(session.mode),
      status: statusFromDatabase(session.status),
      totalCount: session.questions.length,
      correctCount,
      wrongCount: session.questions.length - correctCount,
      accuracy: accuracy(correctCount, session.questions.length),
      subjects: (await this.prisma.subject.findMany({
        where: { active: true },
        orderBy: { order: "asc" },
        select: { id: true }
      }))
        .map((registered) => subjects.get(registered.id))
        .filter((subject): subject is { subjectId: string; totalCount: number; correctCount: number } => Boolean(subject))
        .map((subject) => Object.assign(subject, {
          wrongCount: subject.totalCount - subject.correctCount,
          accuracy: accuracy(subject.correctCount, subject.totalCount)
        })),
      chapters: Array.from(chapters.values()).map((chapter) => Object.assign(chapter, {
        wrongCount: chapter.totalCount - chapter.correctCount,
        accuracy: accuracy(chapter.correctCount, chapter.totalCount)
      }))
    };
  }

  async finishSession(userId: string, sessionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.practiceSession.findFirst({
        where: { id: sessionId, userId },
        include: {
          _count: { select: { questions: true, answers: true } },
          answers: { where: { isCorrect: null }, select: { id: true } }
        }
      });
      if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
      if (session.status === "COMPLETED") return;
      if (session.status !== "ACTIVE") throw new AppError("当前练习已结束", "SESSION_FINISHED", 409);
      if (session._count.answers !== session._count.questions) throw new AppError("仍有题目未完成", "SESSION_INCOMPLETE", 409);
      if (session.answers.length) throw new AppError("仍有简答题尚未完成自评", "SELF_ASSESSMENT_REQUIRED", 409);
      await tx.practiceSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", completedAt: new Date() }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.buildResult(userId, sessionId);
  }

  async getResult(userId: string, sessionId: string) {
    const session = await this.prisma.practiceSession.findFirst({ where: { id: sessionId, userId }, select: { status: true } });
    if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
    if (session.status !== "COMPLETED") throw new AppError("练习尚未完成", "SESSION_INCOMPLETE", 409);
    return this.buildResult(userId, sessionId);
  }

  async getWrongQuestions(userId: string, subjectId?: string, mastered?: boolean) {
    if (subjectId) await this.requireSubject(subjectId);
    const records = await this.prisma.wrongQuestionRecord.findMany({
      where: { userId, ...(mastered === undefined ? {} : { mastered }), ...(subjectId ? { question: { subjectId } } : {}) },
      orderBy: { lastWrongAt: "desc" },
      include: { question: { include: { currentVersion: { include: { options: true } }, chapter: true } } }
    });
    return records.map((record) => {
      const snapshot = snapshotFromCandidate(record.question);
      return Object.assign({}, publicQuestion(snapshot, false), {
        correctOptionIds: snapshot.correctOptionIds,
        acceptedAnswers: snapshot.acceptedAnswers,
        referenceAnswer: snapshot.referenceAnswer,
        explanation: snapshot.explanation,
        wrong: {
          wrongCount: record.wrongCount,
          mastered: record.mastered,
          lastWrongAt: record.lastWrongAt.toISOString(),
          masteredAt: record.masteredAt?.toISOString() || null
        }
      });
    });
  }

  private async attemptedCurrentVersions(userId: string, questionIds: string[]): Promise<Set<string>> {
    if (!questionIds.length) return new Set();
    const rows = await this.prisma.$queryRaw<Array<{ questionId: string }>>(Prisma.sql`
      SELECT DISTINCT attempted.question_id AS questionId
      FROM questions q
      JOIN (
        SELECT psq.question_id, psq.question_version_id
        FROM practice_session_questions psq
        JOIN practice_answers pa
          ON pa.session_id = psq.session_id AND pa.question_id = psq.question_id
        WHERE pa.user_id = ${userId}
        UNION DISTINCT
        SELECT eq.question_id, eq.question_version_id
        FROM exam_questions eq
        JOIN exams e ON e.id = eq.exam_id
        WHERE e.user_id = ${userId} AND e.status = 'COMPLETED'
      ) attempted
        ON attempted.question_id = q.id
       AND attempted.question_version_id = q.current_version_id
      WHERE q.id IN (${Prisma.join(questionIds)})
    `);
    return new Set(rows.map((row) => row.questionId));
  }

  async getFavorites(userId: string, subjectId?: string) {
    if (subjectId) await this.requireSubject(subjectId);
    const favorites = await this.prisma.favorite.findMany({
      where: { userId, ...(subjectId ? { question: { subjectId } } : {}) },
      orderBy: { createdAt: "desc" },
      include: { question: { include: { currentVersion: { include: { options: true } }, chapter: true } } }
    });
    const attempted = await this.attemptedCurrentVersions(userId, favorites.map((favorite) => favorite.questionId));
    return favorites.map((favorite) => {
      const snapshot = snapshotFromCandidate(favorite.question);
      if (!attempted.has(favorite.questionId)) {
        return Object.assign({}, publicQuestion(snapshot, true), {
          answersAvailable: false,
          wrong: null
        });
      }
      return Object.assign({}, publicQuestion(snapshot, true), {
        correctOptionIds: snapshot.correctOptionIds,
        acceptedAnswers: snapshot.acceptedAnswers,
        referenceAnswer: snapshot.referenceAnswer,
        explanation: snapshot.explanation,
        answersAvailable: true,
        wrong: null
      });
    });
  }

  async setFavorite(userId: string, subjectId: string, questionId: string, favorite: boolean) {
    await this.requireSubject(subjectId);
    const question = await this.prisma.question.findFirst({ where: { id: questionId, subjectId, status: "ACTIVE" } });
    if (!question) throw new AppError("题目不存在", "QUESTION_NOT_FOUND", 404);
    if (favorite) {
      const attempted = await this.attemptedCurrentVersions(userId, [questionId]);
      if (!attempted.has(questionId)) {
        throw new AppError("完成当前题目作答后才能收藏", "QUESTION_NOT_ANSWERED", 409);
      }
      await this.prisma.favorite.upsert({
        where: { userId_questionId: { userId, questionId } },
        update: {},
        create: { userId, questionId }
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId, questionId } });
    }
    await this.gamification.reconcileUser(userId);
    return { questionId, isFavorite: favorite };
  }
}
