import type { FastifyInstance } from "fastify";
import type { AuthenticateHandler } from "../auth/tokens.js";
import type { PracticeService } from "../services/practice.js";

const subjectParams = {
  type: "object",
  additionalProperties: false,
  required: ["subjectId"],
  properties: { subjectId: { type: "string", minLength: 1, maxLength: 32 } }
} as const;

const sessionParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } }
} as const;

const favoriteParams = {
  type: "object",
  additionalProperties: false,
  required: ["subjectId", "questionId"],
  properties: {
    subjectId: { type: "string", minLength: 1, maxLength: 32 },
    questionId: { type: "string", minLength: 1, maxLength: 32 }
  }
} as const;

export function registerPracticeRoutes(
  app: FastifyInstance,
  service: PracticeService,
  authenticate: AuthenticateHandler
): void {
  app.get("/api/v1/learning/overview", { preHandler: authenticate }, async (request) => ({
    data: await service.getLearningOverview(request.userId)
  }));

  app.get<{ Params: { subjectId: string } }>("/api/v1/subjects/:subjectId/overview", {
    preHandler: authenticate,
    schema: { params: subjectParams }
  }, async (request) => ({ data: await service.getSubjectOverview(request.userId, request.params.subjectId) }));

  app.get<{ Params: { subjectId: string } }>("/api/v1/subjects/:subjectId/chapters", {
    preHandler: authenticate,
    schema: { params: subjectParams }
  }, async (request) => ({ data: await service.getChapters(request.userId, request.params.subjectId) }));

  app.post<{ Body: { subject: string; mode: string; chapterId?: string; count: number } }>("/api/v1/practice-sessions", {
    preHandler: authenticate,
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "mode", "count"],
        properties: {
          subject: { type: "string", minLength: 1, maxLength: 32 },
          mode: { enum: ["chapter", "random", "wrong", "favorite"] },
          chapterId: { type: "string", minLength: 1, maxLength: 64 },
          count: { enum: [5, 10, 20] }
        }
      }
    }
  }, async (request) => ({ data: await service.createSession(request.userId, request.body) }));

  app.get<{ Params: { id: string } }>("/api/v1/practice-sessions/:id", {
    preHandler: authenticate,
    schema: { params: sessionParams }
  }, async (request) => ({ data: await service.getSession(request.userId, request.params.id) }));

  app.post<{
    Params: { id: string };
    Body: { questionId: string; selectedOptionIds: string[]; clientAnswerId: string };
  }>("/api/v1/practice-sessions/:id/answers", {
    preHandler: authenticate,
    schema: {
      params: sessionParams,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["questionId", "selectedOptionIds", "clientAnswerId"],
        properties: {
          questionId: { type: "string", minLength: 1, maxLength: 32 },
          selectedOptionIds: { type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 8 } },
          clientAnswerId: { type: "string", minLength: 8, maxLength: 160 }
        }
      }
    }
  }, async (request) => ({ data: await service.submitAnswer(request.userId, request.params.id, request.body) }));

  app.post<{ Params: { id: string } }>("/api/v1/practice-sessions/:id/finish", {
    preHandler: authenticate,
    schema: { params: sessionParams }
  }, async (request) => ({ data: await service.finishSession(request.userId, request.params.id) }));

  app.get<{ Params: { id: string } }>("/api/v1/practice-sessions/:id/result", {
    preHandler: authenticate,
    schema: { params: sessionParams }
  }, async (request) => ({ data: await service.getResult(request.userId, request.params.id) }));

  app.get<{ Querystring: { subjectId?: string; mastered?: string } }>("/api/v1/records/wrong", {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          subjectId: { type: "string", minLength: 1, maxLength: 32 },
          mastered: { enum: ["true", "false"] }
        }
      }
    }
  }, async (request) => {
    const mastered = request.query.mastered === undefined ? undefined : request.query.mastered === "true";
    return { data: await service.getWrongQuestions(request.userId, request.query.subjectId, mastered) };
  });

  app.get<{ Querystring: { subjectId?: string } }>("/api/v1/records/favorites", {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { subjectId: { type: "string", minLength: 1, maxLength: 32 } }
      }
    }
  }, async (request) => ({ data: await service.getFavorites(request.userId, request.query.subjectId) }));

  const favoriteHandler = async (request: { userId: string; params: { subjectId: string; questionId: string } }, favorite: boolean) => ({
    data: await service.setFavorite(request.userId, request.params.subjectId, request.params.questionId, favorite)
  });

  app.put<{ Params: { subjectId: string; questionId: string } }>("/api/v1/records/favorites/:subjectId/:questionId", {
    preHandler: authenticate,
    schema: { params: favoriteParams }
  }, async (request) => favoriteHandler(request, true));

  app.delete<{ Params: { subjectId: string; questionId: string } }>("/api/v1/records/favorites/:subjectId/:questionId", {
    preHandler: authenticate,
    schema: { params: favoriteParams }
  }, async (request) => favoriteHandler(request, false));

}
