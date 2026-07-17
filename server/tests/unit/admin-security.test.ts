import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../../src/config.js";
import type { DatabaseClient } from "../../src/db.js";
import type { DraftQuestionInput } from "../../src/domain/question-bank.js";
import { AppError } from "../../src/errors.js";
import { AdminSecurity, recordFailedAdminLogin, registerAdminAuthRoutes } from "../../src/routes/admin-auth.js";
import { updateAdministrator } from "../../src/routes/admin-question-bank.js";
import { requireInteractiveSecretTerminal } from "../../src/scripts/admin-cli-security.js";
import { catalogPayloadHash, QuestionBankService } from "../../src/services/question-bank.js";
import type { QuestionBankStorage } from "../../src/services/question-bank-storage.js";

function mockDatabase(value: unknown): DatabaseClient {
  return value as DatabaseClient;
}

describe("administrator concurrency controls", () => {
  it("throttles by normalized username without sharing the CloudRun proxy IP bucket", async () => {
    const prisma = mockDatabase({
      adminUser: { findUnique: async () => null },
      adminSession: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) }
    });
    const config = {
      adminEnabled: true,
      adminSessionTtlHours: 8,
      adminEncryptionKey: "unit-test-admin-encryption-key-at-least-32-characters",
      nodeEnv: "test"
    } as AppConfig;
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    registerAdminAuthRoutes(app, prisma, config, new AdminSecurity(prisma, config));

    const attempt = (username: string, forwardedFor: string) => app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      headers: { "x-forwarded-for": forwardedFor },
      payload: { username, password: "wrong-password", totp: "000000" }
    });

    try {
      for (let index = 0; index < 5; index += 1) {
        const response = await attempt(index % 2 === 0 ? " Owner_01 " : "owner_01", `203.0.113.${index + 1}`);
        assert.equal(response.statusCode, 401, response.body);
      }
      const limited = await attempt("owner_01", "198.51.100.10");
      assert.equal(limited.statusCode, 429, limited.body);

      const unrelatedAdmin = await attempt("reviewer_01", "198.51.100.10");
      assert.equal(unrelatedAdmin.statusCode, 401, unrelatedAdmin.body);
    } finally {
      await app.close();
    }
  });

  it("counts five simultaneous login failures without losing increments and locks the account", async () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const state: { status: "ACTIVE"; failedLoginCount: number; lockedUntil: Date | null } = {
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null
    };
    const prisma = mockDatabase({
      adminUser: {
        findUnique: async () => ({ ...state }),
        updateMany: async ({ where, data }: { where: { failedLoginCount: number; lockedUntil: Date | null }; data: { failedLoginCount: number | { increment: number }; lockedUntil: Date | null } }) => {
          const sameLock = where.lockedUntil === null
            ? state.lockedUntil === null
            : state.lockedUntil?.getTime() === where.lockedUntil.getTime();
          if (state.failedLoginCount !== where.failedLoginCount || !sameLock) return { count: 0 };
          state.failedLoginCount = typeof data.failedLoginCount === "number"
            ? data.failedLoginCount
            : state.failedLoginCount + data.failedLoginCount.increment;
          state.lockedUntil = data.lockedUntil;
          return { count: 1 };
        }
      }
    });

    await Promise.all(Array.from({ length: 5 }, () => recordFailedAdminLogin(prisma, "admin-1", now)));

    assert.equal(state.failedLoginCount, 0);
    assert.equal(state.lockedUntil?.toISOString(), "2026-07-16T00:15:00.000Z");
  });

  it("updates roles, revokes sessions and writes the audit record in one Serializable transaction", async () => {
    const events: string[] = [];
    let isolationLevel = "";
    const before = { id: "owner-2", username: "owner2", displayName: "Owner 2", roles: ["OWNER", "EDITOR"], status: "ACTIVE" };
    const tx = {
      adminUser: {
        findUnique: async () => { events.push("read"); return before; },
        findMany: async () => { events.push("owner-check"); return [{ roles: ["OWNER"] }, { roles: ["OWNER"] }]; },
        update: async () => { events.push("update"); return { ...before, roles: ["EDITOR"] }; }
      },
      adminSession: { updateMany: async () => { events.push("revoke"); return { count: 2 }; } },
      adminAuditLog: { create: async () => { events.push("audit"); return {}; } }
    };
    const prisma = mockDatabase({
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>, options: { isolationLevel: string }) => {
        isolationLevel = options.isolationLevel;
        return callback(tx);
      }
    });

    const result = await updateAdministrator(prisma, "owner-1", "owner-2", { roles: ["EDITOR"] }, "request-1");

    assert.equal(isolationLevel, "Serializable");
    assert.deepEqual(events, ["read", "owner-check", "update", "revoke", "audit"]);
    assert.deepEqual(result.roles, ["EDITOR"]);
  });

  it("rejects removal of the final active owner before any update", async () => {
    let updated = false;
    const before = { id: "owner-1", username: "owner1", displayName: "Owner 1", roles: ["OWNER"], status: "ACTIVE" };
    const tx = {
      adminUser: {
        findUnique: async () => before,
        findMany: async () => [{ roles: ["OWNER"] }],
        update: async () => { updated = true; return before; }
      }
    };
    const prisma = mockDatabase({ $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) });

    await assert.rejects(
      updateAdministrator(prisma, "different-owner", "owner-1", { roles: ["EDITOR"] }),
      (error: unknown) => error instanceof AppError && error.code === "LAST_OWNER_REQUIRED" && error.statusCode === 409
    );
    assert.equal(updated, false);
  });

  it("maps a Serializable transaction conflict to HTTP 409", async () => {
    const prisma = mockDatabase({ $transaction: async () => { throw { code: "P2034" }; } });
    await assert.rejects(
      updateAdministrator(prisma, "owner-1", "owner-2", { roles: ["EDITOR"] }),
      (error: unknown) => error instanceof AppError && error.code === "ADMIN_UPDATE_CONFLICT" && error.statusCode === 409
    );
  });
});

