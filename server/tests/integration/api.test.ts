import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createPrismaClient, type DatabaseClient } from "../../src/db.js";
import type { WechatAuthProvider } from "../../src/auth/wechat.js";
import { importQuestions } from "../../src/scripts/import-questions.js";
import type { QuestionSnapshot } from "../../src/domain/questions.js";
import { GamificationService } from "../../src/services/gamification.js";
import { backfillGamification } from "../../src/scripts/backfill-gamification.js";
import { markDatabaseBootstrapPending, markDatabaseBootstrapReady } from "../../src/bootstrap-state.js";

let prisma: DatabaseClient;
let app: FastifyInstance;

const wechatProvider: WechatAuthProvider = {
  async exchangeCode(code: string) {
    return { openId: `integration-${code}` };
  }
};

async function login(code: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/wechat/login",
    payload: { code }
  });
  assert.equal(response.statusCode, 200);
  return response.json().data as { accessToken: string; refreshToken: string; user: { id: string } };
}

function authorization(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

before(async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("缺少 TEST_DATABASE_URL");
  prisma = createPrismaClient(testUrl);
  await prisma.systemJob.deleteMany();
  await prisma.user.deleteMany();
  const contentDirectory = fileURLToPath(new URL("../../../../content", import.meta.url)).replaceAll("\\", "/");
  await importQuestions(prisma, contentDirectory);
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: testUrl,
    JWT_ACCESS_SECRET: "integration-test-secret-at-least-thirty-two-characters",
    WECHAT_AUTH_MODE: "stub"
  });
  app = await buildApp({ config, prisma, wechatProvider });
});

