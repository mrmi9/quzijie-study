import type { FastifyInstance } from "fastify";
import type { DatabaseClient } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../errors.js";
import { normalizeAdminRoles } from "../auth/admin.js";
import type { DraftQuestionInput } from "../domain/question-bank.js";
import type { QuestionBankService } from "../services/question-bank.js";
import type { QuestionImportService } from "../services/question-import.js";
import type { AdminSecurity } from "./admin-auth.js";
import type { MediaService } from "../services/media.js";

function attachment(reply: { header(name: string, value: string): unknown }, filename: string): void {
  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
}

type AdminUserUpdate = { roles?: string[]; status?: "ACTIVE" | "DISABLED" };

export async function updateAdministrator(
  prisma: DatabaseClient,
  actorId: string,
  targetId: string,
  input: AdminUserUpdate,
  requestId?: string
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.adminUser.findUnique({ where: { id: targetId } });
      if (!before) throw new AppError("管理员不存在", "ADMIN_USER_NOT_FOUND", 404);
      if (targetId === actorId && input.status === "DISABLED") {
        throw new AppError("不能停用当前登录账号", "ADMIN_CANNOT_DISABLE_SELF", 409);
      }

      const roles = input.roles === undefined ? undefined : normalizeAdminRoles(input.roles);
      if (roles && !roles.length) throw new AppError("管理员至少需要一个权限", "ADMIN_ROLES_REQUIRED", 400);
      const beforeRoles = normalizeAdminRoles(before.roles);
      const resultingRoles = roles ?? beforeRoles;
      const resultingStatus = input.status ?? before.status;

      if (before.status === "ACTIVE" && beforeRoles.includes("OWNER") && (resultingStatus !== "ACTIVE" || !resultingRoles.includes("OWNER"))) {
        const activeAdministrators = await tx.adminUser.findMany({
          where: { status: "ACTIVE" },
          select: { roles: true }
        });
        const activeOwnerCount = activeAdministrators
          .filter((administrator) => normalizeAdminRoles(administrator.roles).includes("OWNER"))
          .length;
        if (activeOwnerCount <= 1) {
          throw new AppError("必须保留至少一个启用的所有者", "LAST_OWNER_REQUIRED", 409);
        }
      }

      const updated = await tx.adminUser.update({
        where: { id: targetId },
        data: { ...(roles ? { roles } : {}), ...(input.status ? { status: input.status } : {}) }
      });
      const sessionsRevoked = input.status === "DISABLED" || roles !== undefined;
      if (sessionsRevoked) {
        await tx.adminSession.updateMany({
          where: { adminUserId: targetId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      await tx.adminAuditLog.create({
        data: {
          adminUserId: actorId,
          action: "admin.update",
          entityType: "admin_user",
          entityId: updated.id,
          beforeState: { roles: before.roles, status: before.status },
          afterState: { roles: updated.roles, status: updated.status, sessionsRevoked },
          requestId: requestId || null
        }
      });
      return { id: updated.id, username: updated.username, displayName: updated.displayName, roles: updated.roles, status: updated.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      throw new AppError("管理员状态已被并发修改，请刷新后重试", "ADMIN_UPDATE_CONFLICT", 409);
    }
    throw error;
  }
}

export function registerPublicMediaRoutes(app: FastifyInstance, media: MediaService): void {
  app.get<{ Params: { id: string } }>("/api/v1/media/:id", async (request, reply) => {
    const result = await media.readPublic(request.params.id);
    reply.header("Content-Type", result.asset.mimeType);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("ETag", `\"${result.asset.sha256}\"`);
    return reply.send(result.body);
  });
}

export function registerAdminQuestionBankRoutes(
  app: FastifyInstance,
  prisma: DatabaseClient,
  security: AdminSecurity,
  bank: QuestionBankService,
  imports: QuestionImportService,
  media: MediaService
): void {
  app.get("/api/v1/admin/dashboard", { preHandler: security.authenticate }, async () => ({ data: await bank.dashboard() }));
  app.get<{ Querystring: { catalogDraftId?: string } }>("/api/v1/admin/catalog", { preHandler: security.authenticate }, async (request) => ({ data: await bank.adminCatalog(request.query.catalogDraftId) }));

  app.get<{ Querystring: { page?: number; pageSize?: number; status?: string; includeCancelled?: string } }>("/api/v1/admin/catalog-drafts", { preHandler: security.authenticate }, async (request) => ({ data: await bank.listCatalogDrafts(request.query) }));
  app.post<{ Body: { name: string } }>("/api/v1/admin/catalog-drafts", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.createCatalogDraft(request.adminUser!.id, request.body?.name, request.id) }));
  app.get<{ Params: { id: string } }>("/api/v1/admin/catalog-drafts/:id", { preHandler: security.authenticate }, async (request) => ({ data: await bank.getCatalogDraft(request.params.id) }));
  app.patch<{ Params: { id: string }; Body: { revision: number; payload: unknown } }>("/api/v1/admin/catalog-drafts/:id", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.updateCatalogDraft(request.adminUser!.id, request.params.id, request.body.revision, request.body.payload, request.id) }));
  app.post<{ Params: { id: string }; Body: { acknowledgeWarnings?: boolean } }>("/api/v1/admin/catalog-drafts/:id/submit", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.submitCatalogDraft(request.adminUser!.id, request.params.id, Boolean(request.body?.acknowledgeWarnings), request.id) }));
  app.post<{ Params: { id: string }; Body: { decision: "APPROVED" | "REJECTED"; comment?: string; checklist?: string[]; selfReviewNote?: string } }>("/api/v1/admin/catalog-drafts/:id/review", { preHandler: security.requireRole("OWNER", "REVIEWER") }, async (request) => {
    if (!["APPROVED", "REJECTED"].includes(request.body.decision)) throw new AppError("复核结论无效", "INVALID_REVIEW_DECISION", 400);
    return { data: await bank.reviewCatalogDraft(request.adminUser!.id, request.params.id, request.body.decision, request.body.comment, request.id, { checklist: request.body.checklist, selfReviewNote: request.body.selfReviewNote }) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/catalog-drafts/:id/withdraw", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.withdrawCatalogDraft(request.adminUser!.id, request.params.id, request.id) }));
  app.post<{ Params: { id: string } }>("/api/v1/admin/catalog-drafts/:id/cancel", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.cancelCatalogDraft(request.adminUser!.id, request.params.id, request.id) }));

  app.post<{ Body: { id: string; name: string; shortName: string; color?: string; description?: string; iconKey?: string; qualityPolicy?: unknown } }>("/api/v1/admin/subjects", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async () => { throw new AppError("请在目录变更集中编辑学科", "CATALOG_DRAFT_REQUIRED", 409); });

  app.patch<{ Params: { id: string }; Body: { name?: string; shortName?: string; color?: string; description?: string | null; iconKey?: string | null; active?: boolean; qualityPolicy?: unknown } }>("/api/v1/admin/subjects/:id", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async () => { throw new AppError("请在目录变更集中编辑学科", "CATALOG_DRAFT_REQUIRED", 409); });

  app.post<{ Params: { subjectId: string }; Body: { id: string; name: string; description?: string } }>("/api/v1/admin/subjects/:subjectId/chapters", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async () => { throw new AppError("请在目录变更集中编辑章节", "CATALOG_DRAFT_REQUIRED", 409); });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string | null; active?: boolean; order?: number } }>("/api/v1/admin/chapters/:id", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async () => { throw new AppError("请在目录变更集中编辑章节", "CATALOG_DRAFT_REQUIRED", 409); });

  app.put<{ Params: { id: string }; Body: { name: string; subtitle?: string | null; color?: string; type: "SUBJECT" | "GROUP" | "EXAM"; order?: number; active?: boolean; subjectIds: string[] } }>("/api/v1/admin/modules/:id", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async () => { throw new AppError("请在目录变更集中编辑首页模块", "CATALOG_DRAFT_REQUIRED", 409); });

  app.get<{ Querystring: { page?: number; pageSize?: number; search?: string; subjectId?: string; chapterId?: string; type?: string; difficulty?: number; status?: string; publishedFrom?: string; publishedTo?: string } }>("/api/v1/admin/questions", {
    preHandler: security.authenticate
  }, async (request) => ({ data: await bank.listQuestions(request.query) }));

  app.get<{ Querystring: { page?: number; pageSize?: number; status?: string } }>("/api/v1/admin/drafts", {
    preHandler: security.authenticate
  }, async (request) => ({ data: await bank.listDrafts(request.query) }));

  app.post<{ Body: DraftQuestionInput & { action?: "UPSERT" | "DISABLE" } }>("/api/v1/admin/drafts", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await bank.createDraft(request.adminUser!.id, request.body, request.id) }));

  app.patch<{ Params: { id: string }; Body: DraftQuestionInput & { revision: number } }>("/api/v1/admin/drafts/:id", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await bank.updateDraft(request.adminUser!.id, request.params.id, request.body.revision, request.body, request.id) }));

  app.post<{ Params: { id: string }; Body: { acknowledgeWarnings?: boolean } }>("/api/v1/admin/drafts/:id/submit", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await bank.submitDraft(request.adminUser!.id, request.params.id, Boolean(request.body?.acknowledgeWarnings), request.id) }));

  app.post<{ Params: { id: string }; Body: { decision: "APPROVED" | "REJECTED"; comment?: string; checklist?: string[]; selfReviewNote?: string } }>("/api/v1/admin/drafts/:id/review", {
    preHandler: security.requireRole("OWNER", "REVIEWER")
  }, async (request) => {
    if (!["APPROVED", "REJECTED"].includes(request.body.decision)) throw new AppError("复核结论无效", "INVALID_REVIEW_DECISION", 400);
    return { data: await bank.reviewDraft(request.adminUser!.id, request.params.id, request.body.decision, request.body.comment, request.id, { checklist: request.body.checklist, selfReviewNote: request.body.selfReviewNote }) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/drafts/:id/withdraw", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await bank.withdrawDraft(request.adminUser!.id, request.params.id, request.id) }));

  type ReleaseBody = { name: string; draftIds: string[]; catalogDraftId?: string; importBatchIds?: string[]; candidateHash?: string; confirmationText?: string; confirmationTotp?: string };
  app.post<{ Body: ReleaseBody }>("/api/v1/admin/releases/preview", {
    preHandler: security.requireRole("OWNER", "PUBLISHER")
  }, async (request) => ({ data: await bank.previewRelease(request.body) }));

  app.post<{ Body: ReleaseBody }>("/api/v1/admin/releases", {
    preHandler: security.requireRole("OWNER", "PUBLISHER")
  }, async (request) => {
    if (!request.body.confirmationTotp) throw new AppError("发布需要动态验证码", "ADMIN_STEP_UP_REQUIRED", 400);
    await security.verifyStepUp(request, request.body.confirmationTotp);
    return { data: await bank.publish(request.adminUser!.id, request.body.name, request.body.draftIds || [], request.body.catalogDraftId, request.body.importBatchIds || [], request.id, { candidateHash: request.body.candidateHash, confirmationText: request.body.confirmationText }) };
  });

  app.get<{ Querystring: { page?: number; pageSize?: number; status?: string; kind?: string } }>("/api/v1/admin/releases", { preHandler: security.authenticate }, async (request) => ({ data: await bank.listReleases(request.query) }));
  app.post<{ Params: { id: string } }>("/api/v1/admin/releases/:id/rollback/preview", {
    preHandler: security.requireRole("OWNER", "PUBLISHER")
  }, async (request) => ({ data: await bank.previewRollback(request.params.id) }));
  app.post<{ Params: { id: string }; Body: { candidateHash?: string; confirmationText?: string; confirmationTotp?: string } }>("/api/v1/admin/releases/:id/rollback", {
    preHandler: security.requireRole("OWNER", "PUBLISHER")
  }, async (request) => {
    if (!request.body?.confirmationTotp) throw new AppError("回滚需要动态验证码", "ADMIN_STEP_UP_REQUIRED", 400);
    await security.verifyStepUp(request, request.body.confirmationTotp);
    return { data: await bank.rollback(request.adminUser!.id, request.params.id, request.id, { candidateHash: request.body?.candidateHash, confirmationText: request.body?.confirmationText }) };
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/releases/:id/retry-verification", {
    preHandler: security.requireRole("OWNER")
  }, async (request) => ({ data: await bank.retryReleaseVerification(request.adminUser!.id, request.params.id, request.id) }));

  app.get("/api/v1/admin/imports/template", { preHandler: security.authenticate }, async (_request, reply) => {
    attachment(reply, "趣刷题喽题库导入模板.xlsx");
    return reply.send(await imports.template());
  });

  app.post("/api/v1/admin/imports", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => {
    const file = await request.file({ limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
    if (!file) throw new AppError("请选择 XLSX 文件", "IMPORT_FILE_REQUIRED", 400);
    if (!file.filename.toLowerCase().endsWith(".xlsx")) throw new AppError("只支持 XLSX 题库文件", "IMPORT_FILE_TYPE_INVALID", 400);
    return { data: await imports.importWorkbook(request.adminUser!.id, file.filename, await file.toBuffer(), request.id) };
  });

  app.get<{ Querystring: { page?: number; pageSize?: number; status?: string } }>("/api/v1/admin/imports", { preHandler: security.authenticate }, async (request) => ({ data: await imports.listBatches(request.query) }));
  app.get<{ Params: { id: string }; Querystring: { includeRows?: string } }>("/api/v1/admin/imports/:id", { preHandler: security.authenticate }, async (request) => ({
    data: request.query.includeRows === "false"
      ? await imports.getBatchSummary(request.params.id)
      : await imports.getBatch(request.params.id)
  }));
  app.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number; status?: string; entityType?: string } }>("/api/v1/admin/imports/:id/rows", { preHandler: security.authenticate }, async (request) => ({ data: await imports.listBatchRows(request.params.id, request.query) }));
  app.get<{ Params: { id: string } }>("/api/v1/admin/imports/:id/report.xlsx", { preHandler: security.authenticate }, async (request, reply) => {
    attachment(reply, `题库导入校验报告-${request.params.id}.xlsx`);
    return reply.send(await imports.validationReport(request.params.id));
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/imports/:id/revalidate", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await imports.revalidateBatch(request.params.id, request.adminUser!.id, request.id) }));
  app.post<{ Params: { id: string }; Body: { acknowledgeWarnings?: boolean } }>("/api/v1/admin/imports/:id/submit", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await imports.submitBatch(request.adminUser!.id, request.params.id, Boolean(request.body?.acknowledgeWarnings), request.id) }));
  app.post<{ Params: { id: string }; Body: { decision: "APPROVED" | "REJECTED"; comment?: string; checklist?: string[]; selfReviewNote?: string } }>("/api/v1/admin/imports/:id/review", {
    preHandler: security.requireRole("OWNER", "REVIEWER")
  }, async (request) => {
    if (!["APPROVED", "REJECTED"].includes(request.body.decision)) throw new AppError("复核结论无效", "INVALID_REVIEW_DECISION", 400);
    return { data: await imports.reviewBatch(request.adminUser!.id, request.params.id, request.body.decision, request.body.comment, request.id, { checklist: request.body.checklist, selfReviewNote: request.body.selfReviewNote }) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/imports/:id/withdraw", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => ({ data: await imports.withdrawBatch(request.adminUser!.id, request.params.id, request.id) }));
  app.get("/api/v1/admin/exports/current.xlsx", { preHandler: security.authenticate }, async (_request, reply) => {
    attachment(reply, "趣刷题喽当前发布题库.xlsx");
    return reply.send(await imports.exportPublished());
  });

  app.get<{ Querystring: { page?: number; pageSize?: number; status?: string } }>("/api/v1/admin/media", { preHandler: security.authenticate }, async (request) => ({ data: await media.list(request.query) }));
  app.post<{ Body: { fileName: string; mimeType: string; size: number } }>("/api/v1/admin/media/sign", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await media.createSignedUpload(request.adminUser!.id, request.body, request.id) }));
  app.post("/api/v1/admin/media/upload", { preHandler: security.requireRole("OWNER", "EDITOR") }, async (request) => {
    const file = await request.file({ limits: { fileSize: 1024 * 1024, files: 1 } });
    if (!file) throw new AppError("请选择题图", "MEDIA_FILE_REQUIRED", 400);
    return { data: await media.uploadThroughApi(request.adminUser!.id, file.filename, file.mimetype, await file.toBuffer(), request.id) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/media/:id/complete", {
    preHandler: security.requireRole("OWNER", "EDITOR")
  }, async (request) => ({ data: await media.complete(request.adminUser!.id, request.params.id, request.id) }));

  app.get<{ Querystring: { page?: number; pageSize?: number } }>("/api/v1/admin/audit-logs", { preHandler: security.requireRole("OWNER") }, async (request) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 50));
    const [total, items] = await Promise.all([
      prisma.adminAuditLog.count(),
      prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { adminUser: { select: { username: true, displayName: true } } } })
    ]);
    return { data: { page, pageSize, total, items: items.map((item) => ({ ...item, id: item.id.toString() })) } };
  });

  app.get("/api/v1/admin/users", { preHandler: security.requireRole("OWNER") }, async () => ({
    data: await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, username: true, displayName: true, roles: true, status: true, lastLoginAt: true, createdAt: true } })
  }));
  app.patch<{ Params: { id: string }; Body: { roles?: string[]; status?: "ACTIVE" | "DISABLED" } }>("/api/v1/admin/users/:id", { preHandler: security.requireRole("OWNER") }, async (request) => {
    return { data: await updateAdministrator(prisma, request.adminUser!.id, request.params.id, request.body, request.id) };
  });
}
