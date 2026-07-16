import { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import { publicQuestion, sameAnswer, shuffle, type QuestionSnapshot } from "../domain/questions.js";
import { GamificationService, unlockedKeys } from "./gamification.js";

export const EXAM_TYPE = "postgraduate-408-objective";
export const EXAM_DURATION_MS = 60 * 60 * 1000;
export const EXAM_DISTRIBUTION = { ds: 12, co: 12, os: 9, network: 7 } as const;
const EXAM_TOTAL = 40;
const EXAM_POINTS = 2;

const candidateInclude = {
  chapter: true,
  currentVersion: { include: { options: true } }
} satisfies Prisma.QuestionInclude;

type Candidate = Prisma.QuestionGetPayload<{ include: typeof candidateInclude }>;
type TransactionClient = Prisma.TransactionClient;
type SubmitReason = "MANUAL" | "EXPIRED";
type SubjectStat = { subjectId: string; totalCount: number; correctCount: number; accuracy: number };

export interface ExamServiceOptions {
  now?: () => Date;
  random?: () => number;
  scanIntervalMs?: number;
}

function jsonStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function percentage(correct: number, total: number): number {
  return total ? Math.round((correct / total) * 100) : 0;
}

function epoch(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

function snapshotFromCandidate(candidate: Candidate): QuestionSnapshot {
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
    images: Array.isArray(version.images) ? version.images as unknown as QuestionSnapshot["images"] : [],
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

function isPrismaUniqueError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export class ExamService {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly scanIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: DatabaseClient,
    options: ExamServiceOptions = {},
    private readonly gamification?: GamificationService
  ) {
    this.now = options.now || (() => new Date());
    this.random = options.random || Math.random;
    this.scanIntervalMs = options.scanIntervalMs || 15_000;
  }

  start(onError?: (error: unknown) => void): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.finalizeExpiredBatch().catch((error) => onError?.(error));
    }, this.scanIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async lockOwnedExam(tx: TransactionClient, userId: string, examId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM exams
      WHERE id = ${examId}
        AND user_id = ${userId}
      FOR UPDATE
    `);
    if (!rows.length) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    const exam = await tx.exam.findFirst({ where: { id: examId, userId } });
    if (!exam) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    return exam;
  }

  private async completeLockedExam(
    tx: TransactionClient,
    userId: string,
    examId: string,
    requestedReason: SubmitReason,
    submittedAt: Date
  ): Promise<void> {
    const exam = await tx.exam.findFirst({
      where: { id: examId, userId },
      include: {
        result: true,
        questions: { orderBy: { position: "asc" }, include: { draft: true } }
      }
    });
    if (!exam) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    if (exam.status === "COMPLETED") {
      if (!exam.result) throw new AppError("考试结果数据不完整", "EXAM_RESULT_MISSING", 500);
      return;
    }

    const reason: SubmitReason = submittedAt >= exam.expiresAt ? "EXPIRED" : requestedReason;
    const subjectStats = new Map<string, Omit<SubjectStat, "accuracy">>();
    let answeredCount = 0;
    let correctCount = 0;

    for (const item of exam.questions) {
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const selectedOptionIds = item.draft ? [item.draft.selectedOptionId] : [];
      const isCorrect = sameAnswer(selectedOptionIds, snapshot.correctOptionIds);
      if (selectedOptionIds.length) answeredCount += 1;
      if (isCorrect) correctCount += 1;
      const stat = subjectStats.get(item.subjectId) || { subjectId: item.subjectId, totalCount: 0, correctCount: 0 };
      stat.totalCount += 1;
      stat.correctCount += isCorrect ? 1 : 0;
      subjectStats.set(item.subjectId, stat);

      await tx.examQuestion.update({
        where: { examId_questionId: { examId, questionId: item.questionId } },
        data: { isCorrect }
      });
      if (!isCorrect) {
        await tx.wrongQuestionRecord.upsert({
          where: { userId_questionId: { userId, questionId: item.questionId } },
          update: { wrongCount: { increment: 1 }, mastered: false, lastWrongAt: submittedAt, masteredAt: null },
          create: { userId, questionId: item.questionId, firstWrongAt: submittedAt, lastWrongAt: submittedAt }
        });
      }
    }

    const orderedStats: SubjectStat[] = Object.keys(EXAM_DISTRIBUTION).map((subjectId) => {
      const stat = subjectStats.get(subjectId) || { subjectId, totalCount: 0, correctCount: 0 };
      return { ...stat, accuracy: percentage(stat.correctCount, stat.totalCount) };
    });
    const result = await tx.examResult.create({
      data: {
        examId,
        totalCount: exam.questions.length,
        answeredCount,
        correctCount,
        wrongCount: exam.questions.length - correctCount,
        score: correctCount * EXAM_POINTS,
        maxScore: EXAM_TOTAL * EXAM_POINTS,
        accuracy: percentage(correctCount, exam.questions.length),
        subjectStats: orderedStats as unknown as Prisma.InputJsonValue,
        submitReason: reason,
        submittedAt,
        unlockedAchievements: []
      }
    });
    await tx.exam.update({
      where: { id: examId },
      data: { status: "COMPLETED", submittedAt, submitReason: reason }
    });
    if (this.gamification) {
      const reward = await this.gamification.awardAnswers(
        tx,
        userId,
        exam.questions
          .filter((item) => item.draft)
          .map((item) => ({
            questionId: item.questionId,
            isCorrect: sameAnswer(
              [item.draft!.selectedOptionId],
              (item.snapshot as unknown as QuestionSnapshot).correctOptionIds
            ),
            occurredAt: submittedAt,
            sourceType: "exam" as const,
            sourceId: `${examId}:${item.questionId}`
          }))
      );
      await tx.examResult.update({
        where: { examId: result.examId },
        data: {
          pointsAwarded: reward.pointsAwarded,
          unlockedAchievements: reward.unlockedAchievements.map((achievement) => achievement.key)
        }
      });
    }
  }

  private async selectQuestions(): Promise<Candidate[]> {
    const candidates = await this.prisma.question.findMany({
      where: {
        subjectId: { in: Object.keys(EXAM_DISTRIBUTION) },
        status: "ACTIVE",
        currentVersion: { is: { type: "SINGLE" } }
      },
      include: candidateInclude
    });
    const selected: Candidate[] = [];
    for (const [subjectId, required] of Object.entries(EXAM_DISTRIBUTION)) {
      const pool = candidates.filter((candidate) => candidate.subjectId === subjectId
        && candidate.currentVersion
        && jsonStrings(candidate.currentVersion.examScopes).includes("408"));
      if (pool.length < required) {
        throw new AppError(`${subjectId} 的408单选题数量不足`, "EXAM_POOL_INSUFFICIENT", 409, {
          subjectId,
          required,
          available: pool.length
        });
      }
      selected.push(...shuffle(pool, this.random).slice(0, required));
    }
    return shuffle(selected, this.random);
  }

  async createExam(userId: string, type: string) {
    if (type !== EXAM_TYPE) throw new AppError("不支持的考试类型", "INVALID_EXAM_TYPE", 400);
    const now = this.now();
    const existing = await this.prisma.exam.findFirst({ where: { userId, type, status: "ACTIVE" } });
    if (existing) {
      if (existing.expiresAt > now) throw new AppError("已有未完成的模拟考试", "ACTIVE_EXAM_EXISTS", 409);
      await this.submitExam(userId, existing.id, "EXPIRED");
    }
    const selected = await this.selectQuestions();
    let examId: string;
    try {
      examId = await this.prisma.$transaction(async (tx) => {
        const ownerRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM users WHERE id = ${userId} FOR UPDATE
        `);
        if (!ownerRows.length) throw new AppError("请登录后继续", "UNAUTHORIZED", 401);
        const active = await tx.exam.findFirst({ where: { userId, type, status: "ACTIVE" } });
        if (active) {
          await this.lockOwnedExam(tx, userId, active.id);
          if (active.expiresAt > now) throw new AppError("已有未完成的模拟考试", "ACTIVE_EXAM_EXISTS", 409);
          await this.completeLockedExam(tx, userId, active.id, "EXPIRED", now);
        }
        const exam = await tx.exam.create({
          data: {
            userId,
            type,
            expiresAt: new Date(now.getTime() + EXAM_DURATION_MS),
            questions: {
              create: selected.map((candidate, position) => ({
                questionId: candidate.id,
                questionVersionId: candidate.currentVersionId!,
                subjectId: candidate.subjectId,
                position,
                points: EXAM_POINTS,
                snapshot: snapshotFromCandidate(candidate) as unknown as Prisma.InputJsonValue
              }))
            }
          }
        });
        return exam.id;
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) throw new AppError("已有未完成的模拟考试", "ACTIVE_EXAM_EXISTS", 409);
      throw error;
    }
    return this.getExam(userId, examId);
  }

  private async ensureCurrent(userId: string, examId: string): Promise<void> {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, userId }, select: { status: true, expiresAt: true } });
    if (!exam) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    if (exam.status === "ACTIVE" && exam.expiresAt <= this.now()) {
      await this.submitExam(userId, examId, "EXPIRED");
    }
  }

  private summary(exam: {
    id: string;
    type: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date;
    submittedAt: Date | null;
    questions: Array<{ draft: { questionId: string } | null }>;
    result: { score: number } | null;
  }) {
    return {
      id: exam.id,
      type: exam.type,
      status: exam.status.toLowerCase(),
      answeredCount: exam.questions.filter((item) => item.draft).length,
      totalCount: exam.questions.length,
      createdAt: exam.createdAt.getTime(),
      updatedAt: exam.updatedAt.getTime(),
      expiresAt: exam.expiresAt.getTime(),
      submittedAt: epoch(exam.submittedAt),
      score: exam.result?.score ?? null
    };
  }

  async getExam(userId: string, examId: string) {
    await this.ensureCurrent(userId, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, userId },
      include: {
        result: true,
        questions: { orderBy: { position: "asc" }, include: { draft: true } }
      }
    });
    if (!exam) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    const questionIds = exam.questions.map((item) => item.questionId);
    const favorites = await this.prisma.favorite.findMany({ where: { userId, questionId: { in: questionIds } }, select: { questionId: true } });
    const favoriteIds = new Set(favorites.map((item) => item.questionId));
    return {
      ...this.summary(exam),
      remainingSeconds: Math.max(0, Math.ceil((exam.expiresAt.getTime() - this.now().getTime()) / 1000)),
      questions: exam.questions.map((item) => publicQuestion(item.snapshot as unknown as QuestionSnapshot, favoriteIds.has(item.questionId))),
      answers: Object.fromEntries(exam.questions.filter((item) => item.draft).map((item) => [item.questionId, [item.draft!.selectedOptionId]]))
    };
  }

  async saveDraft(userId: string, examId: string, answers: Record<string, string[]>) {
    const completed = await this.prisma.$transaction(async (tx) => {
      const exam = await this.lockOwnedExam(tx, userId, examId);
      if (exam.status === "COMPLETED") return true;
      const now = this.now();
      if (exam.expiresAt <= now) {
        await this.completeLockedExam(tx, userId, examId, "EXPIRED", now);
        return true;
      }
      const questions = await tx.examQuestion.findMany({ where: { examId } });
      const questionMap = new Map(questions.map((item) => [item.questionId, item]));
      const nextDrafts: Array<{ questionId: string; selectedOptionId: string }> = [];
      for (const [questionId, selected] of Object.entries(answers || {})) {
        const item = questionMap.get(questionId);
        if (!item) throw new AppError("题目不属于当前试卷", "QUESTION_NOT_IN_EXAM", 400);
        if (!Array.isArray(selected) || selected.length > 1) throw new AppError("考试答案无效", "INVALID_OPTION", 400);
        if (!selected.length) continue;
        const snapshot = item.snapshot as unknown as QuestionSnapshot;
        if (!snapshot.options.some((option) => option.id === selected[0])) {
          throw new AppError("考试答案无效", "INVALID_OPTION", 400);
        }
        nextDrafts.push({ questionId, selectedOptionId: selected[0]! });
      }
      await tx.examDraft.deleteMany({ where: { examId } });
      if (nextDrafts.length) {
        await tx.examDraft.createMany({ data: nextDrafts.map((draft) => ({ examId, ...draft })) });
      }
      await tx.exam.update({ where: { id: examId }, data: { updatedAt: now } });
      return false;
    });
    return completed ? this.buildResult(userId, examId) : this.getExam(userId, examId);
  }

  async submitExam(userId: string, examId: string, requestedReason: SubmitReason = "MANUAL") {
    await this.prisma.$transaction(async (tx) => {
      const exam = await this.lockOwnedExam(tx, userId, examId);
      if (exam.status === "COMPLETED") return;
      await this.completeLockedExam(tx, userId, examId, requestedReason, this.now());
    });
    return this.buildResult(userId, examId);
  }

  async buildResult(userId: string, examId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, userId },
      include: {
        result: true,
        questions: { orderBy: { position: "asc" }, include: { draft: true } }
      }
    });
    if (!exam) throw new AppError("模拟考试不存在或无权访问", "EXAM_NOT_FOUND", 404);
    if (exam.status !== "COMPLETED" || !exam.result) throw new AppError("模拟考试尚未交卷", "EXAM_INCOMPLETE", 409);
    return {
      examId: exam.id,
      type: exam.type,
      totalCount: exam.result.totalCount,
      answeredCount: exam.result.answeredCount,
      correctCount: exam.result.correctCount,
      wrongCount: exam.result.wrongCount,
      score: exam.result.score,
      maxScore: exam.result.maxScore,
      accuracy: exam.result.accuracy,
      pointsAwarded: exam.result.pointsAwarded,
      unlockedAchievementKeys: unlockedKeys(exam.result.unlockedAchievements),
      subjects: Array.isArray(exam.result.subjectStats) ? exam.result.subjectStats : [],
      reviews: exam.questions.map((item) => ({
        question: item.snapshot as unknown as QuestionSnapshot,
        selectedOptionIds: item.draft ? [item.draft.selectedOptionId] : [],
        isCorrect: Boolean(item.isCorrect)
      })),
      submitReason: exam.result.submitReason.toLowerCase(),
      submittedAt: exam.result.submittedAt.getTime()
    };
  }

  async listExams(userId: string, type: string) {
    if (type !== EXAM_TYPE) throw new AppError("不支持的考试类型", "INVALID_EXAM_TYPE", 400);
    await this.finalizeExpiredBatch();
    const exams = await this.prisma.exam.findMany({
      where: { userId, type },
      orderBy: { createdAt: "desc" },
      include: {
        result: true,
        questions: { select: { draft: { select: { questionId: true } } } }
      }
    });
    return exams.map((exam) => this.summary(exam));
  }

  async getActiveExamSummary(userId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { userId, status: "ACTIVE", expiresAt: { gt: this.now() } },
      orderBy: { createdAt: "desc" },
      include: {
        result: true,
        questions: { select: { draft: { select: { questionId: true } } } }
      }
    });
    return exam ? this.summary(exam) : null;
  }

  async finalizeExpiredBatch(limit = 50): Promise<number> {
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>(Prisma.sql`
        SELECT id, user_id AS userId
        FROM exams
        WHERE status = 'ACTIVE'
          AND expires_at <= ${now}
        ORDER BY expires_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      for (const row of rows) {
        await this.completeLockedExam(tx, row.userId, row.id, "EXPIRED", now);
      }
      return rows.length;
    });
  }
}