describe("secret-emitting administrator CLI commands", () => {
  it("requires both stdin and stdout to be real TTYs", () => {
    assert.doesNotThrow(() => requireInteractiveSecretTerminal("create", { isTTY: true }, { isTTY: true }));
    assert.throws(() => requireInteractiveSecretTerminal("create", { isTTY: true }, { isTTY: false }), /\u4ea4\u4e92\u7ec8\u7aef/);
    assert.throws(() => requireInteractiveSecretTerminal("reset-totp", { isTTY: false }, { isTTY: true }), /\u4ea4\u4e92\u7ec8\u7aef/);
    assert.doesNotThrow(() => requireInteractiveSecretTerminal("disable", { isTTY: false }, { isTTY: false }));
  });
});

function draftInput(stem: string): DraftQuestionInput {
  return {
    subjectId: "subject-1",
    chapterId: "chapter-1",
    type: "SINGLE",
    stem,
    explanation: "A sufficiently complete explanation for the test question.",
    difficulty: 1,
    options: [
      { id: "A", label: "A", text: "Correct option" },
      { id: "B", label: "B", text: "Incorrect option" }
    ],
    correctOptionIds: ["A"]
  };
}

function questionService(prisma: DatabaseClient): QuestionBankService {
  return new QuestionBankService(
    prisma,
    { databaseUrl: "mysql://unused:unused@localhost:3306/unused" } as AppConfig,
    {} as QuestionBankStorage
  );
}

