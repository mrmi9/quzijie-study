import { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, publicAchievement, type AchievementDefinition, type AchievementMetric } from "../domain/achievements.js";
import { NICKNAME_COOLDOWN_MS, normalizeDisplayName, publicCodeFor, shanghaiDayKey, shanghaiPeriod } from "../domain/gamification.js";

type TransactionClient = Prisma.TransactionClient;
type DbClient = DatabaseClient | TransactionClient;
type Period = "daily" | "weekly" | "all";

export interface AwardAnswerInput {
  questionId: string;
  isCorrect: boolean;
  allowCorrectReward?: boolean;
  occurredAt: Date;
  sourceType: "practice" | "exam";
  sourceId: string;
}

export interface AwardResult {
  pointsAwarded: number;
  totalPoints: number;
  unlockedAchievements: Array<ReturnType<typeof publicAchievement>>;
}

type Metrics = Record<AchievementMetric, number>;

function jsonStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function displayIdentity(profile: { publicCode: string; displayName: string | null }) {
  const displayName = profile.displayName || "刷题者";
  return {
    displayName,
    publicCode: profile.publicCode,
    displayLabel: `${displayName}#${profile.publicCode}`
  };
}

function titleView(key: string | null) {
  if (!key) return null;
  const definition = ACHIEVEMENT_BY_KEY.get(key);
  return definition ? publicAchievement(definition) : null;
}

