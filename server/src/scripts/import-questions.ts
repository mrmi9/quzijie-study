import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "../db.js";
import { createPrismaClient } from "../db.js";
import { SUBJECTS, type SubjectId } from "../domain/subjects.js";

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
  type: "single" | "multiple" | "judge";
  stem: string;
  code?: string;
  options: SourceOption[];
  correctOptionIds: string[];
  explanation: string;
  difficulty: number;
  tags: string[];
  images: Array<{ src: string; alt: string; caption?: string }>;
  examScopes: string[];
  status: "active";
  version: number;
}

const QUESTION_FILES = [
  "cpp-questions.json",
  "linux-questions.json",
  "os-questions.json",
  "ds-questions.json",
  "network-questions.json",
  "stl-questions.json",
  "co-questions.json"
];

function typeToDatabase(type: SourceQuestion["type"]): "SINGLE" | "MULTIPLE" | "JUDGE" {
  return type.toUpperCase() as "SINGLE" | "MULTIPLE" | "JUDGE";
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
    options: version.options.sort((a, b) => a.position - b.position).map((option) => ({
      id: option.optionId,
      label: option.label,
      text: option.text,
      position: option.position
    }))
  };
}

export async function readQuestionSources(contentDirectory: string): Promise<SourceQuestion[]> {
  const banks = await Promise.all(QUESTION_FILES.map(async (filename) => {
    const raw = await readFile(`${contentDirectory}/${filename}`, "utf8");
    return JSON.parse(raw) as SourceQuestion[];
  }));
  return banks.flat();
}

export async function importQuestions(prisma: DatabaseClient, contentDirectory: string): Promise<number> {
  const questions = await readQuestionSources(contentDirectory);
  await prisma.$transaction(async (tx) => {
    for (const subject of Object.values(SUBJECTS)) {
      await tx.subject.upsert({
        where: { id: subject.id },
        update: { name: subject.name, shortName: subject.shortName, order: subject.order, active: true },
        create: { id: subject.id, name: subject.name, shortName: subject.shortName, order: subject.order }
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
        update: { subjectId: question.subjectId, chapterId: question.chapterId, status: "ACTIVE" },
        create: { id: question.id, subjectId: question.subjectId, chapterId: question.chapterId, status: "ACTIVE" }
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
  }, { timeout: 120_000 });
  return questions.length;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const prisma = createPrismaClient(databaseUrl);
  const contentDirectory = fileURLToPath(new URL("../../../content", import.meta.url)).replaceAll("\\", "/");
  try {
    const count = await importQuestions(prisma, contentDirectory);
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
