import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import FormData from "form-data";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createPrismaClient, type DatabaseClient } from "../../src/db.js";
import type { WechatAuthProvider } from "../../src/auth/wechat.js";
import { EMPTY_BASELINE_IMPORT_CONFIRMATION, importQuestions } from "../../src/scripts/import-questions.js";
import type { QuestionSnapshot } from "../../src/domain/questions.js";
import { GamificationService } from "../../src/services/gamification.js";
import { backfillGamification } from "../../src/scripts/backfill-gamification.js";
import { markDatabaseBootstrapPending, markDatabaseBootstrapReady } from "../../src/bootstrap-state.js";
import { createTotpToken, encryptAdminSecret, hashAdminPassword } from "../../src/auth/admin.js";
import { CatalogService } from "../../src/services/catalog.js";
import { QuestionBankService } from "../../src/services/question-bank.js";
import { createQuestionBankStorage } from "../../src/services/question-bank-storage.js";

let prisma: DatabaseClient;
let app: FastifyInstance;
const integrationQuestionBankStorageDirectory = `.question-bank-storage/integration-${Date.now().toString(36)}`;

const wechatProvider: WechatAuthProvider = {
  async exchangeCode(code: string) {
    return { openId: `integration-${code}` };
  }
};

async function login(code: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/wechat/login",
    payload: { code }
  });
  assert.equal(response.statusCode, 200);
  return response.json().data as { accessToken: string; refreshToken: string; user: { id: string } };
}