after(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

describe("真实 MySQL API 闭环", () => {
  it("健康检查和500题导入正常", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    markDatabaseBootstrapPending();
    const pending = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(pending.statusCode, 503);
    assert.equal(pending.json().code, "SERVICE_BOOTSTRAPPING");
    markDatabaseBootstrapReady();
    const readiness = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().data.database, "ok");
    assert.equal(await prisma.question.count(), 500);
    assert.equal(await prisma.question.count({ where: { subjectId: "cpp" } }), 100);
  });

  it("云托管身份头完成登录、删除和重新开户，并拒绝缺少可信来源的请求", async () => {
    const cloudConfig = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      WECHAT_AUTH_MODE: "cloud"
    });
    const cloudApp = await buildApp({ config: cloudConfig, prisma });
    const headers = {
      "x-wx-source": "wx_client",
      "x-wx-openid": "integration-cloud-user"
    };
    try {
      const missingSource = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers: { "x-wx-openid": headers["x-wx-openid"] }
      });
      assert.equal(missingSource.statusCode, 401);
      assert.equal(missingSource.json().code, "CLOUD_IDENTITY_MISSING");

      const loggedIn = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers
      });
      assert.equal(loggedIn.statusCode, 200, loggedIn.body);
      assert.equal(loggedIn.json().data.authenticated, true);

      const me = await cloudApp.inject({ method: "GET", url: "/api/v1/users/me", headers });
      assert.equal(me.statusCode, 200, me.body);
      assert.equal(me.json().data.id, loggedIn.json().data.user.id);

      const deleted = await cloudApp.inject({ method: "DELETE", url: "/api/v1/users/me", headers });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.equal(deleted.json().data.deleted, true);

      const afterDelete = await cloudApp.inject({ method: "GET", url: "/api/v1/users/me", headers });
      assert.equal(afterDelete.statusCode, 401, afterDelete.body);
      assert.equal(afterDelete.json().code, "UNAUTHORIZED");

      const reloggedIn = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers
      });
      assert.equal(reloggedIn.statusCode, 200, reloggedIn.body);
      assert.notEqual(reloggedIn.json().data.user.id, loggedIn.json().data.user.id);
    } finally {
      await cloudApp.close();
    }
  });

  it("刷新令牌只能轮换使用一次", async () => {
    const user = await login("refresh-user");
    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(refreshed.statusCode, 200);
    assert.notEqual(refreshed.json().data.refreshToken, user.refreshToken);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().code, "UNAUTHORIZED");
  });

  it("历史回填重建积分、成就与默认称号，并可安全重复执行", async () => {
    const owner = await login("gamification-backfill-owner");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { subject: "cpp", mode: "random", count: 5 }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().data.id as string;
    const item = await prisma.practiceSessionQuestion.findFirstOrThrow({ where: { sessionId }, orderBy: { position: "asc" } });
    const snapshot = item.snapshot as unknown as QuestionSnapshot;
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${sessionId}/answers`,
      headers: authorization(owner.accessToken),
      payload: {
        questionId: item.questionId,
        selectedOptionIds: snapshot.correctOptionIds,
        clientAnswerId: `backfill-${sessionId}`
      }
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    const answerId = (await prisma.practiceAnswer.findFirstOrThrow({ where: { sessionId } })).id;
    await prisma.pointEvent.deleteMany({ where: { userId: owner.user.id } });
    await prisma.userAchievement.deleteMany({ where: { userId: owner.user.id } });
    await prisma.userGamification.delete({ where: { userId: owner.user.id } });
    await prisma.practiceAnswer.update({ where: { id: answerId }, data: { pointsAwarded: 0, unlockedAchievements: [] } });

    const firstRun = await backfillGamification(prisma);
    assert(firstRun.usersProcessed >= 1);
    const profile = await prisma.userGamification.findUniqueOrThrow({ where: { userId: owner.user.id } });
    assert.equal(profile.totalPoints, 10);
    assert.equal(profile.equippedAchievementKey, "first-step");
    assert.equal((await prisma.practiceAnswer.findUniqueOrThrow({ where: { id: answerId } })).pointsAwarded, 10);
    const eventCount = await prisma.pointEvent.count({ where: { userId: owner.user.id } });
    assert.deepEqual(await backfillGamification(prisma), { usersProcessed: 0 });
    assert.equal(await prisma.pointEvent.count({ where: { userId: owner.user.id } }), eventCount);
  });

  it("删除账户会级联清除数据并立即使全部令牌失效", async () => {
    const user = await login("delete-account-user");
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/users/me",
      headers: authorization(user.accessToken)
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().data.deleted, true);
    assert.equal(await prisma.user.count({ where: { id: user.user.id } }), 0);

    const accessReplay = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: authorization(user.accessToken)
    });
    assert.equal(accessReplay.statusCode, 401);
    assert.equal(accessReplay.json().code, "UNAUTHORIZED");

    const refreshReplay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(refreshReplay.statusCode, 401);
    assert.equal(refreshReplay.json().code, "UNAUTHORIZED");
  });

  it("408题池不足时不创建任何试卷", async () => {
    const candidates = await prisma.question.findMany({
      where: { subjectId: "ds", status: "ACTIVE", currentVersion: { is: { type: "SINGLE" } } },
      include: { currentVersion: true }
    });
    const eligible = candidates.filter((question) => {
      const scopes = question.currentVersion?.examScopes;
      return Array.isArray(scopes) && scopes.map(String).includes("408");
    });
    assert(eligible.length >= 12);
    const disabledIds = eligible.slice(11).map((question) => question.id);
    await prisma.question.updateMany({ where: { id: { in: disabledIds } }, data: { status: "DISABLED" } });
    try {
      const owner = await login("insufficient-exam-owner");
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/exams",
        headers: authorization(owner.accessToken),
        payload: { type: "postgraduate-408-objective" }
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "EXAM_POOL_INSUFFICIENT");
      assert.equal(await prisma.exam.count({ where: { userId: owner.user.id } }), 0);
    } finally {
      await prisma.question.updateMany({ where: { id: { in: disabledIds } }, data: { status: "ACTIVE" } });
    }
  });

  it("完成C/C++创建、判题、幂等、隔离、交卷和恢复", async () => {
    const owner = await login("owner");
    const stranger = await login("stranger");
    const chapters = await app.inject({
      method: "GET",
      url: "/api/v1/subjects/cpp/chapters",
      headers: authorization(owner.accessToken)
    });
    assert.equal(chapters.statusCode, 200);
    assert.equal(chapters.json().data.length, 9);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { subject: "cpp", mode: "random", count: 5 }
    });
    assert.equal(created.statusCode, 200);
    const session = created.json().data as { id: string; questions: Array<Record<string, unknown>>; totalCount: number };
    assert.equal(session.totalCount, 5);
    assert.equal(new Set(session.questions.map((question) => question.id)).size, 5);
    session.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(stranger.accessToken)
    });
    assert.equal(forbidden.statusCode, 404);

    const storedQuestions = await prisma.practiceSessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { position: "asc" }
    });
    for (let index = 0; index < storedQuestions.length; index += 1) {
      const item = storedQuestions[index]!;
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const payload = {
        questionId: item.questionId,
        selectedOptionIds: snapshot.correctOptionIds,
        clientAnswerId: `integration-${session.id}-${index}`
      };
      if (index === 1) {
        const reusedKey = await app.inject({
          method: "POST",
          url: `/api/v1/practice-sessions/${session.id}/answers`,
          headers: authorization(owner.accessToken),
          payload: { ...payload, clientAnswerId: `integration-${session.id}-0` }
        });
        assert.equal(reusedKey.statusCode, 409);
        assert.equal(reusedKey.json().code, "IDEMPOTENCY_KEY_REUSED");
      }
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/practice-sessions/${session.id}/answers`,
        headers: authorization(owner.accessToken),
        payload
      });
      assert.equal(submitted.statusCode, 200);
      assert.equal(submitted.json().data.isCorrect, true);
      assert.equal(submitted.json().data.pointsAwarded, 10);
      if (index === 0) {
        const repeated = await app.inject({
          method: "POST",
          url: `/api/v1/practice-sessions/${session.id}/answers`,
          headers: authorization(owner.accessToken),
          payload
        });
        assert.equal(repeated.statusCode, 200);
        assert.deepEqual(repeated.json().data, submitted.json().data);
      }
    }
    assert.equal(await prisma.practiceAnswer.count({ where: { sessionId: session.id } }), 5);

    const gamificationMe = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/me",
      headers: authorization(owner.accessToken)
    });
    assert.equal(gamificationMe.statusCode, 200, gamificationMe.body);
    assert.equal(gamificationMe.json().data.points.total, 50);
    assert.match(gamificationMe.json().data.identity.displayLabel, /^刷题者#[23456789A-HJ-NP-Z]{4}$/);

    const nickname = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/profile",
      headers: authorization(owner.accessToken),
      payload: { displayName: "集成测试者" }
    });
    assert.equal(nickname.statusCode, 200, nickname.body);
    assert.match(nickname.json().data.displayLabel, /^集成测试者#/);
    const nicknameCooldown = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/profile",
      headers: authorization(owner.accessToken),
      payload: { displayName: "再次修改" }
    });
    assert.equal(nicknameCooldown.statusCode, 429, nicknameCooldown.body);
    assert.equal(nicknameCooldown.json().code, "NICKNAME_COOLDOWN");

    const achievements = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/achievements",
      headers: authorization(owner.accessToken)
    });
    assert.equal(achievements.statusCode, 200, achievements.body);
    assert.equal(achievements.json().data.items.length, 12);
    assert.equal(achievements.json().data.items.find((item: { key: string }) => item.key === "first-step").unlocked, true);
    const leaderboard = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/leaderboard?period=all&limit=100",
      headers: authorization(owner.accessToken)
    });
    assert.equal(leaderboard.statusCode, 200, leaderboard.body);
    assert.equal(leaderboard.json().data.currentUser.points, 50);
    assert.equal(leaderboard.json().data.currentUser.userId, undefined);
    assert.equal(leaderboard.json().data.currentUser.openId, undefined);

    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken),
      payload: {}
    });
    assert.equal(finished.statusCode, 200);
    assert.equal(finished.json().data.correctCount, 5);
    const repeatedFinish = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken)
    });
    assert.deepEqual(repeatedFinish.json().data, finished.json().data);

    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().data.status, "completed");
  });

  it("全局收藏支持固定题量、全部题量、跨学科快照和分学科结果", async () => {
    const owner = await login("global-favorite-owner");
    const favoriteGroups = await Promise.all(["cpp", "linux", "ds"].map((subjectId) => prisma.question.findMany({
      where: { subjectId, status: "ACTIVE", currentVersionId: { not: null } },
      orderBy: { id: "asc" },
      take: 9,
      select: { id: true, subjectId: true }
    })));
    const favoriteQuestions = favoriteGroups.flat();
    assert.equal(favoriteQuestions.length, 27);
    await prisma.favorite.createMany({
      data: favoriteQuestions.map((question) => ({ userId: owner.user.id, questionId: question.id }))
    });

    for (const count of [5, 10, 20] as const) {
      const fixed = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(owner.accessToken),
        payload: { scope: "all", mode: "favorite", count }
      });
      assert.equal(fixed.statusCode, 200, fixed.body);
      assert.equal(fixed.json().data.scope, "all");
      assert.equal(fixed.json().data.subjectId, null);
      assert.equal(fixed.json().data.subject, null);
      assert.equal(fixed.json().data.totalCount, count);
      assert.equal(new Set(fixed.json().data.questions.map((question: { id: string }) => question.id)).size, count);
    }

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { scope: "all", mode: "favorite", count: "all" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const session = created.json().data as {
      id: string;
      scope: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      questions: Array<{ id: string; subjectId: string } & Record<string, unknown>>;
    };
    assert.equal(session.scope, "all");
    assert.equal(session.subjectId, null);
    assert.equal(session.subject, null);
    assert.equal(session.totalCount, favoriteQuestions.length);
    assert.equal(new Set(session.questions.map((question) => question.id)).size, favoriteQuestions.length);
    assert.deepEqual(
      new Set(session.questions.map((question) => question.id)),
      new Set(favoriteQuestions.map((question) => question.id))
    );
    assert.equal(new Set(session.questions.map((question) => question.subjectId)).size, 3);
    session.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });

    const storedSession = await prisma.practiceSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(storedSession.subjectId, null);
    assert.equal(storedSession.chapterId, null);
    assert.equal(storedSession.requestedCount, favoriteQuestions.length);

    const learningOverview = await app.inject({
      method: "GET",
      url: "/api/v1/learning/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(learningOverview.json().data.activeSession.id, session.id);
    assert.equal(learningOverview.json().data.activeSession.scope, "all");
    assert.equal(learningOverview.json().data.activeSession.subjectId, null);
    assert.equal(learningOverview.json().data.activeSession.subject, null);
    const subjectOverview = await app.inject({
      method: "GET",
      url: "/api/v1/subjects/cpp/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(subjectOverview.json().data.activeSession, null);

    await prisma.favorite.delete({
      where: { userId_questionId: { userId: owner.user.id, questionId: favoriteQuestions[0]!.id } }
    });
    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.totalCount, favoriteQuestions.length);

    const storedQuestions = await prisma.practiceSessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { position: "asc" }
    });
    for (let index = 0; index < storedQuestions.length; index += 1) {
      const item = storedQuestions[index]!;
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/practice-sessions/${session.id}/answers`,
        headers: authorization(owner.accessToken),
        payload: {
          questionId: item.questionId,
          selectedOptionIds: snapshot.correctOptionIds,
          clientAnswerId: `global-favorite-${session.id}-${index}`
        }
      });
      assert.equal(submitted.statusCode, 200, submitted.body);
    }
    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(finished.statusCode, 200, finished.body);
    const result = finished.json().data as {
      scope: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      correctCount: number;
      subjects: Array<{ subjectId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
      chapters: Array<{ subjectId: string; chapterId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
    };
    assert.equal(result.scope, "all");
    assert.equal(result.subjectId, null);
    assert.equal(result.subject, null);
    assert.equal(result.correctCount, result.totalCount);
    assert.deepEqual(result.subjects.map((subject) => subject.subjectId), ["cpp", "linux", "ds"]);
    assert.equal(result.subjects.reduce((sum, subject) => sum + subject.totalCount, 0), result.totalCount);
    assert(result.subjects.every((subject) => subject.correctCount === subject.totalCount
      && subject.wrongCount === 0 && subject.accuracy === 100));
    assert(result.chapters.every((chapter) => chapter.subjectId
      && chapter.correctCount === chapter.totalCount && chapter.wrongCount === 0 && chapter.accuracy === 100));
  });

  it("全局收藏严格拒绝非法组合，并在空题池或题量不足时给出稳定结果", async () => {
    const emptyOwner = await login("global-favorite-empty-owner");
    const empty = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(emptyOwner.accessToken),
      payload: { scope: "all", mode: "favorite", count: "all" }
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().code, "EMPTY_QUESTION_POOL");

    const invalidCases = [
      { payload: { scope: "all", mode: "random", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", subject: "cpp", mode: "favorite", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", mode: "favorite", chapterId: "cpp-basics", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "subject", mode: "favorite", count: 5 }, code: "SUBJECT_REQUIRED" },
      { payload: { subject: "cpp", mode: "favorite", count: "all" }, code: "INVALID_COUNT" },
      { payload: { subject: "cpp", mode: "random", chapterId: "cpp-basics", count: 5 }, code: "CHAPTER_NOT_ALLOWED" }
    ];
    for (const invalidCase of invalidCases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(emptyOwner.accessToken),
        payload: invalidCase.payload
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, invalidCase.code);
    }
    for (const payload of [
      { scope: "group", mode: "favorite", count: 5 },
      { scope: "all", mode: "favorite", count: 7 }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(emptyOwner.accessToken),
        payload
      });
      assert.equal(response.statusCode, 400, response.body);
    }

    const sparseOwner = await login("global-favorite-sparse-owner");
    const sparseQuestions = await prisma.question.findMany({
      where: { subjectId: { in: ["cpp", "ds"] }, status: "ACTIVE", currentVersionId: { not: null } },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true }
    });
    await prisma.favorite.createMany({
      data: sparseQuestions.map((question) => ({ userId: sparseOwner.user.id, questionId: question.id }))
    });
    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(sparseOwner.accessToken),
      payload: { scope: "all", mode: "favorite", count: 20 }
    });
    assert.equal(capped.statusCode, 200, capped.body);
    assert.equal(capped.json().data.totalCount, sparseQuestions.length);
  });

  it("积分流水在并发、每日上限和普通练习/408共享题目时保持幂等", async () => {
    const questions = await prisma.question.findMany({ orderBy: { id: "asc" }, take: 21, select: { id: true } });
    assert.equal(questions.length, 21);
    const concurrentUser = await prisma.user.create({ data: { wechatOpenId: "gamification-concurrent", lastLoginAt: new Date() } });
    const concurrentService = new GamificationService(prisma, () => new Date("2026-07-16T02:00:00.000Z"));
    const concurrent = await Promise.allSettled(Array.from({ length: 3 }, (_, index) => prisma.$transaction((tx) => concurrentService.awardAnswers(tx, concurrentUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-16T01:00:00.000Z"),
      sourceType: "practice",
      sourceId: `concurrent-${index}`
    }]))));
    assert(concurrent.some((result) => result.status === "fulfilled"));
    assert.equal(await prisma.pointEvent.count({ where: { userId: concurrentUser.id } }), 2);
    assert.equal((await prisma.userGamification.findUniqueOrThrow({ where: { userId: concurrentUser.id } })).totalPoints, 10);

    const cappedUser = await prisma.user.create({ data: { wechatOpenId: "gamification-cap", lastLoginAt: new Date() } });
    const service = new GamificationService(prisma);
    await prisma.$transaction((tx) => service.awardAnswers(tx, cappedUser.id, questions.map((question, index) => ({
      questionId: question.id,
      isCorrect: true,
      occurredAt: new Date(`2026-07-15T01:${String(index).padStart(2, "0")}:00.000Z`),
      sourceType: "practice" as const,
      sourceId: `first-${question.id}`
    }))));
    const reviews = await prisma.$transaction((tx) => service.awardAnswers(tx, cappedUser.id, questions.map((question, index) => ({
      questionId: question.id,
      isCorrect: true,
      occurredAt: new Date(`2026-07-16T01:${String(index).padStart(2, "0")}:00.000Z`),
      sourceType: "exam" as const,
      sourceId: `review-${question.id}`
    }))));
    assert.equal(reviews.pointsAwarded, 20);
    assert.equal(await prisma.pointEvent.count({ where: { userId: cappedUser.id, type: "DAILY_REVIEW" } }), 20);

    const sharedUser = await prisma.user.create({ data: { wechatOpenId: "gamification-shared", lastLoginAt: new Date() } });
    const practiceReward = await prisma.$transaction((tx) => service.awardAnswers(tx, sharedUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-15T01:00:00.000Z"),
      sourceType: "practice",
      sourceId: "shared-practice"
    }]));
    const examReward = await prisma.$transaction((tx) => service.awardAnswers(tx, sharedUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-16T01:00:00.000Z"),
      sourceType: "exam",
      sourceId: "shared-exam"
    }]));
    assert.equal(practiceReward.pointsAwarded, 10);
    assert.equal(examReward.pointsAwarded, 1);
    await prisma.user.delete({ where: { id: sharedUser.id } });
    assert.equal(await prisma.userGamification.count({ where: { userId: sharedUser.id } }), 0);
    assert.equal(await prisma.pointEvent.count({ where: { userId: sharedUser.id } }), 0);
    assert.equal(await prisma.userAchievement.count({ where: { userId: sharedUser.id } }), 0);
  });

  it("完成408组卷、整份草稿、隔离、统计、快照和幂等交卷", async () => {
    const owner = await login("exam-owner");
    const stranger = await login("exam-stranger");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const exam = created.json().data as {
      id: string;
      status: string;
      totalCount: number;
      questions: Array<{ id: string; subjectId: string; type: string; options: Array<{ id: string }> } & Record<string, unknown>>;
      answers: Record<string, string[]>;
      expiresAt: number;
    };
    assert.equal(exam.status, "active");
    assert.equal(exam.totalCount, 40);
    assert.equal(typeof exam.expiresAt, "number");
    assert.equal(new Set(exam.questions.map((question) => question.id)).size, 40);
    assert(exam.questions.every((question) => question.type === "single"));
    exam.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });
    const distribution = exam.questions.reduce<Record<string, number>>((result, question) => {
      result[question.subjectId] = (result[question.subjectId] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(distribution, { ds: 12, co: 12, os: 9, network: 7 });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, "ACTIVE_EXAM_EXISTS");

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${exam.id}`,
      headers: authorization(stranger.accessToken)
    });
    assert.equal(forbidden.statusCode, 404);
    assert.equal(forbidden.json().code, "EXAM_NOT_FOUND");

    const stored = await prisma.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { position: "asc" } });
    const first = stored[0]!;
    const second = stored[1]!;
    const firstSnapshot = first.snapshot as unknown as QuestionSnapshot;
    const secondSnapshot = second.snapshot as unknown as QuestionSnapshot;
    const wrongSecond = secondSnapshot.options.find((option) => !secondSnapshot.correctOptionIds.includes(option.id))!.id;
    const invalidDraft = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: ["Z"] } }
    });
    assert.equal(invalidDraft.statusCode, 400);
    assert.equal(invalidDraft.json().code, "INVALID_OPTION");
    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: firstSnapshot.correctOptionIds, [second.questionId]: [wrongSecond] } }
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.answeredCount, 2);

    const replaced = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: firstSnapshot.correctOptionIds } }
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal(replaced.json().data.answeredCount, 1);
    assert.equal(replaced.json().data.answers[second.questionId], undefined);

    const submissions = await Promise.all(Array.from({ length: 3 }, () => app.inject({
      method: "POST",
      url: `/api/v1/exams/${exam.id}/submit`,
      headers: authorization(owner.accessToken)
    })));
    submissions.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    const result = submissions[0]!.json().data;
    submissions.slice(1).forEach((response) => assert.deepEqual(response.json().data, result));
    assert.equal(result.totalCount, 40);
    assert.equal(result.answeredCount, 1);
    assert.equal(result.correctCount, 1);
    assert.equal(result.wrongCount, 39);
    assert.equal(result.score, 2);
    assert.equal(result.maxScore, 80);
    assert.equal(result.reviews.length, 40);
    assert.equal(result.subjects.length, 4);
    assert.equal(await prisma.examResult.count({ where: { examId: exam.id } }), 1);
    assert.equal(await prisma.wrongQuestionRecord.count({ where: { userId: owner.user.id } }), 39);

    const originalStem = result.reviews[0].question.stem;
    const version = await prisma.questionVersion.findUniqueOrThrow({ where: { id: first.questionVersionId } });
    await prisma.questionVersion.update({ where: { id: version.id }, data: { stem: "已修改但不应影响历史试卷" } });
    const frozen = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${exam.id}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(frozen.statusCode, 200);
    assert.equal(frozen.json().data.reviews[0].question.stem, originalStem);
    await prisma.questionVersion.update({ where: { id: version.id }, data: { stem: version.stem } });

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/exams?type=postgraduate-408-objective",
      headers: authorization(owner.accessToken)
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().data[0].score, 2);
    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/learning/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().data.totalAttempts, 40);
    assert.equal(overview.json().data.attemptedCount, 40);
  });

  it("408到期恢复会自动交卷且重复恢复不重复统计", async () => {
    const owner = await login("expired-exam-owner");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const examId = created.json().data.id as string;
    const firstQuestion = created.json().data.questions[0] as { id: string; options: Array<{ id: string }> };
    await prisma.exam.update({ where: { id: examId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredSave = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${examId}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [firstQuestion.id]: [firstQuestion.options[0]!.id] } }
    });
    assert.equal(expiredSave.statusCode, 200, expiredSave.body);
    assert.equal(expiredSave.json().data.submitReason, "expired");
    assert.equal(expiredSave.json().data.score, 0);
    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${examId}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.status, "completed");
    const result = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${examId}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().data.answeredCount, 0);
    assert.equal(result.json().data.score, 0);
    assert.equal(result.json().data.submitReason, "expired");
    await app.inject({ method: "GET", url: `/api/v1/exams/${examId}`, headers: authorization(owner.accessToken) });
    assert.equal(await prisma.examResult.count({ where: { examId } }), 1);
    const overview = await app.inject({ method: "GET", url: "/api/v1/learning/overview", headers: authorization(owner.accessToken) });
    assert.equal(overview.json().data.totalAttempts, 40);
  });
});
