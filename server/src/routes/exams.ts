import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/tokens.js";
import type { ExamService } from "../services/exam.js";

const examParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 64 } }
} as const;

const examTypeSchema = { const: "postgraduate-408-objective" } as const;

export function registerExamRoutes(app: FastifyInstance, service: ExamService): void {
  app.post<{ Body: { type: string } }>("/api/v1/exams", {
    preHandler: authenticate,
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["type"],
        properties: { type: examTypeSchema }
      }
    }
  }, async (request) => ({ data: await service.createExam(request.userId, request.body.type) }));

  app.get<{ Querystring: { type: string } }>("/api/v1/exams", {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["type"],
        properties: { type: examTypeSchema }
      }
    }
  }, async (request) => ({ data: await service.listExams(request.userId, request.query.type) }));

  app.get<{ Params: { id: string } }>("/api/v1/exams/:id", {
    preHandler: authenticate,
    schema: { params: examParams }
  }, async (request) => ({ data: await service.getExam(request.userId, request.params.id) }));

  app.put<{ Params: { id: string }; Body: { answers: Record<string, string[]> } }>("/api/v1/exams/:id/draft", {
    preHandler: authenticate,
    schema: {
      params: examParams,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["answers"],
        properties: {
          answers: {
            type: "object",
            additionalProperties: {
              type: "array",
              minItems: 0,
              maxItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 8 }
            }
          }
        }
      }
    }
  }, async (request) => ({ data: await service.saveDraft(request.userId, request.params.id, request.body.answers) }));

  app.post<{ Params: { id: string } }>("/api/v1/exams/:id/submit", {
    preHandler: authenticate,
    schema: { params: examParams }
  }, async (request) => ({ data: await service.submitExam(request.userId, request.params.id) }));

  app.get<{ Params: { id: string } }>("/api/v1/exams/:id/result", {
    preHandler: authenticate,
    schema: { params: examParams }
  }, async (request) => ({ data: await service.buildResult(request.userId, request.params.id) }));
}
