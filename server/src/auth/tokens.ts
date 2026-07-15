import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import { readCloudWechatIdentity } from "./cloud.js";

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export async function issueTokenPair(
  app: FastifyInstance,
  prisma: DatabaseClient,
  config: AppConfig,
  userId: string
) {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashRefreshToken(refreshToken), expiresAt }
  });
  return {
    accessToken: app.jwt.sign({ sub: userId }, { expiresIn: config.accessTokenTtlSeconds }),
    expiresIn: config.accessTokenTtlSeconds,
    refreshToken,
    refreshExpiresIn: config.refreshTokenTtlDays * 24 * 60 * 60
  };
}

export async function rotateTokenPair(
  app: FastifyInstance,
  prisma: DatabaseClient,
  config: AppConfig,
  refreshToken: string
) {
  const tokenHash = hashRefreshToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.user.status !== "ACTIVE") {
    throw new AppError("登录状态已失效，请重新登录", "UNAUTHORIZED", 401);
  }

  const nextToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  const next = await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: { userId: stored.userId, tokenHash: hashRefreshToken(nextToken), expiresAt }
    });
    const updated = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedByTokenId: created.id }
    });
    if (updated.count !== 1) throw new AppError("刷新令牌已被使用", "UNAUTHORIZED", 401);
    return created;
  });

  return {
    accessToken: app.jwt.sign({ sub: stored.userId }, { expiresIn: config.accessTokenTtlSeconds }),
    expiresIn: config.accessTokenTtlSeconds,
    refreshToken: nextToken,
    refreshExpiresIn: Math.max(0, Math.floor((next.expiresAt.getTime() - Date.now()) / 1000))
  };
}

export type AuthenticateHandler = (request: FastifyRequest) => Promise<void>;

export function createAuthenticate(prisma: DatabaseClient, config: AppConfig): AuthenticateHandler {
  return async (request: FastifyRequest): Promise<void> => {
    if (config.wechatAuthMode === "cloud") {
      const identity = readCloudWechatIdentity(request);
      const user = await prisma.user.findFirst({
        where: { wechatOpenId: identity.openId, status: "ACTIVE" },
        select: { id: true }
      });
      if (!user) throw new AppError("请登录后继续", "UNAUTHORIZED", 401);
      request.userId = user.id;
      return;
    }

    let userId = "";
    try {
      await request.jwtVerify();
      const payload = request.user as { sub?: string };
      if (!payload.sub) throw new Error("missing subject");
      userId = payload.sub;
    } catch {
      throw new AppError("请登录后继续", "UNAUTHORIZED", 401);
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, status: "ACTIVE" },
      select: { id: true }
    });
    if (!user) throw new AppError("登录状态已失效，请重新登录", "UNAUTHORIZED", 401);
    request.userId = user.id;
  };
}
