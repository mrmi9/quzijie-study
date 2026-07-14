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
});