function maxDate(values: Date[]): Date | null {
  if (!values.length) return null;
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

export class GamificationService {
  constructor(private readonly prisma: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  private async ensureProfile(db: DbClient, userId: string) {
    const existing = await db.userGamification.findUnique({ where: { userId } });
    if (existing) return existing;
    for (let salt = 0; salt < 100; salt += 1) {
      await db.$executeRaw(Prisma.sql`
        INSERT IGNORE INTO user_gamification
          (user_id, public_code, total_points, attempted_question_count, correct_question_count, created_at, updated_at)
        VALUES
          (${userId}, ${publicCodeFor(userId, salt)}, 0, 0, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      `);
      const created = await db.userGamification.findUnique({ where: { userId } });
      if (created) return created;
    }
    throw new Error("Unable to allocate a unique public code");
  }

  async initializeUser(userId: string) {
    return this.ensureProfile(this.prisma, userId);
  }

  private async lockProfile(tx: TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT user_id FROM user_gamification WHERE user_id = ${userId} FOR UPDATE`);
  }

  private async metrics(db: DbClient, userId: string): Promise<Metrics> {
    const profile = await this.ensureProfile(db, userId);
    const attemptedEvents = await db.pointEvent.findMany({
      where: { userId, type: "FIRST_ATTEMPT", questionId: { not: null } },
      select: { questionId: true }
    });
    const attemptedIds = attemptedEvents.map((item) => item.questionId).filter((id): id is string => Boolean(id));
    const [subjects, masteredWrong, favorites, completedExams, maxExam] = await Promise.all([
      attemptedIds.length
        ? db.question.findMany({ where: { id: { in: attemptedIds } }, distinct: ["subjectId"], select: { subjectId: true } })
        : Promise.resolve([]),
      db.wrongQuestionRecord.count({ where: { userId, mastered: true } }),
      db.favorite.count({ where: { userId } }),
      db.exam.count({ where: { userId, status: "COMPLETED" } }),
      db.examResult.aggregate({ where: { exam: { userId } }, _max: { score: true } })
    ]);
    return {
      attempted: profile.attemptedQuestionCount,
      correct: profile.correctQuestionCount,
      subjects: subjects.length,
      masteredWrong,
      favorites,
      completedExams,
      maxExamScore: maxExam._max.score || 0
    };
  }

  private progress(definition: AchievementDefinition, metrics: Metrics): number {
    return Math.min(definition.target, metrics[definition.metric] || 0);
  }

  private async evaluateAchievements(tx: TransactionClient, userId: string, unlockedAt: Date, preferHighest = false) {
    const metrics = await this.metrics(tx, userId);
    const existing = await tx.userAchievement.findMany({ where: { userId }, select: { achievementKey: true } });
    const existingKeys = new Set(existing.map((item) => item.achievementKey));
    const unlockedDefinitions = ACHIEVEMENTS.filter((definition) => this.progress(definition, metrics) >= definition.target);
    const newlyUnlocked = unlockedDefinitions.filter((definition) => !existingKeys.has(definition.key));
    if (newlyUnlocked.length) {
      await tx.userAchievement.createMany({
        data: newlyUnlocked.map((definition) => ({ userId, achievementKey: definition.key, unlockedAt })),
        skipDuplicates: true
      });
    }

    const profile = await tx.userGamification.findUniqueOrThrow({ where: { userId } });
    if (!profile.equippedAchievementKey && unlockedDefinitions.length) {
      const selected = preferHighest
        ? unlockedDefinitions.slice().sort((left, right) => right.priority - left.priority)[0]!
        : (newlyUnlocked[0] || unlockedDefinitions[0])!;
      await tx.userGamification.update({ where: { userId }, data: { equippedAchievementKey: selected.key } });
    }
    return newlyUnlocked.map(publicAchievement);
  }

  async awardAnswers(
    tx: TransactionClient,
    userId: string,
    inputs: AwardAnswerInput[],
    preferHighestTitle = false
  ): Promise<AwardResult> {
    if (!inputs.length) {
      await this.ensureProfile(tx, userId);
      await this.lockProfile(tx, userId);
      const profile = await tx.userGamification.findUniqueOrThrow({ where: { userId } });
      const unlockedAchievements = await this.evaluateAchievements(tx, userId, this.now(), preferHighestTitle);
      return { pointsAwarded: 0, totalPoints: profile.totalPoints, unlockedAchievements };
    }
    await this.ensureProfile(tx, userId);
    await this.lockProfile(tx, userId);

    const questionIds = Array.from(new Set(inputs.map((item) => item.questionId)));
    const masteryEvents = await tx.pointEvent.findMany({
      where: { userId, questionId: { in: questionIds }, type: { in: ["FIRST_ATTEMPT", "FIRST_CORRECT"] } },
      select: { questionId: true, type: true }
    });
    const attempted = new Set(masteryEvents.filter((item) => item.type === "FIRST_ATTEMPT").map((item) => item.questionId!));
    const correct = new Set(masteryEvents.filter((item) => item.type === "FIRST_CORRECT").map((item) => item.questionId!));

    const dayPeriods = new Map<string, { start: Date; end: Date; count: number; reviewKeys: Set<string> }>();
    for (const input of inputs) {
      const dayKey = shanghaiDayKey(input.occurredAt);
      if (dayPeriods.has(dayKey)) continue;
      const period = shanghaiPeriod("daily", input.occurredAt);
      const start = period.start!;
      const end = period.end!;
      const reviews = await tx.pointEvent.findMany({
        where: { userId, type: "DAILY_REVIEW", occurredAt: { gte: start, lt: end } },
        select: { eventKey: true }
      });
      dayPeriods.set(dayKey, { start, end, count: reviews.length, reviewKeys: new Set(reviews.map((item) => item.eventKey)) });
    }

    const events: Array<{
      userId: string;
      questionId: string;
      eventKey: string;
      type: "FIRST_ATTEMPT" | "FIRST_CORRECT" | "DAILY_REVIEW";
      points: number;
      occurredAt: Date;
      sourceType: string;
      sourceId: string;
    }> = [];
    let attemptedIncrement = 0;
    let correctIncrement = 0;

    for (const input of inputs.slice().sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())) {
      const hadCorrectBefore = correct.has(input.questionId);
      if (!attempted.has(input.questionId)) {
        attempted.add(input.questionId);
        attemptedIncrement += 1;
        events.push({
          userId,
          questionId: input.questionId,
          eventKey: `attempt:${input.questionId}`,
          type: "FIRST_ATTEMPT",
          points: 2,
          occurredAt: input.occurredAt,
          sourceType: input.sourceType,
          sourceId: input.sourceId
        });
      }
      const rewardCorrect = input.isCorrect && input.allowCorrectReward !== false;
      if (rewardCorrect && !correct.has(input.questionId)) {
        correct.add(input.questionId);
        correctIncrement += 1;
        events.push({
          userId,
          questionId: input.questionId,
          eventKey: `correct:${input.questionId}`,
          type: "FIRST_CORRECT",
          points: 8,
          occurredAt: input.occurredAt,
          sourceType: input.sourceType,
          sourceId: input.sourceId
        });
      } else if (rewardCorrect && hadCorrectBefore) {
        const dayKey = shanghaiDayKey(input.occurredAt);
        const daily = dayPeriods.get(dayKey)!;
        const eventKey = `review:${dayKey}:${input.questionId}`;
        if (daily.count < 20 && !daily.reviewKeys.has(eventKey)) {
          daily.count += 1;
          daily.reviewKeys.add(eventKey);
          events.push({
            userId,
            questionId: input.questionId,
            eventKey,
            type: "DAILY_REVIEW",
            points: 1,
            occurredAt: input.occurredAt,
            sourceType: input.sourceType,
            sourceId: input.sourceId
          });
        }
      }
    }

    const pointsAwarded = events.reduce((sum, event) => sum + event.points, 0);
    if (events.length) await tx.pointEvent.createMany({ data: events, skipDuplicates: true });
    const profile = await tx.userGamification.update({
      where: { userId },
      data: {
        totalPoints: { increment: pointsAwarded },
        attemptedQuestionCount: { increment: attemptedIncrement },
        correctQuestionCount: { increment: correctIncrement },
        ...(pointsAwarded ? { pointsUpdatedAt: maxDate(events.map((event) => event.occurredAt)) } : {})
      }
    });
    const unlockedAchievements = await this.evaluateAchievements(
      tx,
      userId,
      maxDate(inputs.map((item) => item.occurredAt)) || this.now(),
      preferHighestTitle
    );
    return { pointsAwarded, totalPoints: profile.totalPoints, unlockedAchievements };
  }

  async reconcileUser(userId: string, preferHighest = false) {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProfile(tx, userId);
      await this.lockProfile(tx, userId);
      return this.evaluateAchievements(tx, userId, this.now(), preferHighest);
    });
  }

  private async scoreRows(period: Period) {
    const window = shanghaiPeriod(period, this.now());
    if (period === "all") {
      const profiles = await this.prisma.userGamification.findMany({ where: { totalPoints: { gt: 0 } } });
      return profiles.map((profile) => ({ profile, points: profile.totalPoints, reachedAt: profile.pointsUpdatedAt }));
    }
    const rows = await this.prisma.pointEvent.groupBy({
      by: ["userId"],
      where: { occurredAt: { gte: window.start!, lt: window.end! } },
      _sum: { points: true },
      _max: { occurredAt: true }
    });
    const profiles = await this.prisma.userGamification.findMany({ where: { userId: { in: rows.map((row) => row.userId) } } });
    const profileById = new Map(profiles.map((profile) => [profile.userId, profile]));
    return rows.map((row) => ({ profile: profileById.get(row.userId)!, points: row._sum.points || 0, reachedAt: row._max.occurredAt }))
      .filter((row) => row.profile && row.points > 0);
  }

  async leaderboard(userId: string, period: Period, limit = 100) {
    if (!["daily", "weekly", "all"].includes(period)) throw new AppError("排行榜周期无效", "INVALID_LEADERBOARD_PERIOD", 400);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
    await this.ensureProfile(this.prisma, userId);
    const rows = await this.scoreRows(period);
    rows.sort((left, right) => right.points - left.points
      || (left.reachedAt?.getTime() || Number.MAX_SAFE_INTEGER) - (right.reachedAt?.getTime() || Number.MAX_SAFE_INTEGER)
      || left.profile.publicCode.localeCompare(right.profile.publicCode));
    const ranked = rows.map((row, index) => ({
      rank: index + 1,
      points: row.points,
      ...displayIdentity(row.profile),
      title: titleView(row.profile.equippedAchievementKey),
      isCurrentUser: row.profile.userId === userId
    }));
    const profile = await this.prisma.userGamification.findUniqueOrThrow({ where: { userId } });
    const current = ranked.find((item) => item.isCurrentUser) || {
      rank: null,
      points: 0,
      ...displayIdentity(profile),
      title: titleView(profile.equippedAchievementKey),
      isCurrentUser: true
    };
    const window = shanghaiPeriod(period, this.now());
    const items = ranked.slice(0, safeLimit);
    return {
      period,
      startsAt: window.start?.toISOString() || null,
      endsAt: window.end?.toISOString() || null,
      items,
      podium: items.slice(0, 3),
      rankings: items.slice(3),
      currentUser: current
    };
  }

  async getMe(userId: string) {
    await this.reconcileUser(userId);
    const profile = await this.prisma.userGamification.findUniqueOrThrow({ where: { userId } });
    const [daily, weekly, total, achievements] = await Promise.all([
      this.leaderboard(userId, "daily", 1),
      this.leaderboard(userId, "weekly", 1),
      this.leaderboard(userId, "all", 1),
      this.prisma.userAchievement.count({ where: { userId } })
    ]);
    return {
      identity: displayIdentity(profile),
      nicknameUpdatedAt: profile.nicknameUpdatedAt?.toISOString() || null,
      nextRenameAt: profile.nicknameUpdatedAt ? new Date(profile.nicknameUpdatedAt.getTime() + NICKNAME_COOLDOWN_MS).toISOString() : null,
      points: { total: profile.totalPoints, today: daily.currentUser.points, thisWeek: weekly.currentUser.points },
      ranks: { daily: daily.currentUser.rank, weekly: weekly.currentUser.rank, all: total.currentUser.rank },
      attemptedQuestionCount: profile.attemptedQuestionCount,
      correctQuestionCount: profile.correctQuestionCount,
      equippedTitle: titleView(profile.equippedAchievementKey),
      unlockedCount: achievements,
      totalAchievements: ACHIEVEMENTS.length
    };
  }

  async updateDisplayName(userId: string, rawName: unknown) {
    const displayName = normalizeDisplayName(rawName);
    const now = this.now();
    const profile = await this.prisma.$transaction(async (tx) => {
      await this.ensureProfile(tx, userId);
      await this.lockProfile(tx, userId);
      const current = await tx.userGamification.findUniqueOrThrow({ where: { userId } });
      if (current.nicknameUpdatedAt) {
        const nextAllowedAt = new Date(current.nicknameUpdatedAt.getTime() + NICKNAME_COOLDOWN_MS);
        if (nextAllowedAt > now) throw new AppError("昵称每 30 天只能修改一次", "NICKNAME_COOLDOWN", 429, { nextAllowedAt: nextAllowedAt.toISOString() });
      }
      return tx.userGamification.update({ where: { userId }, data: { displayName, nicknameUpdatedAt: now } });
    });
    return { ...displayIdentity(profile), nicknameUpdatedAt: profile.nicknameUpdatedAt?.toISOString() || null, nextRenameAt: new Date(now.getTime() + NICKNAME_COOLDOWN_MS).toISOString() };
  }

  async getAchievements(userId: string) {
    await this.reconcileUser(userId);
    const [profile, metrics, unlocked] = await Promise.all([
      this.prisma.userGamification.findUniqueOrThrow({ where: { userId } }),
      this.metrics(this.prisma, userId),
      this.prisma.userAchievement.findMany({ where: { userId } })
    ]);
    const unlockedByKey = new Map(unlocked.map((item) => [item.achievementKey, item]));
    return {
      unlockedCount: unlocked.length,
      totalCount: ACHIEVEMENTS.length,
      equippedAchievementKey: profile.equippedAchievementKey,
      items: ACHIEVEMENTS.map((definition) => {
        const record = unlockedByKey.get(definition.key);
        const progress = this.progress(definition, metrics);
        return {
          ...publicAchievement(definition),
          target: definition.target,
          progress,
          progressPercent: Math.round((progress / definition.target) * 100),
          unlocked: Boolean(record),
          unlockedAt: record?.unlockedAt.toISOString() || null,
          equipped: profile.equippedAchievementKey === definition.key
        };
      })
    };
  }

  async equipTitle(userId: string, achievementKey: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureProfile(tx, userId);
      await this.lockProfile(tx, userId);
      if (achievementKey) {
        if (!ACHIEVEMENT_BY_KEY.has(achievementKey)) throw new AppError("称号不存在", "ACHIEVEMENT_NOT_FOUND", 404);
        const unlocked = await tx.userAchievement.findUnique({ where: { userId_achievementKey: { userId, achievementKey } } });
        if (!unlocked) throw new AppError("该称号尚未解锁", "ACHIEVEMENT_LOCKED", 409);
      }
      const profile = await tx.userGamification.update({ where: { userId }, data: { equippedAchievementKey: achievementKey } });
      return { equippedTitle: titleView(profile.equippedAchievementKey) };
    });
  }
}

export function unlockedKeys(value: Prisma.JsonValue): string[] {
  return jsonStrings(value);
}