describe("question draft compare-and-swap", () => {
  it("submits and audits a draft atomically with revision compare-and-swap", async () => {
    let state: { id: string; status: string; revision: number; validationErrors: unknown[]; validationWarnings: unknown[]; submittedById: string | null } = { id: "draft-submit", status: "DRAFT", revision: 4, validationErrors: [], validationWarnings: [], submittedById: null };
    let auditCount = 0;
    const delegate = {
      findUnique: async () => ({ ...state }),
      findUniqueOrThrow: async () => ({ ...state }),
      updateMany: async ({ where }: { where: { revision: number; status: { in: string[] } } }) => {
        if (state.revision !== where.revision || !where.status.in.includes(state.status)) return { count: 0 };
        state = { ...state, status: "IN_REVIEW", revision: state.revision + 1, submittedById: "editor-1" as string | null };
        return { count: 1 };
      }
    };
    const tx = { questionDraft: delegate, adminAuditLog: { create: async () => { auditCount += 1; return {}; } } };
    const service = questionService(mockDatabase({
      questionDraft: delegate,
      questionImportRow: { findFirst: async () => null },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    }));

    const results = await Promise.allSettled([
      service.submitDraft("editor-1", state.id),
      service.submitDraft("editor-2", state.id)
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, results.map((result) => result.status === "rejected" ? String(result.reason?.stack || result.reason) : "fulfilled").join("\n"));
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(rejected?.reason instanceof AppError && rejected.reason.code, "DRAFT_SUBMIT_CONFLICT");
    assert.equal(auditCount, 1);
    assert.equal(state.status, "IN_REVIEW");
    assert.equal(state.revision, 5);
  });

  it("allows only one PATCH for the same revision", async () => {
    let state = { id: "draft-1", questionId: "question-1", status: "DRAFT", revision: 1, submittedById: null, stem: "before" };
    let auditCount = 0;
    const draftDelegate = {
      findUnique: async () => ({ ...state }),
      updateMany: async ({ where, data }: { where: { revision: number; status: { in: string[] } }; data: Record<string, unknown> }) => {
        if (state.revision !== where.revision || !where.status.in.includes(state.status)) return { count: 0 };
        state = { ...state, ...data, status: "DRAFT", revision: state.revision + 1, stem: String(data.stem) };
        return { count: 1 };
      }
    };
    const tx = { questionDraft: draftDelegate, adminAuditLog: { create: async () => { auditCount += 1; return {}; } } };
    const prisma = mockDatabase({
      questionDraft: draftDelegate,
      subject: { findFirst: async () => ({ id: "subject-1" }) },
      chapter: { findFirst: async () => ({ id: "chapter-1" }) },
      question: { findFirst: async () => null },
      mediaAsset: { count: async () => 0 },
      $queryRaw: async () => [],
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    });
    const service = questionService(prisma);

    const results = await Promise.allSettled([
      service.updateDraft("editor-1", "draft-1", 1, draftInput("First concurrent edit")),
      service.updateDraft("editor-2", "draft-1", 1, draftInput("Second concurrent edit"))
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, results.map((result) => result.status === "rejected" ? String(result.reason?.stack || result.reason) : "fulfilled").join("\n"));
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(rejected?.reason instanceof AppError && rejected.reason.code, "DRAFT_REVISION_CONFLICT");
    assert.equal(state.revision, 2);
    assert.equal(auditCount, 1);
  });

  it("allows only one reviewer to transition an IN_REVIEW revision", async () => {
    let state = { id: "draft-2", questionId: "question-2", status: "IN_REVIEW", revision: 7, submittedById: "submitter-1" };
    const reviews: string[] = [];
    let auditCount = 0;
    const draftDelegate = {
      findUnique: async () => ({ ...state }),
      updateMany: async ({ where, data }: { where: { revision: number; status: string }; data: { status: string } }) => {
        if (state.revision !== where.revision || state.status !== where.status) return { count: 0 };
        state = { ...state, status: data.status, revision: state.revision + 1 };
        return { count: 1 };
      }
    };
    const tx = {
      questionDraft: draftDelegate,
      draftReview: { create: async ({ data }: { data: { decision: string } }) => { reviews.push(data.decision); return {}; } },
      adminAuditLog: { create: async () => { auditCount += 1; return {}; } },
      questionImportRow: { findMany: async () => [] },
      questionImportBatch: { update: async () => ({}) }
    };
    const prisma = mockDatabase({
      questionDraft: draftDelegate,
      questionImportRow: { findFirst: async () => null },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    });
    const service = questionService(prisma);

    const results = await Promise.allSettled([
      service.reviewDraft("reviewer-1", "draft-2", "APPROVED"),
      service.reviewDraft("reviewer-2", "draft-2", "REJECTED")
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(rejected?.reason instanceof AppError && rejected.reason.code, "DRAFT_REVIEW_CONFLICT");
    assert.equal(reviews.length, 1);
    assert.equal(auditCount, 1);
    assert.equal(state.revision, 8);
  });
});

describe("catalog draft compare-and-swap", () => {
  it("allows only one reviewer to approve the frozen catalog hash", async () => {
    const payload = {
      modules: [{ id: "main", name: "主模块", subtitle: null, color: "#2563eb", type: "GROUP", order: 1, active: true, subjects: [{ subjectId: "alpha", order: 0 }] }],
      subjects: [{ id: "alpha", name: "学科甲", shortName: "甲", order: 1, color: "#2563eb", description: null, iconKey: null, qualityPolicy: null, active: true }],
      chapters: [{ id: "alpha-1", subjectId: "alpha", name: "第一章", order: 1, active: true, description: null }]
    };
    const contentHash = catalogPayloadHash(payload);
    let state = { id: "catalog-1", status: "IN_REVIEW", revision: 3, submittedById: "submitter", payload, contentHash };
    let reviewCount = 0;
    const delegate = {
      findUnique: async () => ({ ...state }),
      findUniqueOrThrow: async () => ({ ...state }),
      updateMany: async ({ where, data }: { where: { revision: number; status: string; contentHash: string }; data: { status: string } }) => {
        if (state.revision !== where.revision || state.status !== where.status || state.contentHash !== where.contentHash) return { count: 0 };
        state = { ...state, status: data.status, revision: state.revision + 1 };
        return { count: 1 };
      }
    };
    const tx = {
      catalogDraft: delegate,
      catalogDraftReview: { create: async () => { reviewCount += 1; return {}; } },
      adminAuditLog: { create: async () => ({}) }
    };
    const service = questionService(mockDatabase({
      catalogDraft: delegate,
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    }));
    const results = await Promise.allSettled([
      service.reviewCatalogDraft("reviewer-1", state.id, "APPROVED"),
      service.reviewCatalogDraft("reviewer-2", state.id, "APPROVED")
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(rejected?.reason instanceof AppError && rejected.reason.code, "CATALOG_DRAFT_REVIEW_CONFLICT");
    assert.equal(reviewCount, 1);
    assert.equal(state.revision, 4);
  });
});
