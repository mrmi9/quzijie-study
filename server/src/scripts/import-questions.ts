import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { DatabaseClient } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { createPrismaClient } from "../db.js";
import { SUBJECTS, type SubjectId } from "../domain/subjects.js";
import { CatalogService } from "../services/catalog.js";

interface SourceOption {
  id: string;
  label: string;
  text: string;
}

interface SourceQuestion {
  id: string;
  subjectId: SubjectId;
  chapterId: string;
  chapterName: string;
  chapterOrder: number;
  type: "single" | "multiple" | "judge" | "fill_blank" | "short_answer";
  stem: string;
  code?: string;
  options: SourceOption[];
  correctOptionIds: string[];
  acceptedAnswers?: string[] | string[][];
  answerConfig?: Record<string, unknown>;
  referenceAnswer?: string;
  explanation: string;
  difficulty: number;
  tags: string[];
  images: Array<{ src: string; alt: string; caption?: string }>;
  examScopes: string[];
  status: "active";
  version: number;
}

export const EMPTY_BASELINE_IMPORT_CONFIRMATION = "IMPORT_EMPTY_BASELINE" as const;

export interface EmptyBaselineImportOptions {
  confirmation: typeof EMPTY_BASELINE_IMPORT_CONFIRMATION;
}

export interface BaselineImportCounts {
  users: number;
  subjects: number;
  chapters: number;
  questions: number;
  questionVersions: number;
  practiceSessions: number;
  exams: number;
  drafts: number;
  imports: number;
  releases: number;
  catalogModules: number;
  catalogStates: number;
  mediaAssets: number;
  administrators: number;
}

export function assertEmptyBaselineDatabase(counts: BaselineImportCounts): void {
  const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0);
  if (nonEmpty.length > 0) {
    throw new Error(
      `Baseline import refused: the database is not empty (${nonEmpty.map(([name, count]) => `${name}=${count}`).join(", ")}). `
      + "Use the reviewed draft/import/release workflow for an existing database."
    );
  }
}

