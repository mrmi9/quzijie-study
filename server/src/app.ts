import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config.js";
import type { DatabaseClient } from "./db.js";
import { AppError } from "./errors.js";
import { createWechatAuthProvider, type WechatAuthProvider } from "./auth/wechat.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPracticeRoutes } from "./routes/practice.js";
import { registerExamRoutes } from "./routes/exams.js";
import { PracticeService } from "./services/practice.js";
import { ExamService } from "./services/exam.js";

export interface AppDependencies {
  config: AppConfig;
  prisma: DatabaseClient;
  wechatProvider?: WechatAuthProvider;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.nodeEnv === "test" ? false : {
      level: deps.config.nodeEnv === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.body.code",
        "req.body.refreshToken",
        "res.headers.set-cookie"
      ]
    },
    requestIdHeader: "x-request-id"
  });

  await app.register(rateLimit, { global: false });
  await app.register(fastifyJwt, { secret: deps.config.jwtAccessSecret });

  app.get("/health", async () => ({
    data: { status: "ok", timestamp: new Date().toISOString() }
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      return { data: { status: "ok", database: "ok", timestamp: new Date().toISOString() } };
    } catch {
      reply.code(503);
      return { code: "SERVICE_UNAVAILABLE", message: "数据库不可用", details: null };
    }
  });

  registerAuthRoutes(app, {
    prisma: deps.prisma,
    config: deps.config,
    wechatProvider: deps.wechatProvider || createWechatAuthProvider(deps.config)
  });
  const examService = new ExamService(deps.prisma);
  registerPracticeRoutes(app, new PracticeService(deps.prisma, examService));
  registerExamRoutes(app, examService);
  examService.start((error) => app.log.error({ err: error }, "expired exam finalization failed"));
  app.addHook("onClose", async () => examService.stop());

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      code: "NOT_FOUND",
      message: "接口不存在",
      details: { method: request.method, url: request.url },
      requestId: request.id
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id
      });
      return;
    }
    const fastifyError = error as { validation?: unknown; statusCode?: number; code?: string };
    if (fastifyError.validation) {
      reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "请求参数不合法",
        details: fastifyError.validation,
        requestId: request.id
      });
      return;
    }
    if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      reply.code(fastifyError.statusCode).send({
        code: fastifyError.code || "BAD_REQUEST",
        message: fastifyError.statusCode === 415 ? "请求内容类型不受支持" : "请求格式不合法",
        details: null,
        requestId: request.id
      });
      return;
    }
    request.log.error({ err: error }, "unhandled request error");
    reply.code(500).send({
      code: "SERVER_ERROR",
      message: "服务器内部错误",
      details: null,
      requestId: request.id
    });
  });

  return app;
}
