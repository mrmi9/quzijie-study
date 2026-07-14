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

describe("真实 PostgreSQL API 闭环", () => {
  it("健康检查和500题导入正常", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    const readiness = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().data.database, "ok");
    assert.equal(await prisma.question.count(), 500);
    assert.equal(await prisma.question.count({ where: { subjectId: "cpp" } }), 100);
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
