export type WechatAuthMode = "stub" | "real";

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
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须为正整数`);
  return parsed;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (source.NODE_ENV || "development") as AppConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV 配置无效");
  const wechatAuthMode = (source.WECHAT_AUTH_MODE || "stub") as WechatAuthMode;
  if (!["stub", "real"].includes(wechatAuthMode)) throw new Error("WECHAT_AUTH_MODE 只能为 stub 或 real");
  if (nodeEnv === "production" && wechatAuthMode === "stub") throw new Error("生产环境禁止启用微信 Stub 登录");
  const jwtAccessSecret = source.JWT_ACCESS_SECRET || "";
  if (jwtAccessSecret.length < 32) throw new Error("JWT_ACCESS_SECRET 至少需要 32 个字符");
  const databaseUrl = source.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const wechatAppId = source.WECHAT_APP_ID || "";
  const wechatAppSecret = source.WECHAT_APP_SECRET || "";
  if (wechatAuthMode === "real" && (!wechatAppId || !wechatAppSecret)) {
    throw new Error("真实微信登录需要 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
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
    wechatAppSecret
  };
}
