import type { FastifyInstance } from "fastify";
import type { AuthenticateHandler } from "../auth/tokens.js";
import type { GamificationService } from "../services/gamification.js";

const profileBody = {
  type: "object",
  additionalProperties: false,
  required: ["displayName"],
  properties: { displayName: { type: "string", minLength: 1, maxLength: 64 } }
} as const;

const leaderboardQuery = {
  type: "object",
  additionalProperties: false,
  required: ["period"],
  properties: {
    period: { enum: ["daily", "weekly", "all"] },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 100 }
  }
} as const;

const equippedTitleBody = {
  type: "object",
  additionalProperties: false,
  required: ["achievementKey"],
  properties: { achievementKey: { type: ["string", "null"], maxLength: 64 } }
} as const;

export function registerGamificationRoutes(
  app: FastifyInstance,
  service: GamificationService,
  authenticate: AuthenticateHandler
): void {
  app.get("/api/v1/gamification/me", { preHandler: authenticate }, async (request) => ({
    data: await service.getMe(request.userId)
  }));

  app.put<{ Body: { displayName: string } }>("/api/v1/gamification/profile", {
    preHandler: authenticate,
    schema: { body: profileBody },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request) => ({ data: await service.updateDisplayName(request.userId, request.body.displayName) }));

  app.get<{ Querystring: { period: "daily" | "weekly" | "all"; limit?: number } }>(
    "/api/v1/gamification/leaderboard",
    { preHandler: authenticate, schema: { querystring: leaderboardQuery } },
    async (request) => ({
      data: await service.leaderboard(request.userId, request.query.period, request.query.limit)
    })
  );

  app.get("/api/v1/gamification/achievements", { preHandler: authenticate }, async (request) => ({
    data: await service.getAchievements(request.userId)
  }));

  app.put<{ Body: { achievementKey: string | null } }>("/api/v1/gamification/equipped-title", {
    preHandler: authenticate,
    schema: { body: equippedTitleBody }
  }, async (request) => ({ data: await service.equipTitle(request.userId, request.body.achievementKey) }));
}
