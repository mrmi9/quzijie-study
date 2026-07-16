import { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../db.js";
import { GamificationService, type AwardAnswerInput } from "../services/gamification.js";

const JOB_KEY = "gamification-v1";
const LOCK_NAME = "quzijie:gamification-v1";

type LockRow = { acquired: bigint | number | string | null };

function pointTotalsBySource(events: Array<{ sourceType: string; sourceId: string; points: number }>) {
  const practice = new Map<string, number>();
  const exams = new Map<string, number>();
  for (const event of events) {
    if (event.sourceType === "practice") {
      practice.set(event.sourceId, (practice.get(event.sourceId) || 0) + event.points);
    } else if (event.sourceType === "exam") {
      const examId = event.sourceId.split(":", 1)[0];
      if (examId) exams.set(examId, (exams.get(examId) || 0) + event.points);
    }
  }
  return { practice, exams };
}

async function backfillUser(prisma: DatabaseClient, userId: string): Promise<boolean> {
  const userJobKey = `${JOB_KEY}:${userId}`;
  return prisma.$transaction(async (tx) => {
    const completed = await tx.systemJob.findUnique({ where: { key: userJobKey } });
    if (completed) return false;

    const [practiceAnswers, examQuestions] = await Promise.all([
      tx.practiceAnswer.findMany({
        where: { userId },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        select: { id: true, questionId: true, isCorrect: true, submittedAt: true }
      }),
      tx.examQuestion.findMany({
        where: { exam: { userId, status: "COMPLETED" }, draft: { isNot: null } },
        select: {
          examId: true,
          questionId: true,
          isCorrect: true,
          draft: { select: { questionId: true } },
          exam: { select: { submittedAt: true } }
        }
      })
    ]);

    const inputs: AwardAnswerInput[] = [
      ...practiceAnswers.map((answer) => ({
        questionId: answer.questionId,
        isCorrect: answer.isCorrect,
        occurredAt: answer.submittedAt,
        sourceType: "practice" as const,
        sourceId: answer.id
      })),
      ...examQuestions
        .filter((question) => question.exam.submittedAt && question.isCorrect !== null)
        .map((question) => ({
          questionId: question.questionId,
          isCorrect: Boolean(question.isCorrect),
          occurredAt: question.exam.submittedAt!,
          sourceType: "exam" as const,
          sourceId: `${question.examId}:${question.questionId}`
        }))
    ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.sourceId.localeCompare(right.sourceId));

    const gamification = new GamificationService(prisma);
    await gamification.awardAnswers(tx, userId, inputs, true);
    const events = await tx.pointEvent.findMany({
      where: { userId },
      select: { sourceType: true, sourceId: true, points: true }
    });
    const totals = pointTotalsBySource(events);
    for (const [answerId, pointsAwarded] of totals.practice) {
      await tx.practiceAnswer.updateMany({ where: { id: answerId, userId }, data: { pointsAwarded } });
    }
    for (const [examId, pointsAwarded] of totals.exams) {
      await tx.examResult.updateMany({ where: { examId, exam: { userId } }, data: { pointsAwarded } });
    }

    await tx.systemJob.create({
      data: {
        key: userJobKey,
        completedAt: new Date(),
        details: {
          practiceAnswers: practiceAnswers.length,
          examAnswers: examQuestions.length,
          pointEvents: events.length
        }
      }
    });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
}

export async function backfillGamification(prisma: DatabaseClient): Promise<{ usersProcessed: number }> {
  const existing = await prisma.systemJob.findUnique({ where: { key: JOB_KEY } });
  if (existing) return { usersProcessed: 0 };

  const rows = await prisma.$queryRaw<LockRow[]>(Prisma.sql`SELECT GET_LOCK(${LOCK_NAME}, 60) AS acquired`);
  if (Number(rows[0]?.acquired || 0) !== 1) throw new Error("Timed out waiting for the gamification backfill lock");

  try {
    const repeatedCheck = await prisma.systemJob.findUnique({ where: { key: JOB_KEY } });
    if (repeatedCheck) return { usersProcessed: 0 };
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
    let usersProcessed = 0;
    for (const user of users) {
      if (await backfillUser(prisma, user.id)) usersProcessed += 1;
    }
    await prisma.systemJob.upsert({
      where: { key: JOB_KEY },
      update: {},
      create: {
        key: JOB_KEY,
        completedAt: new Date(),
        details: { usersProcessed, usersSeen: users.length }
      }
    });
    await prisma.systemJob.deleteMany({ where: { key: { startsWith: `${JOB_KEY}:` } } });
    return { usersProcessed };
  } finally {
    await prisma.$queryRaw(Prisma.sql`SELECT RELEASE_LOCK(${LOCK_NAME})`);
  }
}
