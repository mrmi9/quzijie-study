import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.js";
import { publicQuestion, sameAnswer, validateSelection, type QuestionSnapshot } from "../../src/domain/questions.js";
import { createWechatAuthProvider } from "../../src/auth/wechat.js";
import { ACHIEVEMENTS } from "../../src/domain/achievements.js";
import { normalizeDisplayName, publicCodeFor, shanghaiDayKey, shanghaiPeriod } from "../../src/domain/gamification.js";

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
    DATABASE_URL: "mysql://unused:unused@localhost:3306/unused",
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

  it("生产环境拒绝弱 JWT 密钥", () => {
    assert.throws(() => loadConfig({
      ...baseEnv(),
      NODE_ENV: "production",
      WECHAT_AUTH_MODE: "real",
      WECHAT_APP_ID: "unit-app-id",
      WECHAT_APP_SECRET: "unit-app-secret",
      JWT_ACCESS_SECRET: "change-me-change-me-change-me-change-me"
    }), /强度不足/);
  });

  it("开发 Stub 始终映射到受控 OpenID", async () => {
    const config = loadConfig(baseEnv());
    const provider = createWechatAuthProvider(config);
    assert.deepEqual(await provider.exchangeCode("temporary-code"), { openId: "unit-openid" });
  });

  it("云托管生产模式可从 MYSQL 环境变量生成连接地址且不需要 AppSecret", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      WECHAT_AUTH_MODE: "cloud",
      MYSQL_ADDRESS: "10.0.0.8:3306",
      MYSQL_USERNAME: "root",
      MYSQL_PASSWORD: "p@ss/word",
      MYSQL_DATABASE: "quzijie"
    });
    assert.equal(config.databaseUrl, "mysql://root:p%40ss%2Fword@10.0.0.8:3306/quzijie");
    assert.equal(config.jwtAccessSecret, "");
  });
});

describe("积分与成就领域规则", () => {
  it("公开编号稳定且固定为四位非易混淆字符", () => {
    assert.equal(publicCodeFor("user-1"), publicCodeFor("user-1"));
    assert.match(publicCodeFor("user-1"), /^[23456789A-HJ-NP-Z]{4}$/);
    assert.notEqual(publicCodeFor("user-1"), publicCodeFor("user-1", 1));
  });

  it("昵称执行 NFKC、字符集、保留词与联系方式校验", () => {
    assert.equal(normalizeDisplayName("  ＡＢ_12  "), "AB_12");
    assert.throws(() => normalizeDisplayName("管"), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "INVALID_DISPLAY_NAME"));
    assert.throws(() => normalizeDisplayName("管理员小米"), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "RESERVED_DISPLAY_NAME"));
    assert.throws(() => normalizeDisplayName("联系我12345678"), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "UNSAFE_DISPLAY_NAME"));
  });

  it("日榜和周榜严格使用北京时间边界", () => {
    const now = new Date("2026-07-15T12:30:00.000Z");
    assert.equal(shanghaiDayKey(now), "2026-07-15");
    assert.deepEqual(shanghaiPeriod("daily", now), {
      start: new Date("2026-07-14T16:00:00.000Z"),
      end: new Date("2026-07-15T16:00:00.000Z")
    });
    assert.deepEqual(shanghaiPeriod("weekly", now), {
      start: new Date("2026-07-12T16:00:00.000Z"),
      end: new Date("2026-07-19T16:00:00.000Z")
    });
  });

  it("成就目录固定为十二个唯一称号和图标", () => {
    assert.equal(ACHIEVEMENTS.length, 12);
    assert.equal(new Set(ACHIEVEMENTS.map((item) => item.key)).size, 12);
    assert.equal(new Set(ACHIEVEMENTS.map((item) => item.title)).size, 12);
    assert.equal(new Set(ACHIEVEMENTS.map((item) => item.iconKey)).size, 12);
  });
});
