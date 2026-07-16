import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseClient } from "../db.js";
import type { WechatAuthProvider } from "../auth/wechat.js";
import { hashRefreshToken, issueTokenPair, rotateTokenPair, type AuthenticateHandler } from "../auth/tokens.js";
import { readCloudWechatIdentity } from "../auth/cloud.js";

const codeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: { code: { type: "string", minLength: 1, maxLength: 256 } }
} as const;

const refreshBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["refreshToken"],
  properties: { refreshToken: { type: "string", minLength: 20, maxLength: 512 } }
} as const;

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    prisma: DatabaseClient;
    config: AppConfig;
    wechatProvider?: WechatAuthProvider;
    authenticate: AuthenticateHandler;
    onAuthenticated?: (userId: string) => Promise<unknown>;
  }
): void {
  const { prisma, config, authenticate } = deps;

  if (config.wechatAuthMode === "cloud") {
    app.post("/api/v1/auth/wechat/cloud-login", {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    }, async (request) => {
      const identity = readCloudWechatIdentity(request);
      const now = new Date();
      const user = await prisma.user.upsert({
        where: { wechatOpenId: identity.openId },
        update: { unionId: identity.unionId, lastLoginAt: now, status: "ACTIVE" },
        create: { wechatOpenId: identity.openId, unionId: identity.unionId, lastLoginAt: now }
      });
      await deps.onAuthenticated?.(user.id);
      return { data: { authenticated: true, user: { id: user.id, createdAt: user.createdAt.toISOString() } } };
    });
  } else {
    const wechatProvider = deps.wechatProvider;
    if (!wechatProvider) throw new Error("缺少微信登录适配器");
    app.post<{ Body: { code: string } }>("/api/v1/auth/wechat/login", {
      schema: { body: codeBodySchema },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    }, async (request) => {
      const identity = await wechatProvider.exchangeCode(request.body.code);
      const now = new Date();
      const user = await prisma.user.upsert({
        where: { wechatOpenId: identity.openId },
        update: { unionId: identity.unionId, lastLoginAt: now },
        create: { wechatOpenId: identity.openId, unionId: identity.unionId, lastLoginAt: now }
      });
      await deps.onAuthenticated?.(user.id);
      const tokens = await issueTokenPair(app, prisma, config, user.id);
      return { data: Object.assign(tokens, { user: { id: user.id, createdAt: user.createdAt.toISOString() } }) };
    });

    app.post<{ Body: { refreshToken: string } }>("/api/v1/auth/refresh", {
      schema: { body: refreshBodySchema },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    }, async (request) => ({ data: await rotateTokenPair(app, prisma, config, request.body.refreshToken) }));

    app.post<{ Body: { refreshToken: string } }>("/api/v1/auth/logout", {
      schema: { body: refreshBodySchema }
    }, async (request) => {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(request.body.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return { data: { loggedOut: true } };
    });
  }

  app.get("/api/v1/users/me", { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId } });
    return {
      data: {
        id: user.id,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt.toISOString()
      }
    };
  });

  app.delete("/api/v1/users/me", { preHandler: authenticate }, async (request) => {
    const deleted = await prisma.user.deleteMany({
      where: { id: request.userId, status: "ACTIVE" }
    });
    if (deleted.count !== 1) throw new Error("authenticated user disappeared before deletion");
    return { data: { deleted: true } };
  });
}
