import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.js";
import { publicQuestion, sameAnswer, validateSelection, type QuestionSnapshot } from "../../src/domain/questions.js";
import { createWechatAuthProvider } from "../../src/auth/wechat.js";
import { ACHIEVEMENTS } from "../../src/domain/achievements.js";
import { normalizeDisplayName, publicCodeFor, shanghaiDayKey, shanghaiPeriod } from "../../src/domain/gamification.js";
import { decryptAdminSecret, encryptAdminSecret, hashAdminPassword, normalizeAdminRoles, normalizeAdminUsername, verifyAdminPassword, verifyTotp } from "../../src/auth/admin.js";
import { normalizeDraftQuestion, normalizeFillAnswer, questionTextSimilarity, sameFillAnswer, stableStringify, validateDraftQuestion } from "../../src/domain/question-bank.js";
import { validateQuestionImage } from "../../src/services/media.js";

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
  acceptedAnswers: [],
  answerConfig: {},
  referenceAnswer: "",
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

  it("管理后台复核策略默认双人且拒绝非法策略和非法启动哈希", () => {
    assert.equal(loadConfig(baseEnv()).adminReviewPolicy, "two-person");
    assert.equal(loadConfig({ ...baseEnv(), ADMIN_REVIEW_POLICY: "single-owner" }).adminReviewPolicy, "single-owner");
    assert.throws(() => loadConfig({ ...baseEnv(), ADMIN_REVIEW_POLICY: "everyone" }), /ADMIN_REVIEW_POLICY/);
    assert.throws(() => loadConfig({ ...baseEnv(), ADMIN_BOOTSTRAP_TOKEN_HASH: "not-a-sha256" }), /ADMIN_BOOTSTRAP_TOKEN_HASH/);
  });

  it("生产管理后台强制使用稳定密钥和私有 COS", () => {
    const productionAdmin = {
      NODE_ENV: "production",
      WECHAT_AUTH_MODE: "cloud",
      MYSQL_ADDRESS: "10.0.0.8:3306",
      MYSQL_USERNAME: "root",
      MYSQL_PASSWORD: "strong-database-secret",
      MYSQL_DATABASE: "quzijie",
      ADMIN_ENABLED: "true",
      ADMIN_REVIEW_POLICY: "single-owner",
      ADMIN_ENCRYPTION_KEY: "Admin-Key-2026_Random-Strong_7x9Qp"
    } satisfies NodeJS.ProcessEnv;
    assert.throws(() => loadConfig(productionAdmin), /必须使用 COS/);
    assert.throws(() => loadConfig({ ...productionAdmin, ADMIN_ENCRYPTION_KEY: "change-me-change-me-change-me-change-me" }), /强度不足/);
    assert.throws(() => loadConfig({
      ...productionAdmin,
      QUESTION_BANK_STORAGE: "cos",
      COS_SECRET_ID: "AKIDEXAMPLE",
      COS_SECRET_KEY: "private-secret",
      COS_BUCKET: "private-bucket-1234567890",
      COS_REGION: "ap-shanghai",
      COS_PUBLIC_BASE_URL: "https://public.example.test"
    }), /必须使用私有 COS/);
    assert.doesNotThrow(() => loadConfig({
      ...productionAdmin,
      QUESTION_BANK_STORAGE: "cos",
      COS_SECRET_ID: "AKIDEXAMPLE",
      COS_SECRET_KEY: "private-secret",
      COS_BUCKET: "private-bucket-1234567890",
      COS_REGION: "ap-shanghai",
      COS_PUBLIC_BASE_URL: ""
    }));
  });
});

describe("题库管理领域规则", () => {
  it("稳定序列化不受对象键顺序和 Date 实例影响", () => {
    assert.equal(
      stableStringify({ when: new Date("2026-07-16T00:00:00.000Z"), a: 1 }),
      stableStringify({ a: 1, when: "2026-07-16T00:00:00.000Z" })
    );
  });

  it("填空答案执行 NFKC、空白、大小写和标点规范化", () => {
    assert.equal(normalizeFillAnswer("  Ｈｅｌｌｏ，  WORLD! "), "hello world");
    assert.equal(sameFillAnswer(["  TCP/IP  ", "四"], [["tcpip", "TCP/IP"], ["4", "四"]]), true);
    assert.equal(sameFillAnswer(["TCP", "四"], [["TCP/IP"], ["四"]]), false);
  });

  it("近似题干使用规范化二元组识别", () => {
    assert.equal(questionTextSimilarity("HTTP 默认端口是什么？", "HTTP默认端口是什么"), 1);
    assert.equal(questionTextSimilarity("HTTP 默认端口是什么？", "二叉树的高度如何计算？") < 0.3, true);
  });

  it("五种题型执行各自答案结构校验", () => {
    const fill = normalizeDraftQuestion({
      subjectId: "network", chapterId: "network-application", type: "fill_blank", stem: "HTTP 默认端口是？",
      explanation: "HTTP 的默认明文端口为 80。", difficulty: 1, acceptedAnswers: [["80"]]
    });
    assert.deepEqual(validateDraftQuestion(fill).errors, []);
    const short = normalizeDraftQuestion({
      subjectId: "os", chapterId: "os-process", type: "short_answer", stem: "简述死锁条件。",
      explanation: "需要列出四个必要条件。", difficulty: 2, referenceAnswer: "互斥、请求并保持、不可剥夺、循环等待"
    });
    assert.deepEqual(validateDraftQuestion(short).errors, []);
  });

  it("管理员密码、角色、TOTP 与密钥密文可验证", async () => {
    assert.equal(normalizeAdminUsername("  Owner_01 "), "owner_01");
    assert.deepEqual(normalizeAdminRoles(["OWNER", "EDITOR", "OWNER", "INVALID"]), ["OWNER", "EDITOR"]);
    const passwordHash = await hashAdminPassword("A-strong-admin-password-2026");
    assert.equal(await verifyAdminPassword(passwordHash, "A-strong-admin-password-2026"), true);
    assert.equal(await verifyAdminPassword(passwordHash, "wrong-password"), false);
    const key = "unit-test-admin-encryption-key-at-least-32";
    const encrypted = encryptAdminSecret("JBSWY3DPEHPK3PXP", key);
    assert.equal(decryptAdminSecret(encrypted, key), "JBSWY3DPEHPK3PXP");
    assert.equal(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000), true);
  });

  it("题图校验真实文件头、MIME 和尺寸", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(800, 16);
    png.writeUInt32BE(600, 20);
    assert.deepEqual(validateQuestionImage(png, "image/png"), { mimeType: "image/png", width: 800, height: 600 });
    assert.throws(() => validateQuestionImage(png, "image/jpeg"), /格式不一致/);
    png.writeUInt32BE(5000, 16);
    assert.throws(() => validateQuestionImage(png, "image/png"), /4096/);
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
