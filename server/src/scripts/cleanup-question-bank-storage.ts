import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPrismaClient } from "../db.js";
import { createQuestionBankStorage } from "../services/question-bank-storage.js";

function numericArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error(`${name} 必须为 1 至 3650 的整数`);
  return value;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const failedRetentionDays = numericArgument("failed-retention-days", 30);
  const preparingTimeoutHours = numericArgument("preparing-timeout-hours", 24);
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const storage = createQuestionBankStorage(config);
  const now = Date.now();
  const failedCutoff = new Date(now - failedRetentionDays * 24 * 60 * 60_000);
  const preparingCutoff = new Date(now - preparingTimeoutHours * 60 * 60_000);
  try {
    const stalePreparing = await prisma.questionRelease.findMany({
      where: { status: "PREPARING", createdAt: { lt: preparingCutoff } },
      select: { id: true, createdAt: true }
    });
    if (apply && stalePreparing.length) {
      for (const release of stalePreparing) {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.questionRelease.updateMany({
            where: { id: release.id, status: "PREPARING" },
            data: { status: "FAILED", failureReason: "发布准备超时，由存储清理任务标记失败" }
          });
          if (claimed.count === 1) {
            await tx.adminAuditLog.create({
              data: {
                action: "storage.cleanup.preparing_timeout",
                entityType: "question_release",
                entityId: release.id,
                beforeState: { status: "PREPARING", createdAt: release.createdAt },
                afterState: { status: "FAILED", preparingTimeoutHours }
              }
            });
          }
        });
      }
    }

    const activeState = await prisma.catalogState.findUnique({ where: { id: 1 }, select: { activeReleaseId: true } });
    const failedReleases = await prisma.questionRelease.findMany({
      where: {
        status: "FAILED",
        createdAt: { lt: failedCutoff },
        ...(activeState?.activeReleaseId ? { id: { not: activeState.activeReleaseId } } : {})
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true }
    });
    const releases: Array<{ id: string; createdAt: string; objectKeys: string[] }> = [];
    for (const release of failedReleases) {
      const prefix = `question-bank/releases/${release.id}/`;
      const objectKeys = (await storage.list(prefix)).filter((key) => key.startsWith(prefix));
      releases.push({ id: release.id, createdAt: release.createdAt.toISOString(), objectKeys });
      if (apply) {
        await prisma.adminAuditLog.create({
          data: {
            action: "storage.cleanup.failed_release.planned",
            entityType: "question_release",
            entityId: release.id,
            afterState: { objectKeys, failedRetentionDays }
          }
        });
        const deletedObjectKeys: string[] = [];
        try {
          for (const objectKey of objectKeys) {
            await storage.delete(objectKey);
            deletedObjectKeys.push(objectKey);
          }
          await prisma.adminAuditLog.create({
            data: {
              action: "storage.cleanup.failed_release.completed",
              entityType: "question_release",
              entityId: release.id,
              afterState: { deletedObjectKeys, failedRetentionDays }
            }
          });
        } catch (error) {
          await prisma.adminAuditLog.create({
            data: {
              action: "storage.cleanup.failed_release.failed",
              entityType: "question_release",
              entityId: release.id,
              afterState: {
                deletedObjectKeys,
                pendingObjectKeys: objectKeys.filter((key) => !deletedObjectKeys.includes(key)),
                error: error instanceof Error ? error.message.slice(0, 2000) : String(error)
              }
            }
          });
          throw error;
        }
      }
    }
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      stalePreparing: stalePreparing.map((release) => ({ id: release.id, createdAt: release.createdAt.toISOString() })),
      failedRetentionDays,
      preparingTimeoutHours,
      releases,
      deletedObjectCount: apply ? releases.reduce((sum, release) => sum + release.objectKeys.length, 0) : 0
    }, null, apply ? 0 : 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
