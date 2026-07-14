import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseClient } from "../db.js";
import type { WechatAuthProvider } from "../auth/wechat.js";
import { authenticate, hashRefreshToken, issueTokenPair, rotateTokenPair } from "../auth/tokens.js";

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
  deps: { prisma: DatabaseClient; config: AppConfig; wechatProvider: WechatAuthProvider }
): void {
  const { prisma, config, wechatProvider } = deps;

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
}
