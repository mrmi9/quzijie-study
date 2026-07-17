import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createPrismaClient } from "../db.js";
import { createQuestionBankStorage } from "../services/question-bank-storage.js";

type Snapshot = {
  releaseId: string;
  chapters: Array<{ id: string; name: string; order: number }>;
  questions: Array<Record<string, unknown> & { id: string; chapterId: string; type: string; status: string; version: number; options: unknown[] }>;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const releaseId = process.env.RELEASE_ID || (await prisma.catalogState.findUnique({ where: { id: 1 } }))?.activeReleaseId;
    if (!releaseId) throw new Error("没有当前发布，请设置 RELEASE_ID");
    const release = await prisma.questionRelease.findFirst({ where: { id: releaseId, status: "PUBLISHED" } });
    if (!release?.snapshotKey) throw new Error("指定发布不存在或缺少快照");
    const snapshot = JSON.parse((await createQuestionBankStorage(config).get(release.snapshotKey)).toString("utf8")) as Snapshot;
    const chapters = new Map(snapshot.chapters.map((chapter) => [chapter.id, chapter]));
    const questions = snapshot.questions.map((question) => {
      const chapter = chapters.get(question.chapterId);
      const { versionId: _versionId, externalCode: _externalCode, acceptedAnswers, answerConfig, referenceAnswer, ...rest } = question;
      return {
        ...rest,
        type: question.type.toLowerCase(),
        chapterName: chapter?.name || question.chapterId,
        chapterOrder: chapter?.order || 0,
        acceptedAnswers: acceptedAnswers || [],
        answerConfig: answerConfig || {},
        referenceAnswer: referenceAnswer || "",
        status: question.status.toLowerCase(),
        version: question.version,
        options: question.options
      };
    });
    const workspaceRoot = existsSync(resolve(process.cwd(), "miniprogram")) ? process.cwd() : resolve(process.cwd(), "..");
    const target = resolve(process.env.MOCK_EXPORT_PATH || resolve(workspaceRoot, "miniprogram", "data", "questions.js"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `// 由发布快照 ${snapshot.releaseId} 导出，仅用于开发 Mock。\nmodule.exports=${JSON.stringify(questions)};\n`, "utf8");
    console.log(`Exported release ${snapshot.releaseId} with ${questions.length} questions to ${target}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
