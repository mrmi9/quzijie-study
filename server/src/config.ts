import { resolveDatabaseUrl } from "./database-url.js";

export type WechatAuthMode = "stub" | "real" | "cloud";
export type AdminReviewPolicy = "two-person" | "single-owner";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  wechatAuthMode: WechatAuthMode;
  wechatDevOpenId: string;
  wechatAppId: string;
  wechatAppSecret: string;
  adminEnabled: boolean;
  adminEncryptionKey: string;
  adminSessionTtlHours: number;
  adminReviewPolicy: AdminReviewPolicy;
  adminBootstrapTokenHash: string;
  questionBankStorage: "local" | "cos";
  questionBankStorageDir: string;
  cosSecretId: string;
  cosSecretKey: string;
  cosBucket: string;
  cosRegion: string;
  cosPublicBaseUrl: string;
  questionBankMaxSnapshotBytes: number;
}

function booleanValue(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("布尔环境变量只能是 true 或 false");
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须为正整数`);
  return parsed;
}

function weakProductionSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return value.length < 32
    || new Set(value).size < 8
    || normalized.includes("replace-with")
    || normalized.includes("change-me")
    || normalized.includes("test-secret")
    || normalized.includes("dev-secret");
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (source.NODE_ENV || "development") as AppConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV 配置无效");
  const wechatAuthMode = (source.WECHAT_AUTH_MODE || "stub") as WechatAuthMode;
  if (!["stub", "real", "cloud"].includes(wechatAuthMode)) throw new Error("WECHAT_AUTH_MODE 只能为 stub、real 或 cloud");
  if (nodeEnv === "production" && wechatAuthMode === "stub") throw new Error("生产环境禁止启用微信 Stub 登录");
  const jwtAccessSecret = source.JWT_ACCESS_SECRET || "";
  if (wechatAuthMode !== "cloud" && jwtAccessSecret.length < 32) throw new Error("JWT_ACCESS_SECRET 至少需要 32 个字符");
  if (nodeEnv === "production" && wechatAuthMode !== "cloud" && weakProductionSecret(jwtAccessSecret)) {
    throw new Error("生产环境 JWT_ACCESS_SECRET 强度不足");
  }
  const databaseUrl = resolveDatabaseUrl(source);
  const wechatAppId = source.WECHAT_APP_ID || "";
  const wechatAppSecret = source.WECHAT_APP_SECRET || "";
  if (wechatAuthMode === "real" && (!wechatAppId || !wechatAppSecret)) {
    throw new Error("真实微信登录需要 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
  }
  const adminEnabled = booleanValue(source.ADMIN_ENABLED, false);
  const adminEncryptionKey = source.ADMIN_ENCRYPTION_KEY || "";
  if (adminEnabled && adminEncryptionKey.length < 32) {
    throw new Error("启用管理后台时 ADMIN_ENCRYPTION_KEY 至少需要 32 个字符");
  }
  if (nodeEnv === "production" && adminEnabled && weakProductionSecret(adminEncryptionKey)) {
    throw new Error("生产环境 ADMIN_ENCRYPTION_KEY 强度不足");
  }
  const adminReviewPolicy = (source.ADMIN_REVIEW_POLICY || "two-person") as AdminReviewPolicy;
  if (!["two-person", "single-owner"].includes(adminReviewPolicy)) {
    throw new Error("ADMIN_REVIEW_POLICY 只能是 two-person 或 single-owner");
  }
  const adminBootstrapTokenHash = (source.ADMIN_BOOTSTRAP_TOKEN_HASH || "").trim().toLowerCase();
  if (adminBootstrapTokenHash && !/^[a-f0-9]{64}$/.test(adminBootstrapTokenHash)) {
    throw new Error("ADMIN_BOOTSTRAP_TOKEN_HASH 必须是 SHA-256 十六进制哈希");
  }
  const questionBankStorage = (source.QUESTION_BANK_STORAGE || "local") as "local" | "cos";
  if (!['local', 'cos'].includes(questionBankStorage)) throw new Error("QUESTION_BANK_STORAGE 只能是 local 或 cos");
  if (nodeEnv === "production" && adminEnabled && questionBankStorage !== "cos") {
    throw new Error("生产环境启用管理后台时必须使用 COS 题库存储");
  }
  const cosSecretId = source.COS_SECRET_ID || "";
  const cosSecretKey = source.COS_SECRET_KEY || "";
  const cosBucket = source.COS_BUCKET || "";
  const cosRegion = source.COS_REGION || "";
  const cosPublicBaseUrl = source.COS_PUBLIC_BASE_URL || "";
  if (questionBankStorage === "cos" && (!cosSecretId || !cosSecretKey || !cosBucket || !cosRegion)) {
    throw new Error("COS 题库存储缺少 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION");
  }
  if (nodeEnv === "production" && adminEnabled && cosPublicBaseUrl) {
    throw new Error("生产题库必须使用私有 COS，COS_PUBLIC_BASE_URL 必须留空");
  }

  return {
    nodeEnv,
    host: source.HOST || "0.0.0.0",
    port: positiveInteger(source.PORT, 3000, "PORT"),
    databaseUrl,
    jwtAccessSecret,
    accessTokenTtlSeconds: positiveInteger(source.ACCESS_TOKEN_TTL_SECONDS, 900, "ACCESS_TOKEN_TTL_SECONDS"),
    refreshTokenTtlDays: positiveInteger(source.REFRESH_TOKEN_TTL_DAYS, 30, "REFRESH_TOKEN_TTL_DAYS"),
    wechatAuthMode,
    wechatDevOpenId: source.WECHAT_DEV_OPENID || "dev-openid-quzijie",
    wechatAppId,
    wechatAppSecret,
    adminEnabled,
    adminEncryptionKey,
    adminSessionTtlHours: positiveInteger(source.ADMIN_SESSION_TTL_HOURS, 12, "ADMIN_SESSION_TTL_HOURS"),
    adminReviewPolicy,
    adminBootstrapTokenHash,
    questionBankStorage,
    questionBankStorageDir: source.QUESTION_BANK_STORAGE_DIR || ".question-bank-storage",
    cosSecretId,
    cosSecretKey,
    cosBucket,
    cosRegion,
    cosPublicBaseUrl,
    questionBankMaxSnapshotBytes: positiveInteger(source.QUESTION_BANK_MAX_SNAPSHOT_BYTES, 256 * 1024 * 1024, "QUESTION_BANK_MAX_SNAPSHOT_BYTES")
  };
}
