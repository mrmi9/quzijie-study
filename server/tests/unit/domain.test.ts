import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.js";
import { publicQuestion, sameAnswer, validateSelection, type QuestionSnapshot } from "../../src/domain/questions.js";
import { createWechatAuthProvider } from "../../src/auth/wechat.js";

const snapshot: QuestionSnapshot = {
  id: "cpp001",
  subjectId: "cpp",
  chapterId: "c-basics",
  chapterName: "C 基础与运算",
  type: "multiple",
  stem: "测试题干",
  code: "",
  images: [],
  options: [
    { id: "A", label: "A", text: "选项 A" },
    { id: "B", label: "B", text: "选项 B" },
    { id: "C", label: "C", text: "选项 C" }
  ],
  correctOptionIds: ["A", "C"],
  explanation: "测试解析",
  difficulty: 1,
  tags: ["测试"],
  version: 1
};

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused",
    JWT_ACCESS_SECRET: "12345678901234567890123456789012",
    WECHAT_AUTH_MODE: "stub",
    WECHAT_DEV_OPENID: "unit-openid"
  };
}

describe("题目领域规则", () => {
  it("答案比较忽略顺序但不忽略缺项", () => {
    assert.equal(sameAnswer(["C", "A"], ["A", "C"]), true);
    assert.equal(sameAnswer(["A"], ["A", "C"]), false);
  });

  it("待答题视图不会泄露答案和解析", () => {
    const view = publicQuestion(snapshot, false) as Record<string, unknown>;
    assert.equal(view.correctOptionIds, undefined);
    assert.equal(view.explanation, undefined);
    assert.equal(view.isFavorite, false);
  });

  it("校验选项存在性和单选数量", () => {
    assert.deepEqual(validateSelection(snapshot, ["C", "A"]), ["A", "C"]);
    assert.throws(() => validateSelection({ ...snapshot, type: "single" }, ["A", "B"]), /INVALID_OPTION/);
    assert.throws(() => validateSelection(snapshot, ["X"]), /INVALID_OPTION/);
  });
});

describe("配置与微信适配器", () => {
  it("生产环境禁止 Stub 登录", () => {
    assert.throws(() => loadConfig({ ...baseEnv(), NODE_ENV: "production" }), /生产环境禁止/);
  });

  it("真实模式缺少凭据时拒绝启动", () => {
    assert.throws(() => loadConfig({ ...baseEnv(), WECHAT_AUTH_MODE: "real" }), /WECHAT_APP_ID/);
  });

  it("开发 Stub 始终映射到受控 OpenID", async () => {
    const config = loadConfig(baseEnv());
    const provider = createWechatAuthProvider(config);
    assert.deepEqual(await provider.exchangeCode("temporary-code"), { openId: "unit-openid" });
  });
});
