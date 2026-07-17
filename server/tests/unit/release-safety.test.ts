import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../../src/config.js";
import type { DatabaseClient } from "../../src/db.js";
import { AppError } from "../../src/errors.js";
import { assertReleasePublishingAllowed, QuestionBankService } from "../../src/services/question-bank.js";
import type { QuestionBankStorage } from "../../src/services/question-bank-storage.js";

describe("题库发布安全门禁", () => {
  it("允许健康目录继续发布", () => {
    assert.doesNotThrow(() => assertReleasePublishingAllowed(null));
    assert.doesNotThrow(() => assertReleasePublishingAllowed({ publishFrozen: false }));
  });

  it("发布后验证失败时阻断新的普通发布并保留冻结来源", () => {
    const frozenAt = new Date("2026-07-17T00:00:00.000Z");
    assert.throws(
      () => assertReleasePublishingAllowed({ publishFrozen: true, frozenReleaseId: "release-bad", frozenAt, freezeReason: "RELEASE_POST_PUBLISH_VERIFICATION_FAILED" }),
      (error: unknown) => error instanceof AppError
        && error.code === "RELEASE_PUBLISH_FROZEN"
        && error.statusCode === 409
        && (error.details as { frozenReleaseId?: string }).frozenReleaseId === "release-bad"
    );
  });

  it("活动发布验证尚未完成时也阻断下一次发布", () => {
    assert.throws(
      () => assertReleasePublishingAllowed({ publishFrozen: false, activeRelease: { verificationStatus: "PENDING" } }),
      (error: unknown) => error instanceof AppError && error.code === "RELEASE_VERIFICATION_REQUIRED"
    );
  });

  it("发布后检查缺少快照时记录失败并冻结活动目录", async () => {
    const release = { id: "release-bad", status: "PUBLISHED", snapshotKey: null, snapshotHash: null, snapshotSize: null, questionCount: 0, publicCatalog: null };
    let verificationStatus = "PENDING";
    let publishFrozen = false;
    let auditAction = "";
    const tx = {
      questionRelease: { update: async ({ data }: { data: { verificationStatus: string } }) => { verificationStatus = data.verificationStatus; return release; } },
      catalogState: {
        findUnique: async () => ({ activeReleaseId: release.id }),
        update: async ({ data }: { data: { publishFrozen: boolean } }) => { publishFrozen = data.publishFrozen; return {}; }
      },
      adminAuditLog: { create: async ({ data }: { data: { action: string } }) => { auditAction = data.action; return {}; } }
    };
    const prisma = {
      questionRelease: {
        findUnique: async () => release,
        update: async ({ data }: { data: { verificationStatus: string } }) => { verificationStatus = data.verificationStatus; return release; }
      },
      catalogState: { findUnique: async () => ({ activeReleaseId: release.id }) },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    } as unknown as DatabaseClient;
    const service = new QuestionBankService(
      prisma,
      { databaseUrl: "mysql://unused:unused@localhost:3306/unused", questionBankMaxSnapshotBytes: 1024 } as AppConfig,
      {} as QuestionBankStorage
    );

    const originalError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        (service as unknown as { verifyPublishedRelease(id: string): Promise<unknown> }).verifyPublishedRelease(release.id),
        (error: unknown) => error instanceof AppError && error.code === "RELEASE_VERIFICATION_FAILED"
      );
    } finally {
      console.error = originalError;
    }
    assert.equal(verificationStatus, "FAILED");
    assert.equal(publishFrozen, true);
    assert.equal(auditAction, "release.verify.failed");
  });
});
