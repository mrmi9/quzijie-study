import { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import { MODULES, SUBJECTS, isSubjectId } from "../domain/subjects.js";
import {
  publicQuestion,
  sameAnswer,
  shuffle,
  validateSelection,
  type QuestionSnapshot
} from "../domain/questions.js";
import type { ExamService } from "./exam.js";

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

function answerResult(answer: {
  questionId: string;
  selectedOptionIds: Prisma.JsonValue;
  correctOptionIds: Prisma.JsonValue;
  isCorrect: boolean;
  explanation: string;
  submittedAt: Date;
}) {
  return {
    questionId: answer.questionId,
    selectedOptionIds: jsonStrings(answer.selectedOptionIds),
    correctOptionIds: jsonStrings(answer.correctOptionIds),
    isCorrect: answer.isCorrect,
    explanation: answer.explanation,
    submittedAt: answer.submittedAt.toISOString()
  };
}

function sessionSummary(session: {
  id: string;
  subjectId: string;
  mode: string;
  updatedAt: Date;
  _count?: { questions: number; answers: number };
}) {
  return {
    id: session.id,
    subjectId: session.subjectId,
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
    explanation: version.explanation,
    difficulty: version.difficulty,
    tags: jsonStrings(version.tags),
    version: version.version
  };
}

export class PracticeService {
  constructor(private readonly prisma: DatabaseClient, private readonly examService?: ExamService) {}

  private async requireSubject(subjectId: string) {
    if (!isSubjectId(subjectId)) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
    const subject = await this.prisma.subject.findFirst({ where: { id: subjectId, active: true } });
    if (!subject) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
    return subject;
  }

  async getLearningOverview(userId: string) {
    const [totalQuestions, answers, attemptedRows, examAnswers, wrongCount, favoriteCount, activeSession, activeExam, questionSubjects] = await Promise.all([
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
      this.prisma.question.groupBy({ by: ["subjectId"], where: { status: "ACTIVE" }, _count: { _all: true } })
    ]);
    const attemptedBySubject = new Map<string, number>();
    const attemptedQuestionSubjects = new Map<string, string>();
    attemptedRows.forEach((row) => attemptedQuestionSubjects.set(row.questionId, row.question.subjectId));
    examAnswers.forEach((row) => attemptedQuestionSubjects.set(row.questionId, row.subjectId));
    attemptedQuestionSubjects.forEach((subjectId) => attemptedBySubject.set(subjectId, (attemptedBySubject.get(subjectId) || 0) + 1));
    const totalsBySubject = new Map(questionSubjects.map((row) => [row.subjectId, row._count._all]));
    const modules = MODULES.map((module) => {
      const moduleTotal = module.subjectIds.reduce((sum, id) => sum + (totalsBySubject.get(id) || 0), 0);
      const moduleAttempted = module.subjectIds.reduce((sum, id) => sum + (attemptedBySubject.get(id) || 0), 0);
      return Object.assign({}, module, {
        subjectIds: Array.from(module.subjectIds),
        totalQuestions: moduleTotal,
        attemptedCount: moduleAttempted,
        progressPercent: accuracy(moduleAttempted, moduleTotal)
      });
    });
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
    const [chapters, answers, examAnswers] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { subjectId, active: true },
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
        name: chapter.name,
        order: chapter.order,
        totalCount: chapter.questions.length,
        attemptedCount: attempted,
        progressPercent: accuracy(attempted, chapter.questions.length),
        accuracy: accuracy(correct, chapterAnswers.length)
      };
    });
  }

  async createSession(userId: string, payload: { subject: string; mode: string; chapterId?: string; count: number }) {
    await this.requireSubject(payload.subject);
    if (!(payload.mode in MODE_TO_DATABASE)) throw new AppError("不支持的练习模式", "INVALID_MODE", 400);
    if (![5, 10, 20].includes(Number(payload.count))) throw new AppError("题量只能选择 5、10 或 20", "INVALID_COUNT", 400);
    const mode = payload.mode as PublicMode;
    if (mode === "chapter" && !payload.chapterId) throw new AppError("章节练习缺少 chapterId", "CHAPTER_REQUIRED", 400);
    if (payload.chapterId) {
      const chapter = await this.prisma.chapter.findFirst({ where: { id: payload.chapterId, subjectId: payload.subject, active: true } });
      if (!chapter) throw new AppError("章节不存在", "CHAPTER_NOT_FOUND", 404);
    }
    const where: Prisma.QuestionWhereInput = { subjectId: payload.subject, status: "ACTIVE", currentVersionId: { not: null } };
    if (mode === "chapter") where.chapterId = payload.chapterId;
    if (mode === "wrong") where.wrongRecords = { some: { userId, mastered: false } };
    if (mode === "favorite") where.favorites = { some: { userId } };
    const candidates = await this.prisma.question.findMany({
      where,
      include: { chapter: true, currentVersion: { include: { options: true } } }
    });
    if (!candidates.length) throw new AppError("当前没有可练习的题目", "EMPTY_QUESTION_POOL", 400);
    const selected = shuffle(candidates).slice(0, Math.min(payload.count, candidates.length));
    const now = new Date();
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await tx.practiceSession.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { status: "ABANDONED", abandonedAt: now }
      });
      const session = await tx.practiceSession.create({
        data: {
          userId,
          subjectId: payload.subject,
          mode: MODE_TO_DATABASE[mode],
          chapterId: payload.chapterId || null,
          requestedCount: payload.count,
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
    const answers = Object.fromEntries(session.answers.map((answer) => [answer.questionId, answerResult(answer)]));
    return {
      ...sessionSummary({ ...session, _count: { questions: session.questions.length, answers: session.answers.length } }),
      subject: session.subjectId,
      chapterId: session.chapterId || "",
      status: statusFromDatabase(session.status),
      createdAt: session.createdAt.toISOString(),
      currentIndex: Math.min(session.answers.length, Math.max(0, session.questions.length - 1)),
      questions: session.questions.map((item) => publicQuestion(item.snapshot as unknown as QuestionSnapshot, favoriteIds.has(item.questionId))),
      answers
    };
  }

  async submitAnswer(userId: string, sessionId: string, payload: { questionId: string; selectedOptionIds: string[]; clientAnswerId: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const idempotent = await tx.practiceAnswer.findUnique({
        where: { userId_clientAnswerId: { userId, clientAnswerId: payload.clientAnswerId } }
      });
      if (idempotent) {
        if (idempotent.sessionId !== sessionId || idempotent.questionId !== payload.questionId) {
          throw new AppError("clientAnswerId 已用于其他答题请求", "IDEMPOTENCY_KEY_REUSED", 409);
        }
        return idempotent;
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
      let selected: string[];
      try {
        selected = validateSelection(snapshot, payload.selectedOptionIds || []);
      } catch (error) {
        const code = error instanceof Error ? error.message : "INVALID_OPTION";
        throw new AppError(code === "ANSWER_REQUIRED" ? "请先选择答案" : "提交的选项不存在或数量不合法", code, 400);
      }
      const isCorrect = sameAnswer(selected, snapshot.correctOptionIds);
      const answer = await tx.practiceAnswer.create({
        data: {
          sessionId,
          questionId: payload.questionId,
          userId,
          clientAnswerId: payload.clientAnswerId,
          selectedOptionIds: selected,
          correctOptionIds: snapshot.correctOptionIds,
          explanation: snapshot.explanation,
          isCorrect
        }
      });
      if (!isCorrect) {
        await tx.wrongQuestionRecord.upsert({
          where: { userId_questionId: { userId, questionId: payload.questionId } },
          update: { wrongCount: { increment: 1 }, mastered: false, lastWrongAt: answer.submittedAt, masteredAt: null },
          create: { userId, questionId: payload.questionId, firstWrongAt: answer.submittedAt, lastWrongAt: answer.submittedAt }
        });
      } else if (session.mode === "WRONG") {
        await tx.wrongQuestionRecord.updateMany({
          where: { userId, questionId: payload.questionId },
          data: { mastered: true, masteredAt: answer.submittedAt }
        });
      }
      return answer;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return answerResult(result);
  }

  private async buildResult(userId: string, sessionId: string) {
    const session = await this.prisma.practiceSession.findFirst({
      where: { id: sessionId, userId },
      include: { questions: true, answers: true }
    });
    if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
    const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer]));
    const chapters = new Map<string, { chapterId: string; chapterName: string; totalCount: number; correctCount: number }>();
    session.questions.forEach((item) => {
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const chapter = chapters.get(snapshot.chapterId) || {
        chapterId: snapshot.chapterId,
        chapterName: snapshot.chapterName,
        totalCount: 0,
        correctCount: 0
      };
      chapter.totalCount += 1;
      chapter.correctCount += answerMap.get(item.questionId)?.isCorrect ? 1 : 0;
      chapters.set(snapshot.chapterId, chapter);
    });
    const correctCount = session.answers.filter((answer) => answer.isCorrect).length;
    return {
      sessionId: session.id,
      subjectId: session.subjectId,
      mode: modeFromDatabase(session.mode),
      status: statusFromDatabase(session.status),
      totalCount: session.questions.length,
      correctCount,
      wrongCount: session.questions.length - correctCount,
      accuracy: accuracy(correctCount, session.questions.length),
      chapters: Array.from(chapters.values()).map((chapter) => Object.assign(chapter, {
        accuracy: accuracy(chapter.correctCount, chapter.totalCount)
      }))
    };
  }

  async finishSession(userId: string, sessionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.practiceSession.findFirst({
        where: { id: sessionId, userId },
        include: { _count: { select: { questions: true, answers: true } } }
      });
      if (!session) throw new AppError("练习不存在或无权访问", "SESSION_NOT_FOUND", 404);
      if (session.status === "COMPLETED") return;
      if (session.status !== "ACTIVE") throw new AppError("当前练习已结束", "SESSION_FINISHED", 409);
      if (session._count.answers !== session._count.questions) throw new AppError("仍有题目未完成", "SESSION_INCOMPLETE", 409);
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

  async getFavorites(userId: string, subjectId?: string) {
    if (subjectId) await this.requireSubject(subjectId);
    const favorites = await this.prisma.favorite.findMany({
      where: { userId, ...(subjectId ? { question: { subjectId } } : {}) },
      orderBy: { createdAt: "desc" },
      include: { question: { include: { currentVersion: { include: { options: true } }, chapter: true } } }
    });
    return favorites.map((favorite) => {
      const snapshot = snapshotFromCandidate(favorite.question);
      return Object.assign({}, publicQuestion(snapshot, true), {
        correctOptionIds: snapshot.correctOptionIds,
        explanation: snapshot.explanation,
        wrong: null
      });
    });
  }

  async setFavorite(userId: string, subjectId: string, questionId: string, favorite: boolean) {
    await this.requireSubject(subjectId);
    const question = await this.prisma.question.findFirst({ where: { id: questionId, subjectId, status: "ACTIVE" } });
    if (!question) throw new AppError("题目不存在", "QUESTION_NOT_FOUND", 404);
    if (favorite) {
      await this.prisma.favorite.upsert({
        where: { userId_questionId: { userId, questionId } },
        update: {},
        create: { userId, questionId }
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId, questionId } });
    }
    return { questionId, isFavorite: favorite };
  }
}