function authorization(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

type AdminReleaseInput = {
  name: string;
  draftIds: string[];
  catalogDraftId?: string;
  importBatchIds?: string[];
};

async function getReleasePreview(adminApp: FastifyInstance, headers: Record<string, string>, input: AdminReleaseInput) {
  const response = await adminApp.inject({
    method: "POST",
    url: "/api/v1/admin/releases/preview",
    headers,
    payload: input
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as {
    candidateHash: string;
    confirmationText: string;
    summary: {
      added: number;
      revised: number;
      disabled: number;
      catalogChanged: boolean;
      catalogSubjectChanges: number;
      catalogChapterChanges: number;
      importBatchCount: number;
      qualityWarningCount: number;
    };
  };
}

async function publishConfirmed(
  adminApp: FastifyInstance,
  headers: Record<string, string>,
  secret: string,
  input: AdminReleaseInput,
  preview?: Awaited<ReturnType<typeof getReleasePreview>>
) {
  const confirmedPreview = preview || await getReleasePreview(adminApp, headers, input);
  return adminApp.inject({
    method: "POST",
    url: "/api/v1/admin/releases",
    headers,
    payload: {
      ...input,
      candidateHash: confirmedPreview.candidateHash,
      confirmationText: confirmedPreview.confirmationText,
      confirmationTotp: createTotpToken(secret)
    }
  });
}

async function getRollbackPreview(adminApp: FastifyInstance, headers: Record<string, string>, releaseId: string) {
  const response = await adminApp.inject({
    method: "POST",
    url: `/api/v1/admin/releases/${releaseId}/rollback/preview`,
    headers,
    payload: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as { candidateHash: string; confirmationText: string };
}

async function rollbackConfirmed(
  adminApp: FastifyInstance,
  headers: Record<string, string>,
  secret: string,
  releaseId: string,
  preview?: Awaited<ReturnType<typeof getRollbackPreview>>
) {
  const confirmedPreview = preview || await getRollbackPreview(adminApp, headers, releaseId);
  return adminApp.inject({
    method: "POST",
    url: `/api/v1/admin/releases/${releaseId}/rollback`,
    headers,
    payload: {
      candidateHash: confirmedPreview.candidateHash,
      confirmationText: confirmedPreview.confirmationText,
      confirmationTotp: createTotpToken(secret)
    }
  });
}

before(async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("缺少 TEST_DATABASE_URL");
  prisma = createPrismaClient(testUrl);
  await prisma.systemJob.deleteMany();
  await prisma.user.deleteMany();
  const contentDirectory = fileURLToPath(new URL("../../../../content", import.meta.url)).replaceAll("\\", "/");
  if (await prisma.question.count() === 0) {
    await importQuestions(prisma, contentDirectory, {
      confirmation: EMPTY_BASELINE_IMPORT_CONFIRMATION
    });
  }
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: testUrl,
    JWT_ACCESS_SECRET: "integration-test-secret-at-least-thirty-two-characters",
    WECHAT_AUTH_MODE: "stub"
  });
  app = await buildApp({ config, prisma, wechatProvider });
});

after(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await rm(resolve(integrationQuestionBankStorageDirectory), { recursive: true, force: true });
});

describe("真实 MySQL API 闭环", () => {
  it("健康检查和空库基线导入正常", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    markDatabaseBootstrapPending();
    try {
      const pending = await app.inject({ method: "GET", url: "/ready" });
      assert.equal(pending.statusCode, 503);
      assert.equal(pending.json().code, "SERVICE_BOOTSTRAPPING");
      assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
      const gatedCatalog = await app.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(gatedCatalog.statusCode, 503);
      assert.equal(gatedCatalog.json().code, "SERVICE_BOOTSTRAPPING");
    } finally {
      markDatabaseBootstrapReady();
    }
    const readiness = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().data.database, "ok");
    assert.equal(await prisma.question.count() >= 500, true);
    assert.equal(await prisma.question.count({ where: { subjectId: "cpp" } }), 100);
  });

  it("动态目录、管理员双因素认证、跨人复核、原子发布、填空简答和回滚闭环", async () => {
    const activeQuestionCountBefore = await prisma.question.count({ where: { status: "ACTIVE" } });
    const suffix = Date.now().toString(36);
    const ownerSecret = "JBSWY3DPEHPK3PXP";
    const reviewerSecret = "KRSXG5DSNFXGOIDB";
    const encryptionKey = "integration-admin-encryption-key-at-least-32-characters";
    const owner = await prisma.adminUser.create({
      data: {
        username: `owner-${suffix}`,
        displayName: "集成测试所有者",
        passwordHash: await hashAdminPassword("Owner-password-2026-very-strong"),
        totpSecretEncrypted: encryptAdminSecret(ownerSecret, encryptionKey),
        roles: ["OWNER", "EDITOR", "PUBLISHER"]
      }
    });
    const reviewer = await prisma.adminUser.create({
      data: {
        username: `review-${suffix}`,
        displayName: "集成测试复核者",
        passwordHash: await hashAdminPassword("Reviewer-password-2026-strong"),
        totpSecretEncrypted: encryptAdminSecret(reviewerSecret, encryptionKey),
        roles: ["REVIEWER"]
      }
    });
    const adminConfig = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: "integration-test-secret-at-least-thirty-two-characters",
      WECHAT_AUTH_MODE: "stub",
      ADMIN_ENABLED: "true",
      ADMIN_ENCRYPTION_KEY: encryptionKey,
      QUESTION_BANK_STORAGE: "local",
      QUESTION_BANK_STORAGE_DIR: integrationQuestionBankStorageDirectory
    });
    await new QuestionBankService(prisma, adminConfig, createQuestionBankStorage(adminConfig)).ensureBaselineRelease();
    const adminApp = await buildApp({ config: adminConfig, prisma, wechatProvider });

    const loginAdmin = async (username: string, password: string, secret: string) => {
      const response = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        payload: { username, password, totp: createTotpToken(secret) }
      });
      assert.equal(response.statusCode, 200, response.body);
      const setCookie = response.headers["set-cookie"];
      assert.equal(typeof setCookie, "string");
      return {
        cookie: String(setCookie).split(";")[0]!,
        csrf: response.json().data.csrfToken as string
      };
    };
    try {
      const adminPage = await adminApp.inject({ method: "GET", url: "/admin/" });
      assert.equal(adminPage.statusCode, 200, adminPage.body);
      assert.match(adminPage.headers["content-type"] || "", /text\/html/);
      assert.equal(adminPage.headers["cache-control"], "no-store");
      assert.equal(adminPage.headers["x-frame-options"], "DENY");
      assert.match(adminPage.headers["content-security-policy"] || "", /frame-ancestors 'none'/);
      assert.match(adminPage.headers["content-security-policy"] || "", /base-uri 'none'/);
      const assetPath = adminPage.body.match(/(?:src|href)="(\/admin\/assets\/[^"]+)"/)?.[1];
      assert.ok(assetPath);
      assert.equal((await adminApp.inject({ method: "GET", url: assetPath })).statusCode, 200);
      const invalidTotp = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        payload: { username: owner.username, password: "Owner-password-2026-very-strong", totp: "000000" }
      });
      assert.equal(invalidTotp.statusCode, 401);
      const ownerSession = await loginAdmin(owner.username, "Owner-password-2026-very-strong", ownerSecret);
      const reviewerSession = await loginAdmin(reviewer.username, "Reviewer-password-2026-strong", reviewerSecret);
      const ownerHeaders = { cookie: ownerSession.cookie, "x-csrf-token": ownerSession.csrf };
      const reviewerHeaders = { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf };

      const disposableCatalogDraft = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/catalog-drafts", headers: ownerHeaders,
        payload: { name: "discarded catalog draft" }
      });
      assert.equal(disposableCatalogDraft.statusCode, 200, disposableCatalogDraft.body);
      const disposableCatalogDraftId = disposableCatalogDraft.json().data.id as string;
      const cancelledCatalogDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${disposableCatalogDraftId}/cancel`, headers: ownerHeaders,
        payload: {}
      });
      assert.equal(cancelledCatalogDraft.statusCode, 200, cancelledCatalogDraft.body);
      assert.equal(cancelledCatalogDraft.json().data.status, "CANCELLED");
      const activeCatalogDraftList = await adminApp.inject({ method: "GET", url: "/api/v1/admin/catalog-drafts", headers: ownerHeaders });
      assert.equal(activeCatalogDraftList.statusCode, 200, activeCatalogDraftList.body);
      assert.equal(activeCatalogDraftList.json().data.items.some((item: { id: string }) => item.id === disposableCatalogDraftId), false);
      const fullCatalogDraftList = await adminApp.inject({ method: "GET", url: "/api/v1/admin/catalog-drafts?includeCancelled=1", headers: ownerHeaders });
      assert.equal(fullCatalogDraftList.statusCode, 200, fullCatalogDraftList.body);
      assert.equal(fullCatalogDraftList.json().data.items.some((item: { id: string; status: string }) => item.id === disposableCatalogDraftId && item.status === "CANCELLED"), true);
      const editCancelledCatalogDraft = await adminApp.inject({
        method: "PATCH", url: `/api/v1/admin/catalog-drafts/${disposableCatalogDraftId}`, headers: ownerHeaders,
        payload: { revision: cancelledCatalogDraft.json().data.revision, payload: cancelledCatalogDraft.json().data.payload }
      });
      assert.equal(editCancelledCatalogDraft.statusCode, 409, editCancelledCatalogDraft.body);
      assert.equal(editCancelledCatalogDraft.json().code, "CATALOG_DRAFT_NOT_EDITABLE");
      assert.equal(await prisma.adminAuditLog.count({ where: { action: "catalog_draft.cancel", entityId: disposableCatalogDraftId } }), 1);

      const noCsrf = await adminApp.inject({ method: "POST", url: "/api/v1/admin/subjects", headers: { cookie: ownerSession.cookie }, payload: {} });
      assert.equal(noCsrf.statusCode, 403);
      assert.equal(noCsrf.json().code, "ADMIN_CSRF_INVALID");

      const subjectId = `qa-${suffix}`;
      const chapterId = `${subjectId}-basic`;
      const subject = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/subjects", headers: ownerHeaders,
        payload: { id: subjectId, name: "质量验证", shortName: "验证", color: "#2563eb", description: "自动化管理流程验证" }
      });
      assert.equal(subject.statusCode, 409, subject.body);
      assert.equal(subject.json().code, "CATALOG_DRAFT_REQUIRED");
      const chapter = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/subjects/${subjectId}/chapters`, headers: ownerHeaders,
        payload: { id: chapterId, name: "基础验证" }
      });
      assert.equal(chapter.statusCode, 409, chapter.body);
      assert.equal(chapter.json().code, "CATALOG_DRAFT_REQUIRED");

      const createdCatalogDraft = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/catalog-drafts", headers: ownerHeaders,
        payload: { name: "integration catalog addition" }
      });
      assert.equal(createdCatalogDraft.statusCode, 200, createdCatalogDraft.body);
      const catalogDraft = createdCatalogDraft.json().data as {
        id: string;
        revision: number;
        payload: {
          modules: Array<{ id: string; name: string; subtitle: string | null; color: string; type: string; order: number; active: boolean; subjects: Array<{ subjectId: string; order: number }> }>;
          subjects: Array<{ id: string; name: string; shortName: string; order: number; color: string; description: string | null; iconKey: string | null; qualityPolicy: unknown; active: boolean }>;
          chapters: Array<{ id: string; subjectId: string; name: string; order: number; active: boolean; description: string | null }>;
        };
      };
      const catalogPayload = structuredClone(catalogDraft.payload);
      const nextSubjectOrder = Math.max(-1, ...catalogPayload.subjects.map((item) => item.order)) + 1;
      const nextModuleOrder = Math.max(-1, ...catalogPayload.modules.map((item) => item.order)) + 1;
      catalogPayload.subjects.push({
        id: subjectId, name: "Integration quality", shortName: "Quality", order: nextSubjectOrder,
        color: "#2563eb", description: "Managed catalog integration flow", iconKey: null, qualityPolicy: null, active: true
      });
      catalogPayload.chapters.push({
        id: chapterId, subjectId, name: "Integration basics", order: 0, active: true, description: null
      });
      catalogPayload.modules.push({
        id: subjectId, name: "Integration quality", subtitle: "Managed catalog integration flow", color: "#2563eb",
        type: "SUBJECT", order: nextModuleOrder, active: true, subjects: [{ subjectId, order: 0 }]
      });
      const updatedCatalogDraft = await adminApp.inject({
        method: "PATCH", url: `/api/v1/admin/catalog-drafts/${catalogDraft.id}`, headers: ownerHeaders,
        payload: { revision: catalogDraft.revision, payload: catalogPayload }
      });
      assert.equal(updatedCatalogDraft.statusCode, 200, updatedCatalogDraft.body);
      const submittedCatalogDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${catalogDraft.id}/submit`, headers: ownerHeaders,
        payload: { acknowledgeWarnings: true }
      });
      assert.equal(submittedCatalogDraft.statusCode, 200, submittedCatalogDraft.body);
      const selfReviewCatalog = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${catalogDraft.id}/review`, headers: ownerHeaders,
        payload: { decision: "APPROVED" }
      });
      assert.equal(selfReviewCatalog.statusCode, 403, selfReviewCatalog.body);
      assert.equal(selfReviewCatalog.json().code, "SELF_REVIEW_FORBIDDEN");
      const reviewedCatalogDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${catalogDraft.id}/review`, headers: reviewerHeaders,
        payload: { decision: "APPROVED", comment: "catalog structure approved" }
      });
      assert.equal(reviewedCatalogDraft.statusCode, 200, reviewedCatalogDraft.body);
      const unpublishedCatalog = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(unpublishedCatalog.statusCode, 200, unpublishedCatalog.body);
      assert.equal(unpublishedCatalog.json().data.modules.some((module: { id: string }) => module.id === subjectId), false);

      const forbiddenCatalogPublish = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/releases", headers: reviewerHeaders,
        payload: { name: "forbidden catalog publish", draftIds: [], catalogDraftId: catalogDraft.id }
      });
      assert.equal(forbiddenCatalogPublish.statusCode, 403, forbiddenCatalogPublish.body);
      const initialCatalogInput = { name: "integration catalog addition", draftIds: [], catalogDraftId: catalogDraft.id };
      const initialCatalogPreview = await getReleasePreview(adminApp, ownerHeaders, initialCatalogInput);
      assert.equal(initialCatalogPreview.summary.catalogChanged, true);
      const initialCatalogRelease = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, initialCatalogInput, initialCatalogPreview);
      assert.equal(initialCatalogRelease.statusCode, 200, initialCatalogRelease.body);
      assert.equal(initialCatalogRelease.json().data.questionCount, activeQuestionCountBefore);
      const cancelPublishedCatalogDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${catalogDraft.id}/cancel`, headers: ownerHeaders,
        payload: {}
      });
      assert.equal(cancelPublishedCatalogDraft.statusCode, 409, cancelPublishedCatalogDraft.body);
      assert.equal(cancelPublishedCatalogDraft.json().code, "CATALOG_DRAFT_NOT_CANCELLABLE");
      const catalogAfterInitialRelease = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(catalogAfterInitialRelease.statusCode, 200, catalogAfterInitialRelease.body);
      assert.equal(catalogAfterInitialRelease.json().data.modules.some((module: { id: string }) => module.id === subjectId), false);
      assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } })).active, true);

      const createDraft = (payload: Record<string, unknown>) => adminApp.inject({ method: "POST", url: "/api/v1/admin/drafts", headers: ownerHeaders, payload });
      const fillDraftResponse = await createDraft({
        externalCode: `QA-FILL-${suffix}`, subjectId, chapterId, type: "FILL_BLANK", stem: "HTTP 默认端口是？",
        explanation: "HTTP 的默认明文服务端口是 80。", difficulty: 1, tags: ["网络"], acceptedAnswers: [["80"]], options: [], correctOptionIds: [], examScopes: [], images: []
      });
      assert.equal(fillDraftResponse.statusCode, 200, fillDraftResponse.body);
      const shortDraftResponse = await createDraft({
        externalCode: `QA-SHORT-${suffix}`, subjectId, chapterId, type: "SHORT_ANSWER", stem: "简述发布回滚的意义。",
        explanation: "回滚用于在内容异常时恢复已验证版本。", difficulty: 2, tags: ["发布"], referenceAnswer: "恢复到已验证题库版本，同时保留完整发布历史。", options: [], correctOptionIds: [], examScopes: [], images: []
      });
      assert.equal(shortDraftResponse.statusCode, 200, shortDraftResponse.body);
      const draftIds = [fillDraftResponse.json().data.id, shortDraftResponse.json().data.id] as string[];
      const importSourceHash = suffix.replaceAll("-", "").padEnd(64, "a").slice(0, 64);
      const importBatch = await prisma.questionImportBatch.create({
        data: {
          fileName: "catalog-candidate.xlsx",
          sourceHash: importSourceHash,
          status: "VALID",
          totalRows: 4,
          validRows: 4,
          createdById: owner.id,
          rows: {
            create: [
              {
                rowNumber: 2,
                entityType: "subject",
                rawData: { subject_id: subjectId, name: "Imported candidate name", short_name: "Candidate", color: "#7c3aed", description: "Published only with the complete import batch", quality_policy_json: "" },
                normalizedData: { id: subjectId, name: "Imported candidate name", shortName: "Candidate", color: "#7c3aed", description: "Published only with the complete import batch" },
                errors: [], warnings: []
              },
              {
                rowNumber: 2,
                entityType: "chapter",
                rawData: { chapter_id: chapterId, subject_id: subjectId, name: "Imported candidate chapter", description: "" },
                normalizedData: { id: chapterId, subjectId, name: "Imported candidate chapter", description: null },
                errors: [], warnings: []
              },
              {
                rowNumber: 2,
                entityType: "question",
                rawData: {
                  question_id: "", external_code: `QA-FILL-${suffix}`, subject_id: subjectId, chapter_id: chapterId,
                  type: "fill_blank", stem: "What is the default HTTP port?", code: "", explanation: "The default port for plain HTTP traffic is port 80.", difficulty: "1",
                  tags: "network", exam_scopes: "", correct_option_ids: "", accepted_answers_json: "[[\"80\"]]",
                  case_sensitive: "no", punctuation_sensitive: "no", reference_answer: "", images_json: "[]"
                },
                normalizedData: { questionId: fillDraftResponse.json().data.questionId },
                errors: [], warnings: [], draftId: draftIds[0]
              },
              {
                rowNumber: 3,
                entityType: "question",
                rawData: {
                  question_id: "", external_code: `QA-SHORT-${suffix}`, subject_id: subjectId, chapter_id: chapterId,
                  type: "short_answer", stem: "Why is release rollback useful?", code: "", explanation: "Rollback restores a verified question-bank version while preserving release history.", difficulty: "2",
                  tags: "release", exam_scopes: "", correct_option_ids: "", accepted_answers_json: "[]",
                  case_sensitive: "no", punctuation_sensitive: "no", reference_answer: "Restore a verified version while retaining the immutable release history.", images_json: "[]"
                },
                normalizedData: { questionId: shortDraftResponse.json().data.questionId },
                errors: [], warnings: [], draftId: draftIds[1]
              }
            ]
          }
        }
      });
      const submittedImport = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/imports/${importBatch.id}/submit`, headers: ownerHeaders,
        payload: { acknowledgeWarnings: true }
      });
      assert.equal(submittedImport.statusCode, 200, submittedImport.body);
      assert.match(submittedImport.json().data.contentHash, /^[a-f0-9]{64}$/);
      const directImportedDraftReview = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/drafts/${draftIds[0]}/review`, headers: reviewerHeaders,
        payload: { decision: "APPROVED" }
      });
      assert.equal(directImportedDraftReview.statusCode, 409, directImportedDraftReview.body);
      assert.equal(directImportedDraftReview.json().code, "IMPORT_BATCH_REVIEW_REQUIRED");
      const selfReviewImport = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/imports/${importBatch.id}/review`, headers: ownerHeaders,
        payload: { decision: "APPROVED" }
      });
      assert.equal(selfReviewImport.statusCode, 403, selfReviewImport.body);
      assert.equal(selfReviewImport.json().code, "SELF_REVIEW_FORBIDDEN");
      const reviewedImport = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/imports/${importBatch.id}/review`, headers: reviewerHeaders,
        payload: { decision: "APPROVED", comment: "whole workbook approved" }
      });
      assert.equal(reviewedImport.statusCode, 200, reviewedImport.body);
      assert.equal(reviewedImport.json().data.status, "APPROVED");
      assert.equal(await prisma.questionDraft.count({ where: { id: { in: draftIds }, status: "APPROVED" } }), 2);
      const subjectBeforePartialRelease = await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } });
      const partialImportRelease = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/releases/preview", headers: ownerHeaders,
        payload: { name: "partial import must fail", draftIds: [draftIds[0]] }
      });
      assert.equal(partialImportRelease.statusCode, 409, partialImportRelease.body);
      assert.equal(partialImportRelease.json().code, "IMPORT_BATCH_PARTIAL_RELEASE");
      assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } })).name, subjectBeforePartialRelease.name);
      const forbiddenPublish = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/releases", headers: reviewerHeaders, payload: { name: "越权发布", draftIds }
      });
      assert.equal(forbiddenPublish.statusCode, 403);
      const publishInput = { name: "集成测试小批次", draftIds };
      const publishPreview = await getReleasePreview(adminApp, ownerHeaders, publishInput);
      assert.equal(publishPreview.summary.catalogChanged, true);
      assert.equal(publishPreview.summary.catalogSubjectChanges, 1);
      assert.equal(publishPreview.summary.catalogChapterChanges, 1);
      assert.equal(publishPreview.summary.importBatchCount, 1);
      const staleCandidate = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/releases",
        headers: ownerHeaders,
        payload: {
          ...publishInput,
          candidateHash: "0".repeat(64),
          confirmationText: publishPreview.confirmationText,
          confirmationTotp: createTotpToken(ownerSecret)
        }
      });
      assert.equal(staleCandidate.statusCode, 409, staleCandidate.body);
      assert.equal(staleCandidate.json().code, "RELEASE_CANDIDATE_STALE");
      const published = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, publishInput, publishPreview);
      assert.equal(published.statusCode, 200, published.body);
      assert.equal(published.json().data.questionCount, activeQuestionCountBefore + 2);
      assert.match(published.json().data.snapshotHash, /^[a-f0-9]{64}$/);
      assert.equal(published.json().data.verificationStatus, "PASSED");
      assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } })).name, "Imported candidate name");
      assert.equal((await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } })).name, "Imported candidate chapter");

      const directoryOnlyBatch = await prisma.questionImportBatch.create({
        data: {
          fileName: "directory-only.xlsx",
          sourceHash: `${importSourceHash.slice(0, 63)}b`,
          status: "VALID",
          totalRows: 1,
          validRows: 1,
          createdById: owner.id,
          rows: {
            create: [{
              rowNumber: 2,
              entityType: "subject",
              rawData: {
                subject_id: subjectId,
                name: "Directory import update",
                short_name: "Candidate",
                color: "#0f766e",
                description: "Directory-only workbook release",
                quality_policy_json: ""
              },
              normalizedData: {
                id: subjectId, name: "Directory import update", shortName: "Candidate", color: "#0f766e",
                description: "Directory-only workbook release", qualityPolicy: null
              },
              errors: [], warnings: []
            }]
          }
        }
      });
      const submittedDirectoryBatch = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/imports/${directoryOnlyBatch.id}/submit`, headers: ownerHeaders,
        payload: { acknowledgeWarnings: true }
      });
      assert.equal(submittedDirectoryBatch.statusCode, 200, submittedDirectoryBatch.body);
      const reviewedDirectoryBatch = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/imports/${directoryOnlyBatch.id}/review`, headers: reviewerHeaders,
        payload: { decision: "APPROVED", comment: "directory-only workbook approved" }
      });
      assert.equal(reviewedDirectoryBatch.statusCode, 200, reviewedDirectoryBatch.body);
      const directoryOnlyInput = { name: "directory-only import release", draftIds: [], importBatchIds: [directoryOnlyBatch.id] };
      const directoryOnlyPreview = await getReleasePreview(adminApp, ownerHeaders, directoryOnlyInput);
      assert.equal(directoryOnlyPreview.summary.catalogChanged, true);
      assert.equal(directoryOnlyPreview.summary.catalogSubjectChanges, 1);
      assert.equal(directoryOnlyPreview.summary.catalogChapterChanges, 0);
      const directoryOnlyRelease = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, directoryOnlyInput, directoryOnlyPreview);
      assert.equal(directoryOnlyRelease.statusCode, 200, directoryOnlyRelease.body);
      assert.equal(directoryOnlyRelease.json().data.questionCount, activeQuestionCountBefore + 2);
      assert.equal(directoryOnlyRelease.json().data.verificationStatus, "PASSED");
      assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: subjectId } })).name, "Directory import update");

      const catalog = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(catalog.statusCode, 200, catalog.body);
      assert.equal(catalog.json().data.modules.some((module: { id: string }) => module.id === subjectId), true);
      const publishedCatalogVersion = catalog.json().data.version;
      const renamedSubject = await adminApp.inject({
        method: "PATCH",
        url: `/api/v1/admin/subjects/${subjectId}`,
        headers: ownerHeaders,
        payload: { name: "质量验证（待发布）" }
      });
      assert.equal(renamedSubject.statusCode, 409, renamedSubject.body);
      assert.equal(renamedSubject.json().code, "CATALOG_DRAFT_REQUIRED");
      const beforeCatalogRelease = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(beforeCatalogRelease.statusCode, 200, beforeCatalogRelease.body);
      assert.equal(beforeCatalogRelease.json().data.version, publishedCatalogVersion);
      const beforeSubject = beforeCatalogRelease.json().data.modules
        .flatMap((module: { subjects: Array<{ id: string; name: string }> }) => module.subjects)
        .find((item: { id: string }) => item.id === subjectId);
      assert.equal(beforeSubject.name, "Directory import update");
      const createdRenameDraft = await adminApp.inject({
        method: "POST", url: "/api/v1/admin/catalog-drafts", headers: ownerHeaders,
        payload: { name: "integration catalog rename" }
      });
      assert.equal(createdRenameDraft.statusCode, 200, createdRenameDraft.body);
      const renameDraft = createdRenameDraft.json().data as typeof catalogDraft;
      const renamePayload = structuredClone(renameDraft.payload);
      const renameTarget = renamePayload.subjects.find((item) => item.id === subjectId);
      assert.ok(renameTarget);
      renameTarget.name = "Integration quality (published)";
      const updatedRenameDraft = await adminApp.inject({
        method: "PATCH", url: `/api/v1/admin/catalog-drafts/${renameDraft.id}`, headers: ownerHeaders,
        payload: { revision: renameDraft.revision, payload: renamePayload }
      });
      assert.equal(updatedRenameDraft.statusCode, 200, updatedRenameDraft.body);
      const submittedRenameDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${renameDraft.id}/submit`, headers: ownerHeaders,
        payload: { acknowledgeWarnings: true }
      });
      assert.equal(submittedRenameDraft.statusCode, 200, submittedRenameDraft.body);
      const reviewedRenameDraft = await adminApp.inject({
        method: "POST", url: `/api/v1/admin/catalog-drafts/${renameDraft.id}/review`, headers: reviewerHeaders,
        payload: { decision: "APPROVED", comment: "catalog rename approved" }
      });
      assert.equal(reviewedRenameDraft.statusCode, 200, reviewedRenameDraft.body);
      const catalogReleaseInput = { name: "目录配置发布", draftIds: [], catalogDraftId: renameDraft.id };
      const catalogRelease = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, catalogReleaseInput);
      assert.equal(catalogRelease.statusCode, 200, catalogRelease.body);
      const afterCatalogRelease = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      assert.equal(afterCatalogRelease.statusCode, 200, afterCatalogRelease.body);
      assert.notEqual(afterCatalogRelease.json().data.version, publishedCatalogVersion);
      const afterSubject = afterCatalogRelease.json().data.modules
        .flatMap((module: { subjects: Array<{ id: string; name: string }> }) => module.subjects)
        .find((item: { id: string }) => item.id === subjectId);
      assert.equal(afterSubject.name, "Integration quality (published)");
      await new CatalogService(prisma).ensureBaseline();
      const afterBootstrap = await adminApp.inject({ method: "GET", url: "/api/v1/catalog" });
      const afterBootstrapSubject = afterBootstrap.json().data.modules
        .flatMap((module: { subjects: Array<{ id: string; name: string }> }) => module.subjects)
        .find((item: { id: string }) => item.id === subjectId);
      assert.equal(afterBootstrapSubject.name, "Integration quality (published)");
      const noChangeRelease = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/releases/preview",
        headers: ownerHeaders,
        payload: { name: "无变更目录发布", draftIds: [] }
      });
      assert.equal(noChangeRelease.statusCode, 409, noChangeRelease.body);
      assert.equal(noChangeRelease.json().code, "RELEASE_NO_CHANGES");

      const frozenDraftResponse = await createDraft({
        externalCode: `QA-FROZEN-${suffix}`,
        subjectId,
        chapterId,
        type: "SINGLE",
        stem: "Which release gate prevents publishing after failed verification?",
        explanation: "A frozen catalog blocks subsequent releases until verification recovers.",
        difficulty: 2,
        tags: ["release-gate"],
        images: [],
        examScopes: [],
        options: [{ id: "A", label: "A", text: "publishFrozen" }, { id: "B", label: "B", text: "pageSize" }],
        correctOptionIds: ["A"]
      });
      assert.equal(frozenDraftResponse.statusCode, 200, frozenDraftResponse.body);
      const frozenDraftId = frozenDraftResponse.json().data.id as string;
      assert.equal((await adminApp.inject({ method: "POST", url: `/api/v1/admin/drafts/${frozenDraftId}/submit`, headers: ownerHeaders, payload: { acknowledgeWarnings: true } })).statusCode, 200);
      assert.equal((await adminApp.inject({ method: "POST", url: `/api/v1/admin/drafts/${frozenDraftId}/review`, headers: reviewerHeaders, payload: { decision: "APPROVED" } })).statusCode, 200);
      const frozenInput = { name: "frozen publish must fail", draftIds: [frozenDraftId] };
      const frozenPreview = await getReleasePreview(adminApp, ownerHeaders, frozenInput);

      const currentSnapshotPath = resolve(adminConfig.questionBankStorageDir, catalogRelease.json().data.snapshotKey as string);
      const currentSnapshot = await readFile(currentSnapshotPath);
      await writeFile(currentSnapshotPath, Buffer.concat([currentSnapshot, Buffer.from("tampered")]));
      const failedVerification = await adminApp.inject({
        method: "POST",
        url: `/api/v1/admin/releases/${catalogRelease.json().data.id}/retry-verification`,
        headers: ownerHeaders,
        payload: {}
      });
      assert.equal(failedVerification.statusCode, 503, failedVerification.body);
      assert.equal(failedVerification.json().code, "RELEASE_VERIFICATION_FAILED");
      assert.equal((await prisma.catalogState.findUniqueOrThrow({ where: { id: 1 } })).publishFrozen, true);
      const frozenPublish = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, frozenInput, frozenPreview);
      assert.equal(frozenPublish.statusCode, 409, frozenPublish.body);
      assert.equal(frozenPublish.json().code, "RELEASE_PUBLISH_FROZEN");
      await writeFile(currentSnapshotPath, currentSnapshot);
      const recoveredVerification = await adminApp.inject({
        method: "POST",
        url: `/api/v1/admin/releases/${catalogRelease.json().data.id}/retry-verification`,
        headers: ownerHeaders,
        payload: {}
      });
      assert.equal(recoveredVerification.statusCode, 200, recoveredVerification.body);
      assert.equal(recoveredVerification.json().data.verificationStatus, "PASSED");
      assert.equal((await prisma.catalogState.findUniqueOrThrow({ where: { id: 1 } })).publishFrozen, false);
      const pagedImports = await adminApp.inject({ method: "GET", url: "/api/v1/admin/imports?page=1&pageSize=1&status=PUBLISHED", headers: { cookie: ownerSession.cookie } });
      assert.equal(pagedImports.statusCode, 200, pagedImports.body);
      assert.equal(pagedImports.json().data.pageSize, 1);
      assert.equal(pagedImports.json().data.items.length, 1);
      assert.equal(pagedImports.json().data.total >= 2, true);
      const pagedReleases = await adminApp.inject({ method: "GET", url: "/api/v1/admin/releases?page=1&pageSize=2", headers: { cookie: ownerSession.cookie } });
      assert.equal(pagedReleases.statusCode, 200, pagedReleases.body);
      assert.equal(pagedReleases.json().data.items.length, 2);
      assert.equal(pagedReleases.json().data.total >= 5, true);
      const pagedMedia = await adminApp.inject({ method: "GET", url: "/api/v1/admin/media?page=1&pageSize=5", headers: { cookie: ownerSession.cookie } });
      assert.equal(pagedMedia.statusCode, 200, pagedMedia.body);
      assert.deepEqual(pagedMedia.json().data.items, []);

      const learner = await login(`managed-types-${suffix}`);
      const sessionResponse = await app.inject({
        method: "POST", url: "/api/v1/practice-sessions", headers: authorization(learner.accessToken),
        payload: { scope: "subject", subject: subjectId, mode: "random", count: 5 }
      });
      assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
      const session = sessionResponse.json().data as { id: string; questions: Array<Record<string, unknown>> };
      assert.equal(session.questions.length, 2);
      const fillQuestion = session.questions.find((question) => question.type === "fill_blank")!;
      const shortQuestion = session.questions.find((question) => question.type === "short_answer")!;
      assert.equal(fillQuestion.acceptedAnswers, undefined);
      assert.equal(shortQuestion.referenceAnswer, undefined);

      const fillAnswer = await app.inject({
        method: "POST", url: `/api/v1/practice-sessions/${session.id}/answers`, headers: authorization(learner.accessToken),
        payload: { questionId: fillQuestion.id, answer: { kind: "fill", values: [" ８０ "] }, clientAnswerId: `fill-${suffix}` }
      });
      assert.equal(fillAnswer.statusCode, 200, fillAnswer.body);
      assert.equal(fillAnswer.json().data.isCorrect, true);
      assert.deepEqual(fillAnswer.json().data.acceptedAnswers, [["80"]]);
      const shortAnswer = await app.inject({
        method: "POST", url: `/api/v1/practice-sessions/${session.id}/answers`, headers: authorization(learner.accessToken),
        payload: { questionId: shortQuestion.id, answer: { kind: "short", value: "发生问题时恢复旧版本" }, clientAnswerId: `short-${suffix}` }
      });
      assert.equal(shortAnswer.statusCode, 200, shortAnswer.body);
      assert.equal(shortAnswer.json().data.evaluationRequired, true);
      assert.equal(shortAnswer.json().data.pointsAwarded, 2);
      assert.equal(typeof shortAnswer.json().data.referenceAnswer, "string");
      const assessed = await app.inject({
        method: "POST", url: `/api/v1/practice-sessions/${session.id}/answers/${shortQuestion.id}/self-assessment`, headers: authorization(learner.accessToken),
        payload: { assessment: "unmastered" }
      });
      assert.equal(assessed.statusCode, 200, assessed.body);
      assert.equal(assessed.json().data.isCorrect, false);
      const finished = await app.inject({ method: "POST", url: `/api/v1/practice-sessions/${session.id}/finish`, headers: authorization(learner.accessToken) });
      assert.equal(finished.statusCode, 200, finished.body);
      assert.equal(await prisma.wrongQuestionRecord.count({ where: { userId: learner.user.id, questionId: String(shortQuestion.id), mastered: false } }), 1);

      const snapshotKey = published.json().data.snapshotKey as string;
      const snapshotPath = resolve(adminConfig.questionBankStorageDir, snapshotKey);
      const originalSnapshot = await readFile(snapshotPath);
      await writeFile(snapshotPath, Buffer.concat([originalSnapshot, Buffer.from(" ")]));
      const tamperedRollbackPreview = await getRollbackPreview(adminApp, ownerHeaders, published.json().data.id);
      const tamperedRollback = await rollbackConfirmed(adminApp, ownerHeaders, ownerSecret, published.json().data.id, tamperedRollbackPreview);
      assert.equal(tamperedRollback.statusCode, 409, tamperedRollback.body);
      assert.equal(tamperedRollback.json().code, "ROLLBACK_SNAPSHOT_HASH_MISMATCH");
      await writeFile(snapshotPath, originalSnapshot);

      const rolledBack = await rollbackConfirmed(adminApp, ownerHeaders, ownerSecret, published.json().data.id);
      assert.equal(rolledBack.statusCode, 200, rolledBack.body);
      assert.equal(rolledBack.json().data.kind, "ROLLBACK");
      assert.equal(await prisma.adminAuditLog.count({ where: { adminUserId: owner.id } }) > 0, true);
    } finally {
      await adminApp.close();
    }
  });

  it("云托管身份头完成登录、删除和重新开户，并拒绝缺少可信来源的请求", async () => {
    const cloudConfig = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      WECHAT_AUTH_MODE: "cloud"
    });
    const cloudApp = await buildApp({ config: cloudConfig, prisma });
    const headers = {
      "x-wx-source": "wx_client",
      "x-wx-openid": "integration-cloud-user"
    };
    try {
      const missingSource = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers: { "x-wx-openid": headers["x-wx-openid"] }
      });
      assert.equal(missingSource.statusCode, 401);
      assert.equal(missingSource.json().code, "CLOUD_IDENTITY_MISSING");

      const loggedIn = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers
      });
      assert.equal(loggedIn.statusCode, 200, loggedIn.body);
      assert.equal(loggedIn.json().data.authenticated, true);

      const me = await cloudApp.inject({ method: "GET", url: "/api/v1/users/me", headers });
      assert.equal(me.statusCode, 200, me.body);
      assert.equal(me.json().data.id, loggedIn.json().data.user.id);

      const deleted = await cloudApp.inject({ method: "DELETE", url: "/api/v1/users/me", headers });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.equal(deleted.json().data.deleted, true);

      const afterDelete = await cloudApp.inject({ method: "GET", url: "/api/v1/users/me", headers });
      assert.equal(afterDelete.statusCode, 401, afterDelete.body);
      assert.equal(afterDelete.json().code, "UNAUTHORIZED");

      const reloggedIn = await cloudApp.inject({
        method: "POST",
        url: "/api/v1/auth/wechat/cloud-login",
        headers
      });
      assert.equal(reloggedIn.statusCode, 200, reloggedIn.body);
      assert.notEqual(reloggedIn.json().data.user.id, loggedIn.json().data.user.id);
    } finally {
      await cloudApp.close();
    }
  });

  it("刷新令牌只能轮换使用一次", async () => {
    const user = await login("refresh-user");
    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(refreshed.statusCode, 200);
    assert.notEqual(refreshed.json().data.refreshToken, user.refreshToken);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().code, "UNAUTHORIZED");
  });

  it("历史回填重建积分、成就与默认称号，并可安全重复执行", async () => {
    const owner = await login("gamification-backfill-owner");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { subject: "cpp", mode: "random", count: 5 }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().data.id as string;
    const item = await prisma.practiceSessionQuestion.findFirstOrThrow({ where: { sessionId }, orderBy: { position: "asc" } });
    const snapshot = item.snapshot as unknown as QuestionSnapshot;
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${sessionId}/answers`,
      headers: authorization(owner.accessToken),
      payload: {
        questionId: item.questionId,
        selectedOptionIds: snapshot.correctOptionIds,
        clientAnswerId: `backfill-${sessionId}`
      }
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    const answerId = (await prisma.practiceAnswer.findFirstOrThrow({ where: { sessionId } })).id;
    await prisma.pointEvent.deleteMany({ where: { userId: owner.user.id } });
    await prisma.userAchievement.deleteMany({ where: { userId: owner.user.id } });
    await prisma.userGamification.delete({ where: { userId: owner.user.id } });
    await prisma.practiceAnswer.update({ where: { id: answerId }, data: { pointsAwarded: 0, unlockedAchievements: [] } });

    const firstRun = await backfillGamification(prisma);
    assert(firstRun.usersProcessed >= 1);
    const profile = await prisma.userGamification.findUniqueOrThrow({ where: { userId: owner.user.id } });
    assert.equal(profile.totalPoints, 10);
    assert.equal(profile.equippedAchievementKey, "first-step");
    assert.equal((await prisma.practiceAnswer.findUniqueOrThrow({ where: { id: answerId } })).pointsAwarded, 10);
    const eventCount = await prisma.pointEvent.count({ where: { userId: owner.user.id } });
    assert.deepEqual(await backfillGamification(prisma), { usersProcessed: 0 });
    assert.equal(await prisma.pointEvent.count({ where: { userId: owner.user.id } }), eventCount);
  });

  it("删除账户会级联清除数据并立即使全部令牌失效", async () => {
    const user = await login("delete-account-user");
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/users/me",
      headers: authorization(user.accessToken)
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().data.deleted, true);
    assert.equal(await prisma.user.count({ where: { id: user.user.id } }), 0);

    const accessReplay = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: authorization(user.accessToken)
    });
    assert.equal(accessReplay.statusCode, 401);
    assert.equal(accessReplay.json().code, "UNAUTHORIZED");

    const refreshReplay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: user.refreshToken }
    });
    assert.equal(refreshReplay.statusCode, 401);
    assert.equal(refreshReplay.json().code, "UNAUTHORIZED");
  });

  it("408题池不足时不创建任何试卷", async () => {
    const candidates = await prisma.question.findMany({
      where: { subjectId: "ds", status: "ACTIVE", currentVersion: { is: { type: "SINGLE" } } },
      include: { currentVersion: true }
    });
    const eligible = candidates.filter((question) => {
      const scopes = question.currentVersion?.examScopes;
      return Array.isArray(scopes) && scopes.map(String).includes("408");
    });
    assert(eligible.length >= 12);
    const disabledIds = eligible.slice(11).map((question) => question.id);
    await prisma.question.updateMany({ where: { id: { in: disabledIds } }, data: { status: "DISABLED" } });
    try {
      const owner = await login("insufficient-exam-owner");
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/exams",
        headers: authorization(owner.accessToken),
        payload: { type: "postgraduate-408-objective" }
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "EXAM_POOL_INSUFFICIENT");
      assert.equal(await prisma.exam.count({ where: { userId: owner.user.id } }), 0);
    } finally {
      await prisma.question.updateMany({ where: { id: { in: disabledIds } }, data: { status: "ACTIVE" } });
    }
  });

  it("完成C/C++创建、判题、幂等、隔离、交卷和恢复", async () => {
    const owner = await login("owner");
    const stranger = await login("stranger");
    const chapters = await app.inject({
      method: "GET",
      url: "/api/v1/subjects/cpp/chapters",
      headers: authorization(owner.accessToken)
    });
    assert.equal(chapters.statusCode, 200);
    assert.equal(chapters.json().data.length, 9);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { subject: "cpp", mode: "random", count: 5 }
    });
    assert.equal(created.statusCode, 200);
    const session = created.json().data as { id: string; questions: Array<Record<string, unknown>>; totalCount: number };
    assert.equal(session.totalCount, 5);
    assert.equal(new Set(session.questions.map((question) => question.id)).size, 5);
    session.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(stranger.accessToken)
    });
    assert.equal(forbidden.statusCode, 404);

    const storedQuestions = await prisma.practiceSessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { position: "asc" }
    });
    const pendingQuestion = storedQuestions[0]!;
    const prematureFavorite = await app.inject({
      method: "PUT",
      url: `/api/v1/records/favorites/cpp/${pendingQuestion.questionId}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(prematureFavorite.statusCode, 409);
    assert.equal(prematureFavorite.json().code, "QUESTION_NOT_ANSWERED");
    await prisma.favorite.create({ data: { userId: owner.user.id, questionId: pendingQuestion.questionId } });
    const legacyUnansweredFavorites = await app.inject({
      method: "GET",
      url: "/api/v1/records/favorites?subjectId=cpp",
      headers: authorization(owner.accessToken)
    });
    const hiddenFavorite = legacyUnansweredFavorites.json().data.find((item: { id: string }) => item.id === pendingQuestion.questionId);
    assert.equal(hiddenFavorite.answersAvailable, false);
    assert.equal(hiddenFavorite.correctOptionIds, undefined);
    assert.equal(hiddenFavorite.acceptedAnswers, undefined);
    assert.equal(hiddenFavorite.referenceAnswer, undefined);
    assert.equal(hiddenFavorite.explanation, undefined);
    await prisma.favorite.delete({ where: { userId_questionId: { userId: owner.user.id, questionId: pendingQuestion.questionId } } });
    for (let index = 0; index < storedQuestions.length; index += 1) {
      const item = storedQuestions[index]!;
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const payload = {
        questionId: item.questionId,
        selectedOptionIds: snapshot.correctOptionIds,
        clientAnswerId: `integration-${session.id}-${index}`
      };
      if (index === 1) {
        const reusedKey = await app.inject({
          method: "POST",
          url: `/api/v1/practice-sessions/${session.id}/answers`,
          headers: authorization(owner.accessToken),
          payload: { ...payload, clientAnswerId: `integration-${session.id}-0` }
        });
        assert.equal(reusedKey.statusCode, 409);
        assert.equal(reusedKey.json().code, "IDEMPOTENCY_KEY_REUSED");
      }
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/practice-sessions/${session.id}/answers`,
        headers: authorization(owner.accessToken),
        payload
      });
      assert.equal(submitted.statusCode, 200);
      assert.equal(submitted.json().data.isCorrect, true);
      assert.equal(submitted.json().data.pointsAwarded, 10);
      if (index === 0) {
        const savedFavorite = await app.inject({
          method: "PUT",
          url: `/api/v1/records/favorites/cpp/${item.questionId}`,
          headers: authorization(owner.accessToken)
        });
        assert.equal(savedFavorite.statusCode, 200, savedFavorite.body);
        const answeredFavorites = await app.inject({
          method: "GET",
          url: "/api/v1/records/favorites?subjectId=cpp",
          headers: authorization(owner.accessToken)
        });
        const revealedFavorite = answeredFavorites.json().data.find((favorite: { id: string }) => favorite.id === item.questionId);
        assert.equal(revealedFavorite.answersAvailable, true);
        assert.deepEqual(revealedFavorite.correctOptionIds, snapshot.correctOptionIds);
        assert.equal(typeof revealedFavorite.explanation, "string");
        const repeated = await app.inject({
          method: "POST",
          url: `/api/v1/practice-sessions/${session.id}/answers`,
          headers: authorization(owner.accessToken),
          payload
        });
        assert.equal(repeated.statusCode, 200);
        assert.deepEqual(repeated.json().data, submitted.json().data);
      }
    }
    assert.equal(await prisma.practiceAnswer.count({ where: { sessionId: session.id } }), 5);

    const gamificationMe = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/me",
      headers: authorization(owner.accessToken)
    });
    assert.equal(gamificationMe.statusCode, 200, gamificationMe.body);
    assert.equal(gamificationMe.json().data.points.total, 50);
    assert.match(gamificationMe.json().data.identity.displayLabel, /^刷题者#[23456789A-HJ-NP-Z]{4}$/);

    const nickname = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/profile",
      headers: authorization(owner.accessToken),
      payload: { displayName: "集成测试者" }
    });
    assert.equal(nickname.statusCode, 200, nickname.body);
    assert.match(nickname.json().data.displayLabel, /^集成测试者#/);
    const nicknameCooldown = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/profile",
      headers: authorization(owner.accessToken),
      payload: { displayName: "再次修改" }
    });
    assert.equal(nicknameCooldown.statusCode, 429, nicknameCooldown.body);
    assert.equal(nicknameCooldown.json().code, "NICKNAME_COOLDOWN");

    const achievements = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/achievements",
      headers: authorization(owner.accessToken)
    });
    assert.equal(achievements.statusCode, 200, achievements.body);
    assert.equal(achievements.json().data.items.length, 12);
    assert.equal(achievements.json().data.items.find((item: { key: string }) => item.key === "first-step").unlocked, true);
    const leaderboard = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/leaderboard?period=all&limit=100",
      headers: authorization(owner.accessToken)
    });
    assert.equal(leaderboard.statusCode, 200, leaderboard.body);
    assert.equal(leaderboard.json().data.currentUser.points, 50);
    assert.equal(leaderboard.json().data.currentUser.userId, undefined);
    assert.equal(leaderboard.json().data.currentUser.openId, undefined);

    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken),
      payload: {}
    });
    assert.equal(finished.statusCode, 200);
    assert.equal(finished.json().data.correctCount, 5);
    const repeatedFinish = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken)
    });
    assert.deepEqual(repeatedFinish.json().data, finished.json().data);

    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().data.status, "completed");
  });

  it("全局收藏支持固定题量、全部题量、跨学科快照和分学科结果", async () => {
    const owner = await login("global-favorite-owner");
    const favoriteGroups = await Promise.all(["cpp", "linux", "ds"].map((subjectId) => prisma.question.findMany({
      where: { subjectId, status: "ACTIVE", currentVersionId: { not: null } },
      orderBy: { id: "asc" },
      take: 9,
      select: { id: true, subjectId: true }
    })));
    const favoriteQuestions = favoriteGroups.flat();
    assert.equal(favoriteQuestions.length, 27);
    await prisma.favorite.createMany({
      data: favoriteQuestions.map((question) => ({ userId: owner.user.id, questionId: question.id }))
    });

    for (const count of [5, 10, 20] as const) {
      const fixed = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(owner.accessToken),
        payload: { scope: "all", mode: "favorite", count }
      });
      assert.equal(fixed.statusCode, 200, fixed.body);
      assert.equal(fixed.json().data.scope, "all");
      assert.equal(fixed.json().data.subjectId, null);
      assert.equal(fixed.json().data.subject, null);
      assert.equal(fixed.json().data.totalCount, count);
      assert.equal(new Set(fixed.json().data.questions.map((question: { id: string }) => question.id)).size, count);
    }

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { scope: "all", mode: "favorite", count: "all" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const session = created.json().data as {
      id: string;
      scope: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      questions: Array<{ id: string; subjectId: string } & Record<string, unknown>>;
    };
    assert.equal(session.scope, "all");
    assert.equal(session.subjectId, null);
    assert.equal(session.subject, null);
    assert.equal(session.totalCount, favoriteQuestions.length);
    assert.equal(new Set(session.questions.map((question) => question.id)).size, favoriteQuestions.length);
    assert.deepEqual(
      new Set(session.questions.map((question) => question.id)),
      new Set(favoriteQuestions.map((question) => question.id))
    );
    assert.equal(new Set(session.questions.map((question) => question.subjectId)).size, 3);
    session.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });

    const storedSession = await prisma.practiceSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(storedSession.subjectId, null);
    assert.equal(storedSession.chapterId, null);
    assert.equal(storedSession.requestedCount, favoriteQuestions.length);

    const learningOverview = await app.inject({
      method: "GET",
      url: "/api/v1/learning/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(learningOverview.json().data.activeSession.id, session.id);
    assert.equal(learningOverview.json().data.activeSession.scope, "all");
    assert.equal(learningOverview.json().data.activeSession.subjectId, null);
    assert.equal(learningOverview.json().data.activeSession.subject, null);
    const subjectOverview = await app.inject({
      method: "GET",
      url: "/api/v1/subjects/cpp/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(subjectOverview.json().data.activeSession, null);

    await prisma.favorite.delete({
      where: { userId_questionId: { userId: owner.user.id, questionId: favoriteQuestions[0]!.id } }
    });
    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.totalCount, favoriteQuestions.length);

    const storedQuestions = await prisma.practiceSessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { position: "asc" }
    });
    for (let index = 0; index < storedQuestions.length; index += 1) {
      const item = storedQuestions[index]!;
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/practice-sessions/${session.id}/answers`,
        headers: authorization(owner.accessToken),
        payload: {
          questionId: item.questionId,
          selectedOptionIds: snapshot.correctOptionIds,
          clientAnswerId: `global-favorite-${session.id}-${index}`
        }
      });
      assert.equal(submitted.statusCode, 200, submitted.body);
    }
    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(finished.statusCode, 200, finished.body);
    const result = finished.json().data as {
      scope: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      correctCount: number;
      subjects: Array<{ subjectId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
      chapters: Array<{ subjectId: string; chapterId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
    };
    assert.equal(result.scope, "all");
    assert.equal(result.subjectId, null);
    assert.equal(result.subject, null);
    assert.equal(result.correctCount, result.totalCount);
    assert.deepEqual(result.subjects.map((subject) => subject.subjectId), ["cpp", "linux", "ds"]);
    assert.equal(result.subjects.reduce((sum, subject) => sum + subject.totalCount, 0), result.totalCount);
    assert(result.subjects.every((subject) => subject.correctCount === subject.totalCount
      && subject.wrongCount === 0 && subject.accuracy === 100));
    assert(result.chapters.every((chapter) => chapter.subjectId
      && chapter.correctCount === chapter.totalCount && chapter.wrongCount === 0 && chapter.accuracy === 100));
  });

  it("全局错题支持固定题量、未掌握筛选、用户隔离、跨学科判题和结果汇总", async () => {
    const owner = await login("global-wrong-owner");
    const stranger = await login("global-wrong-stranger");
    const wrongGroups = await Promise.all(["cpp", "linux", "ds"].map((subjectId) => prisma.question.findMany({
      where: {
        subjectId,
        status: "ACTIVE",
        currentVersionId: { not: null },
        currentVersion: { is: { type: { in: ["SINGLE", "MULTIPLE", "JUDGE"] } } }
      },
      orderBy: { id: "asc" },
      take: 11,
      select: { id: true, subjectId: true, chapterId: true }
    })));
    assert(wrongGroups.every((group) => group.length === 11));
    const unmasteredQuestions = wrongGroups.flatMap((group) => group.slice(0, 9));
    const masteredQuestion = wrongGroups[0]![9]!;
    const strangerOnlyQuestion = wrongGroups[0]![10]!;
    await prisma.wrongQuestionRecord.createMany({
      data: unmasteredQuestions.map((question) => ({ userId: owner.user.id, questionId: question.id }))
    });
    await prisma.wrongQuestionRecord.create({
      data: {
        userId: owner.user.id,
        questionId: masteredQuestion.id,
        wrongCount: 3,
        mastered: true,
        masteredAt: new Date()
      }
    });
    await prisma.wrongQuestionRecord.create({
      data: { userId: stranger.user.id, questionId: strangerOnlyQuestion.id, wrongCount: 4 }
    });

    const unmasteredIds = new Set(unmasteredQuestions.map((question) => question.id));
    for (const count of [5, 10, 20] as const) {
      const fixed = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(owner.accessToken),
        payload: { scope: "all", mode: "wrong", count }
      });
      assert.equal(fixed.statusCode, 200, fixed.body);
      assert.equal(fixed.json().data.scope, "all");
      assert.equal(fixed.json().data.mode, "wrong");
      assert.equal(fixed.json().data.subjectId, null);
      assert.equal(fixed.json().data.subject, null);
      assert.equal(fixed.json().data.totalCount, count);
      const questionIds = fixed.json().data.questions.map((question: { id: string }) => question.id);
      assert.equal(new Set(questionIds).size, count);
      assert(questionIds.every((questionId: string) => unmasteredIds.has(questionId)));
    }

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(owner.accessToken),
      payload: { scope: "all", mode: "wrong", count: "all" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const session = created.json().data as {
      id: string;
      scope: string;
      mode: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      questions: Array<{ id: string; subjectId: string; chapterId: string } & Record<string, unknown>>;
    };
    assert.equal(session.scope, "all");
    assert.equal(session.mode, "wrong");
    assert.equal(session.subjectId, null);
    assert.equal(session.subject, null);
    assert.equal(session.totalCount, unmasteredQuestions.length);
    assert.equal(new Set(session.questions.map((question) => question.id)).size, unmasteredQuestions.length);
    assert.deepEqual(new Set(session.questions.map((question) => question.id)), unmasteredIds);
    assert.equal(new Set(session.questions.map((question) => question.subjectId)).size, 3);
    assert.equal(session.questions.some((question) => question.id === masteredQuestion.id), false);
    assert.equal(session.questions.some((question) => question.id === strangerOnlyQuestion.id), false);
    session.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.acceptedAnswers, undefined);
      assert.equal(question.answerConfig, undefined);
      assert.equal(question.referenceAnswer, undefined);
      assert.equal(question.explanation, undefined);
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(stranger.accessToken)
    });
    assert.equal(forbidden.statusCode, 404, forbidden.body);

    const storedSession = await prisma.practiceSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(storedSession.mode, "WRONG");
    assert.equal(storedSession.subjectId, null);
    assert.equal(storedSession.chapterId, null);
    assert.equal(storedSession.requestedCount, unmasteredQuestions.length);

    const frozenQuestion = unmasteredQuestions.find((question) => question.subjectId === "ds")!;
    await prisma.wrongQuestionRecord.update({
      where: { userId_questionId: { userId: owner.user.id, questionId: frozenQuestion.id } },
      data: { mastered: true, masteredAt: new Date() }
    });
    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/practice-sessions/${session.id}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(
      new Set(restored.json().data.questions.map((question: { id: string }) => question.id)),
      unmasteredIds
    );

    const storedQuestions = await prisma.practiceSessionQuestion.findMany({
      where: { sessionId: session.id },
      orderBy: { position: "asc" }
    });
    const correctlyRetried = storedQuestions.find((item) => (item.snapshot as unknown as QuestionSnapshot).subjectId === "cpp")!;
    const incorrectlyRetried = storedQuestions.find((item) => (item.snapshot as unknown as QuestionSnapshot).subjectId === "linux")!;
    const incorrectSnapshot = incorrectlyRetried.snapshot as unknown as QuestionSnapshot;
    const incorrectOption = incorrectSnapshot.options.find((option) => !incorrectSnapshot.correctOptionIds.includes(option.id));
    assert(incorrectOption);
    for (let index = 0; index < storedQuestions.length; index += 1) {
      const item = storedQuestions[index]!;
      const snapshot = item.snapshot as unknown as QuestionSnapshot;
      const shouldBeWrong = item.questionId === incorrectlyRetried.questionId;
      const answerResponse: LightMyRequestResponse = await app.inject({
        method: "POST",
        url: `/api/v1/practice-sessions/${session.id}/answers`,
        headers: authorization(owner.accessToken),
        payload: {
          questionId: item.questionId,
          selectedOptionIds: shouldBeWrong ? [incorrectOption.id] : snapshot.correctOptionIds,
          clientAnswerId: `global-wrong-${session.id}-${index}`
        }
      });
      assert.equal(answerResponse.statusCode, 200, answerResponse.body);
      assert.equal(answerResponse.json().data.isCorrect, !shouldBeWrong);
    }

    const masteredRecord = await prisma.wrongQuestionRecord.findUniqueOrThrow({
      where: { userId_questionId: { userId: owner.user.id, questionId: correctlyRetried.questionId } }
    });
    assert.equal(masteredRecord.mastered, true);
    assert(masteredRecord.masteredAt);
    const repeatedWrongRecord = await prisma.wrongQuestionRecord.findUniqueOrThrow({
      where: { userId_questionId: { userId: owner.user.id, questionId: incorrectlyRetried.questionId } }
    });
    assert.equal(repeatedWrongRecord.mastered, false);
    assert.equal(repeatedWrongRecord.masteredAt, null);
    assert.equal(repeatedWrongRecord.wrongCount, 2);

    const finished = await app.inject({
      method: "POST",
      url: `/api/v1/practice-sessions/${session.id}/finish`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(finished.statusCode, 200, finished.body);
    const result = finished.json().data as {
      scope: string;
      mode: string;
      subjectId: null;
      subject: null;
      totalCount: number;
      correctCount: number;
      wrongCount: number;
      subjects: Array<{ subjectId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
      chapters: Array<{ subjectId: string; chapterId: string; totalCount: number; correctCount: number; wrongCount: number; accuracy: number }>;
    };
    assert.equal(result.scope, "all");
    assert.equal(result.mode, "wrong");
    assert.equal(result.subjectId, null);
    assert.equal(result.subject, null);
    assert.equal(result.totalCount, unmasteredQuestions.length);
    assert.equal(result.correctCount, result.totalCount - 1);
    assert.equal(result.wrongCount, 1);
    assert.deepEqual(result.subjects.map((subject) => subject.subjectId), ["cpp", "linux", "ds"]);
    assert.equal(result.subjects.reduce((sum, subject) => sum + subject.totalCount, 0), result.totalCount);
    assert.equal(result.subjects.reduce((sum, subject) => sum + subject.wrongCount, 0), 1);
    const linuxResult = result.subjects.find((subject) => subject.subjectId === "linux")!;
    assert.equal(linuxResult.wrongCount, 1);
    assert.equal(linuxResult.correctCount, linuxResult.totalCount - 1);
    assert.equal(result.chapters.reduce((sum, chapter) => sum + chapter.totalCount, 0), result.totalCount);
    assert.equal(result.chapters.reduce((sum, chapter) => sum + chapter.wrongCount, 0), 1);
    const wrongChapter = result.chapters.find((chapter) => chapter.subjectId === "linux" && chapter.chapterId === incorrectSnapshot.chapterId)!;
    assert.equal(wrongChapter.wrongCount, 1);
    assert.equal(wrongChapter.correctCount, wrongChapter.totalCount - 1);
  });

  it("全局重练严格拒绝非法组合，并在空题池或题量不足时给出稳定结果", async () => {
    const emptyOwner = await login("global-favorite-empty-owner");
    const empty = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(emptyOwner.accessToken),
      payload: { scope: "all", mode: "favorite", count: "all" }
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().code, "EMPTY_QUESTION_POOL");
    const emptyWrong = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(emptyOwner.accessToken),
      payload: { scope: "all", mode: "wrong", count: "all" }
    });
    assert.equal(emptyWrong.statusCode, 400);
    assert.equal(emptyWrong.json().code, "EMPTY_QUESTION_POOL");

    const invalidCases = [
      { payload: { scope: "all", mode: "random", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", mode: "chapter", chapterId: "cpp-basics", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", subject: "cpp", mode: "favorite", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", mode: "favorite", chapterId: "cpp-basics", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", subject: "cpp", mode: "wrong", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "all", mode: "wrong", chapterId: "cpp-basics", count: 5 }, code: "INVALID_GLOBAL_SESSION" },
      { payload: { scope: "subject", mode: "favorite", count: 5 }, code: "SUBJECT_REQUIRED" },
      { payload: { subject: "cpp", mode: "favorite", count: "all" }, code: "INVALID_COUNT" },
      { payload: { subject: "cpp", mode: "random", chapterId: "cpp-basics", count: 5 }, code: "CHAPTER_NOT_ALLOWED" }
    ];
    for (const invalidCase of invalidCases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(emptyOwner.accessToken),
        payload: invalidCase.payload
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, invalidCase.code);
    }
    for (const payload of [
      { scope: "group", mode: "favorite", count: 5 },
      { scope: "all", mode: "favorite", count: 7 },
      { scope: "all", mode: "wrong", count: 7 }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/practice-sessions",
        headers: authorization(emptyOwner.accessToken),
        payload
      });
      assert.equal(response.statusCode, 400, response.body);
    }

    const sparseOwner = await login("global-favorite-sparse-owner");
    const sparseQuestions = await prisma.question.findMany({
      where: { subjectId: { in: ["cpp", "ds"] }, status: "ACTIVE", currentVersionId: { not: null } },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true }
    });
    await prisma.favorite.createMany({
      data: sparseQuestions.map((question) => ({ userId: sparseOwner.user.id, questionId: question.id }))
    });
    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(sparseOwner.accessToken),
      payload: { scope: "all", mode: "favorite", count: 20 }
    });
    assert.equal(capped.statusCode, 200, capped.body);
    assert.equal(capped.json().data.totalCount, sparseQuestions.length);

    const sparseWrongOwner = await login("global-wrong-sparse-owner");
    await prisma.wrongQuestionRecord.createMany({
      data: sparseQuestions.map((question) => ({ userId: sparseWrongOwner.user.id, questionId: question.id }))
    });
    const cappedWrong = await app.inject({
      method: "POST",
      url: "/api/v1/practice-sessions",
      headers: authorization(sparseWrongOwner.accessToken),
      payload: { scope: "all", mode: "wrong", count: 20 }
    });
    assert.equal(cappedWrong.statusCode, 200, cappedWrong.body);
    assert.equal(cappedWrong.json().data.totalCount, sparseQuestions.length);
  });

  it("积分流水在并发、每日上限和普通练习/408共享题目时保持幂等", async () => {
    const questions = await prisma.question.findMany({ orderBy: { id: "asc" }, take: 21, select: { id: true } });
    assert.equal(questions.length, 21);
    const concurrentUser = await prisma.user.create({ data: { wechatOpenId: "gamification-concurrent", lastLoginAt: new Date() } });
    const concurrentService = new GamificationService(prisma, () => new Date("2026-07-16T02:00:00.000Z"));
    const concurrent = await Promise.allSettled(Array.from({ length: 3 }, (_, index) => prisma.$transaction((tx) => concurrentService.awardAnswers(tx, concurrentUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-16T01:00:00.000Z"),
      sourceType: "practice",
      sourceId: `concurrent-${index}`
    }]))));
    assert(concurrent.some((result) => result.status === "fulfilled"));
    assert.equal(await prisma.pointEvent.count({ where: { userId: concurrentUser.id } }), 2);
    assert.equal((await prisma.userGamification.findUniqueOrThrow({ where: { userId: concurrentUser.id } })).totalPoints, 10);

    const cappedUser = await prisma.user.create({ data: { wechatOpenId: "gamification-cap", lastLoginAt: new Date() } });
    const service = new GamificationService(prisma);
    await prisma.$transaction((tx) => service.awardAnswers(tx, cappedUser.id, questions.map((question, index) => ({
      questionId: question.id,
      isCorrect: true,
      occurredAt: new Date(`2026-07-15T01:${String(index).padStart(2, "0")}:00.000Z`),
      sourceType: "practice" as const,
      sourceId: `first-${question.id}`
    }))));
    const reviews = await prisma.$transaction((tx) => service.awardAnswers(tx, cappedUser.id, questions.map((question, index) => ({
      questionId: question.id,
      isCorrect: true,
      occurredAt: new Date(`2026-07-16T01:${String(index).padStart(2, "0")}:00.000Z`),
      sourceType: "exam" as const,
      sourceId: `review-${question.id}`
    }))));
    assert.equal(reviews.pointsAwarded, 20);
    assert.equal(await prisma.pointEvent.count({ where: { userId: cappedUser.id, type: "DAILY_REVIEW" } }), 20);

    const sharedUser = await prisma.user.create({ data: { wechatOpenId: "gamification-shared", lastLoginAt: new Date() } });
    const practiceReward = await prisma.$transaction((tx) => service.awardAnswers(tx, sharedUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-15T01:00:00.000Z"),
      sourceType: "practice",
      sourceId: "shared-practice"
    }]));
    const examReward = await prisma.$transaction((tx) => service.awardAnswers(tx, sharedUser.id, [{
      questionId: questions[0]!.id,
      isCorrect: true,
      occurredAt: new Date("2026-07-16T01:00:00.000Z"),
      sourceType: "exam",
      sourceId: "shared-exam"
    }]));
    assert.equal(practiceReward.pointsAwarded, 10);
    assert.equal(examReward.pointsAwarded, 1);
    await prisma.user.delete({ where: { id: sharedUser.id } });
    assert.equal(await prisma.userGamification.count({ where: { userId: sharedUser.id } }), 0);
    assert.equal(await prisma.pointEvent.count({ where: { userId: sharedUser.id } }), 0);
    assert.equal(await prisma.userAchievement.count({ where: { userId: sharedUser.id } }), 0);
  });

  it("完成408组卷、整份草稿、隔离、统计、快照和幂等交卷", async () => {
    const owner = await login("exam-owner");
    const stranger = await login("exam-stranger");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const exam = created.json().data as {
      id: string;
      status: string;
      totalCount: number;
      questions: Array<{ id: string; subjectId: string; type: string; options: Array<{ id: string }> } & Record<string, unknown>>;
      answers: Record<string, string[]>;
      expiresAt: number;
    };
    assert.equal(exam.status, "active");
    assert.equal(exam.totalCount, 40);
    assert.equal(typeof exam.expiresAt, "number");
    assert.equal(new Set(exam.questions.map((question) => question.id)).size, 40);
    assert(exam.questions.every((question) => question.type === "single"));
    exam.questions.forEach((question) => {
      assert.equal(question.correctOptionIds, undefined);
      assert.equal(question.explanation, undefined);
    });
    const distribution = exam.questions.reduce<Record<string, number>>((result, question) => {
      result[question.subjectId] = (result[question.subjectId] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(distribution, { ds: 12, co: 12, os: 9, network: 7 });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, "ACTIVE_EXAM_EXISTS");

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${exam.id}`,
      headers: authorization(stranger.accessToken)
    });
    assert.equal(forbidden.statusCode, 404);
    assert.equal(forbidden.json().code, "EXAM_NOT_FOUND");

    const stored = await prisma.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { position: "asc" } });
    const first = stored[0]!;
    const second = stored[1]!;
    const firstSnapshot = first.snapshot as unknown as QuestionSnapshot;
    const secondSnapshot = second.snapshot as unknown as QuestionSnapshot;
    const wrongSecond = secondSnapshot.options.find((option) => !secondSnapshot.correctOptionIds.includes(option.id))!.id;
    const invalidDraft = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: ["Z"] } }
    });
    assert.equal(invalidDraft.statusCode, 400);
    assert.equal(invalidDraft.json().code, "INVALID_OPTION");
    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: firstSnapshot.correctOptionIds, [second.questionId]: [wrongSecond] } }
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.answeredCount, 2);

    const replaced = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${exam.id}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [first.questionId]: firstSnapshot.correctOptionIds } }
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal(replaced.json().data.answeredCount, 1);
    assert.equal(replaced.json().data.answers[second.questionId], undefined);

    const submissions = await Promise.all(Array.from({ length: 3 }, () => app.inject({
      method: "POST",
      url: `/api/v1/exams/${exam.id}/submit`,
      headers: authorization(owner.accessToken)
    })));
    submissions.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    const result = submissions[0]!.json().data;
    submissions.slice(1).forEach((response) => assert.deepEqual(response.json().data, result));
    assert.equal(result.totalCount, 40);
    assert.equal(result.answeredCount, 1);
    assert.equal(result.correctCount, 1);
    assert.equal(result.wrongCount, 39);
    assert.equal(result.score, 2);
    assert.equal(result.maxScore, 80);
    assert.equal(result.reviews.length, 40);
    assert.equal(result.subjects.length, 4);
    assert.equal(await prisma.examResult.count({ where: { examId: exam.id } }), 1);
    assert.equal(await prisma.wrongQuestionRecord.count({ where: { userId: owner.user.id } }), 39);

    const originalStem = result.reviews[0].question.stem;
    const version = await prisma.questionVersion.findUniqueOrThrow({ where: { id: first.questionVersionId } });
    await prisma.questionVersion.update({ where: { id: version.id }, data: { stem: "已修改但不应影响历史试卷" } });
    const frozen = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${exam.id}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(frozen.statusCode, 200);
    assert.equal(frozen.json().data.reviews[0].question.stem, originalStem);
    await prisma.questionVersion.update({ where: { id: version.id }, data: { stem: version.stem } });

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/exams?type=postgraduate-408-objective",
      headers: authorization(owner.accessToken)
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().data[0].score, 2);
    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/learning/overview",
      headers: authorization(owner.accessToken)
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().data.totalAttempts, 40);
    assert.equal(overview.json().data.attemptedCount, 40);
  });

  it("408到期恢复会自动交卷且重复恢复不重复统计", async () => {
    const owner = await login("expired-exam-owner");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exams",
      headers: authorization(owner.accessToken),
      payload: { type: "postgraduate-408-objective" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const examId = created.json().data.id as string;
    const firstQuestion = created.json().data.questions[0] as { id: string; options: Array<{ id: string }> };
    await prisma.exam.update({ where: { id: examId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredSave = await app.inject({
      method: "PUT",
      url: `/api/v1/exams/${examId}/draft`,
      headers: authorization(owner.accessToken),
      payload: { answers: { [firstQuestion.id]: [firstQuestion.options[0]!.id] } }
    });
    assert.equal(expiredSave.statusCode, 200, expiredSave.body);
    assert.equal(expiredSave.json().data.submitReason, "expired");
    assert.equal(expiredSave.json().data.score, 0);
    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${examId}`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.status, "completed");
    const result = await app.inject({
      method: "GET",
      url: `/api/v1/exams/${examId}/result`,
      headers: authorization(owner.accessToken)
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().data.answeredCount, 0);
    assert.equal(result.json().data.score, 0);
    assert.equal(result.json().data.submitReason, "expired");
    await app.inject({ method: "GET", url: `/api/v1/exams/${examId}`, headers: authorization(owner.accessToken) });
    assert.equal(await prisma.examResult.count({ where: { examId } }), 1);
    const overview = await app.inject({ method: "GET", url: "/api/v1/learning/overview", headers: authorization(owner.accessToken) });
    assert.equal(overview.json().data.totalAttempts, 40);
  });

  it("真实开放资料 XLSX 可完成 350 题上传、跨人复核、发布与回滚", { timeout: 180_000 }, async () => {
    const activeQuestionCountBefore = await prisma.question.count({ where: { status: "ACTIVE" } });
    const activeReleaseIdBefore = (await prisma.catalogState.findUniqueOrThrow({ where: { id: 1 } })).activeReleaseId;
    assert.ok(activeReleaseIdBefore);
    const suffix = Date.now().toString(36);
    const ownerSecret = "MZXW6YTBOI======";
    const reviewerSecret = "ONSWG4TFOQ======";
    const encryptionKey = "open-batch-integration-encryption-key-at-least-32-characters";
    const owner = await prisma.adminUser.create({
      data: {
        username: `open-owner-${suffix}`,
        displayName: "开放题库提交者",
        passwordHash: await hashAdminPassword("Open-owner-password-2026-strong"),
        totpSecretEncrypted: encryptAdminSecret(ownerSecret, encryptionKey),
        roles: ["OWNER", "EDITOR", "PUBLISHER"]
      }
    });
    const reviewer = await prisma.adminUser.create({
      data: {
        username: `open-review-${suffix}`,
        displayName: "开放题库复核者",
        passwordHash: await hashAdminPassword("Open-review-password-2026-strong"),
        totpSecretEncrypted: encryptAdminSecret(reviewerSecret, encryptionKey),
        roles: ["REVIEWER"]
      }
    });
    const adminConfig = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: "integration-test-secret-at-least-thirty-two-characters",
      WECHAT_AUTH_MODE: "stub",
      ADMIN_ENABLED: "true",
      ADMIN_ENCRYPTION_KEY: encryptionKey,
      QUESTION_BANK_STORAGE: "local",
      QUESTION_BANK_STORAGE_DIR: integrationQuestionBankStorageDirectory
    });
    await new QuestionBankService(prisma, adminConfig, createQuestionBankStorage(adminConfig)).ensureBaselineRelease();
    const adminApp = await buildApp({ config: adminConfig, prisma, wechatProvider });
    const loginAdmin = async (username: string, password: string, secret: string) => {
      const response = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        payload: { username, password, totp: createTotpToken(secret) }
      });
      assert.equal(response.statusCode, 200, response.body);
      const setCookie = response.headers["set-cookie"];
      assert.equal(typeof setCookie, "string");
      return { cookie: String(setCookie).split(";")[0]!, csrf: response.json().data.csrfToken as string };
    };

    try {
      const ownerSession = await loginAdmin(owner.username, "Open-owner-password-2026-strong", ownerSecret);
      const reviewerSession = await loginAdmin(reviewer.username, "Open-review-password-2026-strong", reviewerSecret);
      const ownerHeaders = { cookie: ownerSession.cookie, "x-csrf-token": ownerSession.csrf };
      const reviewerHeaders = { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf };
      const workbookPath = fileURLToPath(new URL("../../../../content/imports/2026-07-17-open-sources/趣刷题喽-开放资料原创题库-2026-07-17.xlsx", import.meta.url));
      const workbook = await readFile(workbookPath);
      const form = new FormData();
      form.append("file", workbook, {
        filename: "open-source-original-350.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const imported = await adminApp.inject({
        method: "POST",
        url: "/api/v1/admin/imports",
        headers: { ...form.getHeaders(), ...ownerHeaders },
        payload: form.getBuffer()
      });
      assert.equal(imported.statusCode, 200, imported.body);
      const importedBatch = imported.json().data as {
        id: string;
        status: string;
        totalRows: number;
        validRows: number;
        errorRows: number;
        warningRows: number;
      };
      assert.equal(importedBatch.status, "VALID");
      assert.equal(importedBatch.totalRows, 1550);
      assert.equal(importedBatch.validRows, 1550);
      assert.equal(importedBatch.errorRows, 0);

      const batchDetail = await adminApp.inject({
        method: "GET",
        url: `/api/v1/admin/imports/${importedBatch.id}`,
        headers: { cookie: ownerSession.cookie }
      });
      assert.equal(batchDetail.statusCode, 200, batchDetail.body);
      const draftIds = (batchDetail.json().data.rows as Array<{ draftId?: string | null }>)
        .map((row) => row.draftId)
        .filter((draftId): draftId is string => Boolean(draftId));
      assert.equal(draftIds.length, 350);
      assert.equal(new Set(draftIds).size, 350);

      const submitted = await adminApp.inject({
        method: "POST",
        url: `/api/v1/admin/imports/${importedBatch.id}/submit`,
        headers: ownerHeaders,
        payload: { acknowledgeWarnings: true }
      });
      assert.equal(submitted.statusCode, 200, submitted.body);
      assert.equal(submitted.json().data.status, "IN_REVIEW");
      assert.match(submitted.json().data.contentHash, /^[a-f0-9]{64}$/);

      const reviewed = await adminApp.inject({
        method: "POST",
        url: `/api/v1/admin/imports/${importedBatch.id}/review`,
        headers: reviewerHeaders,
        payload: { decision: "APPROVED", comment: "已核对来源、答案、版权和重复项审查记录" }
      });
      assert.equal(reviewed.statusCode, 200, reviewed.body);
      assert.equal(reviewed.json().data.status, "APPROVED");

      const openBatchInput = { name: "开放资料原创题库 2026-07-17", draftIds: [], importBatchIds: [importedBatch.id] };
      const published = await publishConfirmed(adminApp, ownerHeaders, ownerSecret, openBatchInput);
      assert.equal(published.statusCode, 200, published.body);
      assert.equal(published.json().data.questionCount, activeQuestionCountBefore + 350);
      assert.equal(published.json().data.verificationStatus, "PASSED");
      assert.match(published.json().data.snapshotHash, /^[a-f0-9]{64}$/);
      assert.equal(await prisma.question.count({ where: { externalCode: { startsWith: "WEB-20260717-" }, status: "ACTIVE" } }), 350);

      const rolledBack = await rollbackConfirmed(adminApp, ownerHeaders, ownerSecret, activeReleaseIdBefore);
      assert.equal(rolledBack.statusCode, 200, rolledBack.body);
      assert.equal(rolledBack.json().data.kind, "ROLLBACK");
      assert.equal(await prisma.question.count({ where: { status: "ACTIVE" } }), activeQuestionCountBefore);
    } finally {
      await adminApp.close();
    }
  });
});
