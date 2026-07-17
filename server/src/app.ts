import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import type { DatabaseClient } from "./db.js";
import { AppError } from "./errors.js";
import { createWechatAuthProvider, type WechatAuthProvider } from "./auth/wechat.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPracticeRoutes } from "./routes/practice.js";
import { registerExamRoutes } from "./routes/exams.js";
import { registerGamificationRoutes } from "./routes/gamification.js";
import { PracticeService } from "./services/practice.js";
import { ExamService } from "./services/exam.js";
import { GamificationService } from "./services/gamification.js";
import { CatalogService } from "./services/catalog.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { createAuthenticate } from "./auth/tokens.js";
import { isDatabaseBootstrapPending } from "./bootstrap-state.js";
import { AdminSecurity, registerAdminAuthRoutes } from "./routes/admin-auth.js";
import { registerAdminQuestionBankRoutes } from "./routes/admin-question-bank.js";
import { createQuestionBankStorage } from "./services/question-bank-storage.js";
import { QuestionBankService } from "./services/question-bank.js";
import { QuestionImportService } from "./services/question-import.js";
import { MediaService } from "./services/media.js";

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
        "req.headers.x-wx-openid",
        "req.headers.x-wx-unionid",
        "req.body.code",
        "req.body.refreshToken",
        "req.body.password",
        "req.body.totp",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
        "res.headers.set-cookie"
      ]
    },
    requestIdHeader: "x-request-id"
  });

  await app.register(rateLimit, { global: false });
  await app.register(fastifyCookie);
  if (deps.config.wechatAuthMode !== "cloud") {
    await app.register(fastifyJwt, { secret: deps.config.jwtAccessSecret });
  }

  app.get("/health", async () => ({
    data: { status: "ok", timestamp: new Date().toISOString() }
  }));

  app.get("/ready", async (_request, reply) => {
    if (isDatabaseBootstrapPending()) {
      reply.code(503);
      return { code: "SERVICE_BOOTSTRAPPING", message: "数据初始化尚未完成", details: null };
    }
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      return { data: { status: "ok", database: "ok", timestamp: new Date().toISOString() } };
    } catch {
      reply.code(503);
      return { code: "SERVICE_UNAVAILABLE", message: "数据库不可用", details: null };
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestPath = request.raw.url?.split("?", 1)[0];
    if (requestPath === "/health" || requestPath === "/ready") return;
    if (!isDatabaseBootstrapPending()) return;
    return reply.code(503).send({
      code: "SERVICE_BOOTSTRAPPING",
      message: "数据初始化尚未完成",
      details: null
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    if (isDatabaseBootstrapPending() || reply.statusCode < 500 || !request.url.startsWith("/api/v1/")) return;
    try {
      const state = await deps.prisma.catalogState.findUnique({ where: { id: 1 }, select: { activeReleaseId: true } });
      if (state?.activeReleaseId) {
        await deps.prisma.questionRelease.update({ where: { id: state.activeReleaseId }, data: { api5xxCount: { increment: 1 } } });
        request.log.warn({ event: "question_bank_api_5xx", releaseId: state.activeReleaseId, statusCode: reply.statusCode, requestId: request.id }, "question bank API 5xx recorded");
      }
    } catch (error) {
      request.log.warn({ err: error, event: "question_bank_api_5xx_metric_failed", requestId: request.id }, "failed to record question bank API 5xx");
    }
  });

  const authenticate = createAuthenticate(deps.prisma, deps.config);
  const catalogService = new CatalogService(deps.prisma);
  registerCatalogRoutes(app, catalogService);
  if (deps.config.adminEnabled) {
    await app.register(fastifyMultipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });
    const adminSecurity = new AdminSecurity(deps.prisma, deps.config);
    registerAdminAuthRoutes(app, deps.prisma, deps.config, adminSecurity);
    const storage = createQuestionBankStorage(deps.config);
    const questionBank = new QuestionBankService(deps.prisma, deps.config, storage);
    registerAdminQuestionBankRoutes(
      app,
      deps.prisma,
      adminSecurity,
      questionBank,
      new QuestionImportService(deps.prisma, questionBank, storage),
      new MediaService(deps.prisma, storage, questionBank)
    );
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const adminRoot = [
      resolve(process.cwd(), "admin", "dist"),
      resolve(process.cwd(), "..", "admin", "dist"),
      resolve(moduleDirectory, "..", "..", "..", "admin", "dist"),
      resolve(moduleDirectory, "..", "..", "admin", "dist")
    ].find((candidate) => existsSync(candidate));
    if (adminRoot) {
      await app.register(fastifyStatic, { root: adminRoot, prefix: "/admin/", wildcard: false });
      app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
    }
  }
  const gamificationService = new GamificationService(deps.prisma);
  registerAuthRoutes(app, {
    prisma: deps.prisma,
    config: deps.config,
    wechatProvider: deps.config.wechatAuthMode === "cloud"
      ? undefined
      : (deps.wechatProvider || createWechatAuthProvider(deps.config)),
    authenticate,
    onAuthenticated: (userId) => gamificationService.initializeUser(userId)
  });
  const examService = new ExamService(deps.prisma, {}, gamificationService);
  registerPracticeRoutes(app, new PracticeService(deps.prisma, gamificationService, examService, catalogService), authenticate);
  registerExamRoutes(app, examService, authenticate);
  registerGamificationRoutes(app, gamificationService, authenticate);
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