function typeToDatabase(type: SourceQuestion["type"]): "SINGLE" | "MULTIPLE" | "JUDGE" | "FILL_BLANK" | "SHORT_ANSWER" {
  return type.toUpperCase() as "SINGLE" | "MULTIPLE" | "JUDGE" | "FILL_BLANK" | "SHORT_ANSWER";
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sourceVersionView(question: SourceQuestion) {
  return {
    type: typeToDatabase(question.type),
    stem: question.stem,
    code: question.code || null,
    explanation: question.explanation,
    difficulty: question.difficulty,
    tags: question.tags,
    images: question.images,
    examScopes: question.examScopes,
    correctOptionIds: question.correctOptionIds,
    acceptedAnswers: question.acceptedAnswers || [],
    answerConfig: question.answerConfig || {},
    referenceAnswer: question.referenceAnswer || null,
    options: question.options.map((option, position) => ({ ...option, position }))
  };
}

function storedVersionView(version: {
  type: string;
  stem: string;
  code: string | null;
  explanation: string;
  difficulty: number;
  tags: unknown;
  images: unknown;
  examScopes: unknown;
  correctOptionIds: unknown;
  acceptedAnswers: unknown;
  answerConfig: unknown;
  referenceAnswer: string | null;
  options: Array<{ optionId: string; label: string; text: string; position: number }>;
}) {
  return {
    type: version.type,
    stem: version.stem,
    code: version.code,
    explanation: version.explanation,
    difficulty: version.difficulty,
    tags: version.tags,
    images: version.images,
    examScopes: version.examScopes,
    correctOptionIds: version.correctOptionIds,
    acceptedAnswers: version.acceptedAnswers,
    answerConfig: version.answerConfig,
    referenceAnswer: version.referenceAnswer,
    options: version.options.sort((a, b) => a.position - b.position).map((option) => ({
      id: option.optionId,
      label: option.label,
      text: option.text,
      position: option.position
    }))
  };
}

export async function readQuestionSources(contentDirectory: string): Promise<SourceQuestion[]> {
  const QUESTION_FILES = (await readdir(contentDirectory))
    .filter((filename) => filename.endsWith("-questions.json"))
    .sort();
  if (!QUESTION_FILES.length) throw new Error("题库目录中没有 *-questions.json 文件");
  const banks = await Promise.all(QUESTION_FILES.map(async (filename) => {
    const raw = await readFile(`${contentDirectory}/${filename}`, "utf8");
    return JSON.parse(raw) as SourceQuestion[];
  }));
  return banks.flat();
}

export async function importQuestions(
  prisma: DatabaseClient,
  contentDirectory: string,
  options: EmptyBaselineImportOptions
): Promise<number> {
  if (options.confirmation !== EMPTY_BASELINE_IMPORT_CONFIRMATION) {
    throw new Error("Baseline import refused: explicit empty-database confirmation is required.");
  }
  const questions = await readQuestionSources(contentDirectory);
  await prisma.$transaction(async (tx) => {
    const [
      users,
      subjects,
      chapterCount,
      storedQuestions,
      questionVersions,
      practiceSessions,
      exams,
      drafts,
      imports,
      releases,
      catalogModules,
      catalogStates,
      mediaAssets,
      administrators
    ] = await Promise.all([
      tx.user.count(),
      tx.subject.count(),
      tx.chapter.count(),
      tx.question.count(),
      tx.questionVersion.count(),
      tx.practiceSession.count(),
      tx.exam.count(),
      tx.questionDraft.count(),
      tx.questionImportBatch.count(),
      tx.questionRelease.count(),
      tx.catalogModule.count(),
      tx.catalogState.count(),
      tx.mediaAsset.count(),
      tx.adminUser.count()
    ]);
    assertEmptyBaselineDatabase({
      users,
      subjects,
      chapters: chapterCount,
      questions: storedQuestions,
      questionVersions,
      practiceSessions,
      exams,
      drafts,
      imports,
      releases,
      catalogModules,
      catalogStates,
      mediaAssets,
      administrators
    });

    for (const subject of Object.values(SUBJECTS)) {
      await tx.subject.upsert({
        where: { id: subject.id },
        update: { name: subject.name, shortName: subject.shortName, order: subject.order, active: true },
        create: { id: subject.id, name: subject.name, shortName: subject.shortName, order: subject.order }
      });
    }
    const knownSubjectIds = new Set(Object.keys(SUBJECTS));
    const dynamicSubjectIds = Array.from(new Set(questions.map((question) => question.subjectId)))
      .filter((subjectId) => !knownSubjectIds.has(subjectId));
    for (const [index, subjectId] of dynamicSubjectIds.entries()) {
      await tx.subject.upsert({
        where: { id: subjectId },
        update: { active: true },
        create: { id: subjectId, name: subjectId, shortName: subjectId, order: Object.keys(SUBJECTS).length + index + 1 }
      });
    }

    const chapters = new Map<string, SourceQuestion>();
    questions.forEach((question) => chapters.set(question.chapterId, question));
    for (const chapter of chapters.values()) {
      await tx.chapter.upsert({
        where: { id: chapter.chapterId },
        update: { subjectId: chapter.subjectId, name: chapter.chapterName, order: chapter.chapterOrder, active: true },
        create: {
          id: chapter.chapterId,
          subjectId: chapter.subjectId,
          name: chapter.chapterName,
          order: chapter.chapterOrder
        }
      });
    }

    for (const question of questions) {
      await tx.question.upsert({
        where: { id: question.id },
        update: {
          externalCode: question.id,
          subjectId: question.subjectId,
          chapterId: question.chapterId,
          status: "ACTIVE",
          contentHash: createHash("sha256").update(stable(sourceVersionView(question))).digest("hex")
        },
        create: {
          id: question.id,
          externalCode: question.id,
          subjectId: question.subjectId,
          chapterId: question.chapterId,
          status: "ACTIVE",
          sourceSystem: "repository-json",
          sourceReference: `${question.subjectId}-questions.json`,
          contentHash: createHash("sha256").update(stable(sourceVersionView(question))).digest("hex")
        }
      });
      const existing = await tx.questionVersion.findUnique({
        where: { questionId_version: { questionId: question.id, version: question.version } },
        include: { options: true }
      });
      if (existing) {
        if (stable(sourceVersionView(question)) !== stable(storedVersionView(existing))) {
          throw new Error(`题目 ${question.id} 的版本 ${question.version} 内容已变化，请提升 version 后再导入`);
        }
        await tx.question.update({ where: { id: question.id }, data: { currentVersionId: existing.id } });
        continue;
      }
      const created = await tx.questionVersion.create({
        data: {
          questionId: question.id,
          version: question.version,
          type: typeToDatabase(question.type),
          stem: question.stem,
          code: question.code || null,
          explanation: question.explanation,
          difficulty: question.difficulty,
          tags: question.tags,
          images: question.images,
          examScopes: question.examScopes,
          correctOptionIds: question.correctOptionIds,
          acceptedAnswers: question.acceptedAnswers || [],
          answerConfig: (question.answerConfig || {}) as Prisma.InputJsonValue,
          referenceAnswer: question.referenceAnswer || null,
          options: {
            create: question.options.map((option, position) => ({
              optionId: option.id,
              label: option.label,
              text: option.text,
              position
            }))
          }
        }
      });
      await tx.question.update({ where: { id: question.id }, data: { currentVersionId: created.id } });
    }
  }, {
    timeout: 120_000,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
  await new CatalogService(prisma).ensureBaseline();
  return questions.length;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  if (process.env.QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT !== EMPTY_BASELINE_IMPORT_CONFIRMATION) {
    throw new Error(
      `Baseline import refused. Set QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT=${EMPTY_BASELINE_IMPORT_CONFIRMATION} `
      + "only after confirming that the target is a new empty database."
    );
  }
  const prisma = createPrismaClient(databaseUrl);
  const contentDirectory = process.env.QUESTION_CONTENT_DIR
    ? resolve(process.env.QUESTION_CONTENT_DIR).replaceAll("\\", "/")
    : fileURLToPath(new URL("../../../content", import.meta.url)).replaceAll("\\", "/");
  try {
    const count = await importQuestions(prisma, contentDirectory, {
      confirmation: EMPTY_BASELINE_IMPORT_CONFIRMATION
    });
    console.log(`Imported ${count} questions.`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1]?.includes("import-questions");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
