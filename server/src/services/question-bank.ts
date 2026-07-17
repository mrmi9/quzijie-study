import { createHash, randomUUID } from "node:crypto";
import mariadb from "mariadb";
import { Prisma } from "../generated/prisma/client.js";
import type { AppConfig } from "../config.js";
import type { DatabaseClient } from "../db.js";
import { parseMysqlDatabaseUrl } from "../database-url.js";
import { AppError } from "../errors.js";
import {
  generateQuestionId,
  normalizeDraftQuestion,
  questionContentHash,
  questionTextSimilarity,
  stableStringify,
  validateDraftQuestion,
  type DraftQuestionInput,
  type NormalizedDraftQuestion
} from "../domain/question-bank.js";
import {
  evaluateSubjectQualityPolicies,
  normalizeSubjectQualityPolicy,
  QualityPolicyValidationError,
  type ReleaseQualityReport,
  type SubjectQualityPolicy
} from "../domain/quality-policy.js";
import type { QuestionBankStorage } from "./question-bank-storage.js";
import { buildPublicCatalog } from "./catalog.js";
import { importBatchContentHash } from "./question-import.js";

type AuditInput = {
  adminUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  requestId?: string | null;
  ipHash?: string | null;
};

type PreparedDraft = {
  id: string;
  action: "UPSERT" | "DISABLE";
  questionId: string;
  baseVersionId: string | null;
  externalCode: string | null;
  subjectId: string;
  chapterId: string;
  type: string;
  stem: string;
  code: string | null;
  explanation: string;
  difficulty: number;
  tags: Prisma.JsonValue;
  images: Prisma.JsonValue;
  examScopes: Prisma.JsonValue;
  correctOptionIds: Prisma.JsonValue;
  acceptedAnswers: Prisma.JsonValue;
  answerConfig: Prisma.JsonValue;
  referenceAnswer: string | null;
  options: Prisma.JsonValue;
  contentHash: string;
};

type PreparedVersion = { draft: PreparedDraft; versionId: string; version: number };
type ImportStatusClient = Pick<DatabaseClient, "questionImportRow" | "questionImportBatch">;

type ImportSubjectCandidate = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  description: string | null;
  qualityPolicy: SubjectQualityPolicy | null;
};

type ImportChapterCandidate = {
  id: string;
  subjectId: string;
  name: string;
  description: string | null;
};

type ImportCatalogCandidates = {
  batchIds: string[];
  batches: Array<{ id: string; revision: number; contentHash: string }>;
  subjects: ImportSubjectCandidate[];
  chapters: ImportChapterCandidate[];
};

type ReleaseSnapshotQuestion = {
  id: string;
  externalCode: string | null;
  contentHash: string;
  subjectId: string;
  chapterId: string;
  status: string;
  versionId: string;
  version: number;
  type: string;
  stem: string;
  code: string | null;
  explanation: string;
  difficulty: number;
  tags: Prisma.JsonValue;
  images: Prisma.JsonValue;
  examScopes: Prisma.JsonValue;
  correctOptionIds: Prisma.JsonValue;
  acceptedAnswers: Prisma.JsonValue;
  answerConfig: Prisma.JsonValue;
  referenceAnswer: string | null;
  options: Array<{ id: string; label: string; text: string; position: number }>;
};

type ReleaseSnapshot = {
  schemaVersion: number;
  releaseId: string;
  generatedAt: string;
  modules: Array<{ id: string; name: string; subtitle: string | null; color: string; type: string; order: number; active: boolean; subjects: Array<{ subjectId: string; order: number }> }>;
  subjects: Array<{ id: string; name: string; shortName: string; order: number; color: string; description: string | null; iconKey: string | null; qualityPolicy: Prisma.JsonValue | null; active: boolean }>;
  chapters: Array<{ id: string; subjectId: string; name: string; order: number; active: boolean; description: string | null }>;
  questions: ReleaseSnapshotQuestion[];
  media?: Array<{
    id: string;
    src: string;
    objectKey: string;
    sha256: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  }>;
};

export type CatalogDraftPayload = Pick<ReleaseSnapshot, "modules" | "subjects" | "chapters">;

type CatalogValidation = { errors: string[]; warnings: string[] };
type ReleaseVerificationReport = {
  ok: boolean;
  releaseId: string;
  checkedAt: string;
  durationMs: number;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  validationErrorCount: number;
  missingVersionCount: number;
  objectUploadFailureCount: number;
};

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function assertReleasePublishingAllowed(state: { publishFrozen: boolean; frozenReleaseId?: string | null; frozenAt?: Date | null; freezeReason?: string | null; activeRelease?: { verificationStatus: string } | null } | null): void {
  if (state?.publishFrozen) {
    throw new AppError(
      "题库发布已因发布后自检失败而冻结，请先回滚或由所有者重试验证",
      "RELEASE_PUBLISH_FROZEN",
      409,
      { frozenReleaseId: state.frozenReleaseId, frozenAt: state.frozenAt, reason: state.freezeReason }
    );
  }
  if (state?.activeRelease && state.activeRelease.verificationStatus !== "PASSED") {
    throw new AppError("当前活动题库尚未通过发布后自检", "RELEASE_VERIFICATION_REQUIRED", 409, { verificationStatus: state.activeRelease.verificationStatus });
  }
}

function subjectQualityPolicy(value: unknown): SubjectQualityPolicy | null {
  try {
    return normalizeSubjectQualityPolicy(value);
  } catch (error) {
    if (error instanceof QualityPolicyValidationError) {
      throw new AppError(error.message, "INVALID_SUBJECT_QUALITY_POLICY", 400);
    }
    throw error;
  }
}

function jsonArray<T = unknown>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function publicDraft(draft: Record<string, unknown>) {
  return draft;
}

function normalizedText(value: unknown, label: string, maximum: number): string {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text || text.length > maximum) throw new AppError(`${label}不能为空且不能超过 ${maximum} 个字符`, "INVALID_CATALOG_PAYLOAD", 400);
  return text;
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize("NFKC").trim();
  if (text.length > maximum) throw new AppError(`目录文本不能超过 ${maximum} 个字符`, "INVALID_CATALOG_PAYLOAD", 400);
  return text || null;
}

function catalogOrder(value: unknown): number {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 0 || order > 100_000) throw new AppError("目录顺序必须是 0 至 100000 的整数", "INVALID_CATALOG_ORDER", 400);
  return order;
}

function catalogIdentifier(value: unknown, maximum: number, label: string): string {
  const id = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!new RegExp(`^[a-z][a-z0-9-]{1,${maximum - 1}}$`).test(id)) {
    throw new AppError(`${label} ID 格式无效`, "INVALID_CATALOG_ID", 400);
  }
  return id;
}

export function normalizeCatalogDraftPayload(value: unknown): CatalogDraftPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("目录候选内容格式无效", "INVALID_CATALOG_PAYLOAD", 400);
  const payload = value as Partial<CatalogDraftPayload>;
  if (!Array.isArray(payload.modules) || !Array.isArray(payload.subjects) || !Array.isArray(payload.chapters)) {
    throw new AppError("目录候选必须包含模块、学科和章节", "INVALID_CATALOG_PAYLOAD", 400);
  }
  const subjects = payload.subjects.map((raw) => ({
    id: catalogIdentifier(raw.id, 32, "学科"),
    name: normalizedText(raw.name, "学科名称", 96),
    shortName: normalizedText(raw.shortName, "学科简称", 48),
    order: catalogOrder(raw.order),
    color: normalizedText(raw.color || "#2563eb", "学科主题色", 16),
    description: nullableText(raw.description, 500),
    iconKey: nullableText(raw.iconKey, 96),
    qualityPolicy: subjectQualityPolicy(raw.qualityPolicy),
    active: raw.active !== false
  })).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const chapters = payload.chapters.map((raw) => ({
    id: catalogIdentifier(raw.id, 64, "章节"),
    subjectId: catalogIdentifier(raw.subjectId, 32, "学科"),
    name: normalizedText(raw.name, "章节名称", 128),
    order: catalogOrder(raw.order),
    active: raw.active !== false,
    description: nullableText(raw.description, 500)
  })).sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.order - right.order || left.id.localeCompare(right.id));
  const modules = payload.modules.map((raw) => {
    const type = String(raw.type || "").toUpperCase();
    if (!["SUBJECT", "GROUP", "EXAM"].includes(type)) throw new AppError("首页模块类型无效", "INVALID_MODULE_TYPE", 400);
    if (!Array.isArray(raw.subjects)) throw new AppError("首页模块缺少学科列表", "INVALID_CATALOG_PAYLOAD", 400);
    return {
      id: catalogIdentifier(raw.id, 64, "首页模块"),
      name: normalizedText(raw.name, "首页模块名称", 96),
      subtitle: nullableText(raw.subtitle, 191),
      color: normalizedText(raw.color || "#2563eb", "首页模块主题色", 16),
      type,
      order: catalogOrder(raw.order),
      active: raw.active !== false,
      subjects: raw.subjects.map((link) => ({
        subjectId: catalogIdentifier(link.subjectId, 32, "学科"),
        order: catalogOrder(link.order)
      })).sort((left, right) => left.order - right.order || left.subjectId.localeCompare(right.subjectId))
    };
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return { modules, subjects, chapters } as CatalogDraftPayload;
}

export function catalogPayloadHash(payload: CatalogDraftPayload): string {
  return createHash("sha256").update(stableStringify(normalizeCatalogDraftPayload(payload))).digest("hex");
}

export function validateCatalogDraftPayload(payload: CatalogDraftPayload): CatalogValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unique = (values: string[], label: string) => {
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    if (duplicates.length) errors.push(`${label}重复：${Array.from(new Set(duplicates)).join("、")}`);
  };
  unique(payload.subjects.map((item) => item.id), "学科 ID");
  unique(payload.chapters.map((item) => item.id), "章节 ID");
  unique(payload.modules.map((item) => item.id), "模块 ID");
  unique(payload.subjects.map((item) => String(item.order)), "学科顺序");
  unique(payload.modules.map((item) => String(item.order)), "模块顺序");
  const subjects = new Map(payload.subjects.map((item) => [item.id, item]));
  const chapters = new Map(payload.chapters.map((item) => [item.id, item]));
  for (const chapter of payload.chapters) {
    const subject = subjects.get(chapter.subjectId);
    if (!subject) errors.push(`章节 ${chapter.id} 引用了不存在的学科 ${chapter.subjectId}`);
    else if (chapter.active && !subject.active) errors.push(`启用章节 ${chapter.id} 不能隶属于停用学科 ${chapter.subjectId}`);
  }
  for (const subject of payload.subjects) {
    unique(payload.chapters.filter((item) => item.subjectId === subject.id).map((item) => String(item.order)), `学科 ${subject.id} 的章节顺序`);
    const policy = subject.qualityPolicy as SubjectQualityPolicy | null;
    for (const chapterId of Object.keys(policy?.chapters || {})) {
      const chapter = chapters.get(chapterId);
      if (!chapter) errors.push(`学科 ${subject.id} 的质量目标引用了不存在的章节 ${chapterId}`);
      else if (chapter.subjectId !== subject.id) errors.push(`学科 ${subject.id} 的质量目标不能引用其他学科章节 ${chapterId}`);
      else if (!chapter.active) errors.push(`学科 ${subject.id} 的质量目标不能引用停用章节 ${chapterId}`);
    }
  }
  for (const module of payload.modules) {
    unique(module.subjects.map((item) => item.subjectId), `模块 ${module.id} 的学科`);
    unique(module.subjects.map((item) => String(item.order)), `模块 ${module.id} 的学科顺序`);
    for (const link of module.subjects) {
      const subject = subjects.get(link.subjectId);
      if (!subject) errors.push(`模块 ${module.id} 引用了不存在的学科 ${link.subjectId}`);
      else if (module.active && !subject.active) errors.push(`启用模块 ${module.id} 不能引用停用学科 ${link.subjectId}`);
    }
    if (module.active && !module.subjects.length) errors.push(`启用模块 ${module.id} 至少需要一个学科`);
  }
  const linked = new Set(payload.modules.filter((item) => item.active).flatMap((item) => item.subjects.map((link) => link.subjectId)));
  for (const subject of payload.subjects.filter((item) => item.active)) {
    if (!linked.has(subject.id)) warnings.push(`启用学科 ${subject.id} 尚未加入任何启用模块`);
  }
  if (!payload.modules.some((item) => item.active)) errors.push("至少需要一个启用的首页模块");
  return { errors, warnings };
}

export class QuestionBankService {
  constructor(
    private readonly prisma: DatabaseClient,
    private readonly config: AppConfig,
    private readonly storage: QuestionBankStorage
  ) {}

  private auditData(input: AuditInput) {
    return {
      adminUserId: input.adminUserId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      beforeState: input.beforeState === undefined ? undefined : inputJson(input.beforeState),
      afterState: input.afterState === undefined ? undefined : inputJson(input.afterState),
      requestId: input.requestId || null,
      ipHash: input.ipHash || null
    };
  }

  async audit(input: AuditInput): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: this.auditData(input)
    });
  }

  private async syncImportBatchStatus(db: ImportStatusClient, draftIds: string[]): Promise<void> {
    if (!draftIds.length) return;
    const rows = await db.questionImportRow.findMany({
      where: { draftId: { in: draftIds } },
      select: { batchId: true }
    });
    const batchIds = Array.from(new Set(rows.map((row) => row.batchId)));
    for (const batchId of batchIds) {
      const linked = await db.questionImportRow.findMany({
        where: { batchId, draftId: { not: null } },
        select: { draft: { select: { status: true } } }
      });
      const statuses = linked.map((row) => row.draft?.status).filter(Boolean);
      if (!statuses.length) continue;
      const status = statuses.every((value) => value === "PUBLISHED")
        ? "PUBLISHED"
        : statuses.some((value) => value === "REJECTED")
          ? "REJECTED"
          : statuses.every((value) => value === "APPROVED")
            ? "APPROVED"
            : "IN_REVIEW";
      await db.questionImportBatch.update({ where: { id: batchId }, data: { status } });
    }
  }

  private async resolveImportCatalogCandidates(draftIds: string[], importBatchIds: string[]): Promise<ImportCatalogCandidates> {
    const linkedRows = draftIds.length ? await this.prisma.questionImportRow.findMany({
      where: { draftId: { in: draftIds } }, select: { batchId: true }
    }) : [];
    const linkedBatchIds = Array.from(new Set(linkedRows.map((row) => row.batchId))).sort();
    const batchIds = Array.from(new Set([...linkedBatchIds, ...importBatchIds.map(String).filter(Boolean)])).sort();
    if (!batchIds.length) return { batchIds: [], batches: [], subjects: [], chapters: [] };

    const selected = new Set(draftIds);
    const batches = await this.prisma.questionImportBatch.findMany({
      where: { id: { in: batchIds } },
      include: {
        reviews: { where: { decision: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 },
        rows: {
          include: { draft: { select: { id: true, status: true, contentHash: true } } },
          orderBy: [{ entityType: "asc" }, { rowNumber: "asc" }]
        }
      }
    });
    if (batches.length !== batchIds.length) throw new AppError("导入批次在发布前发生变化", "IMPORT_BATCH_CHANGED", 409);

    const subjects = new Map<string, ImportSubjectCandidate>();
    const chapters = new Map<string, ImportChapterCandidate>();
    const mergeCandidate = <T extends { id: string }>(target: Map<string, T>, value: T, label: string) => {
      const previous = target.get(value.id);
      if (previous && stableStringify(previous) !== stableStringify(value)) {
        throw new AppError(`所选导入批次包含冲突的${label} ${value.id}`, "IMPORT_CATALOG_CONFLICT", 409);
      }
      target.set(value.id, value);
    };

    for (const batch of batches) {
      if (batch.status !== "APPROVED" || !batch.contentHash) {
        throw new AppError(`导入批次 ${batch.id} 尚未通过整批复核`, "IMPORT_BATCH_NOT_APPROVED", 409);
      }
      const frozenHash = importBatchContentHash(batch.sourceHash, batch.rows);
      if (frozenHash !== batch.contentHash || batch.reviews[0]?.contentHash !== frozenHash) {
        throw new AppError(`导入批次 ${batch.id} 的冻结内容或复核哈希不一致`, "IMPORT_BATCH_HASH_MISMATCH", 409);
      }
      const questionRows = batch.rows.filter((row) => row.entityType === "question");
      const catalogRows = batch.rows.filter((row) => row.entityType === "subject" || row.entityType === "chapter");
      if (!questionRows.length && !catalogRows.length) {
        throw new AppError(`导入批次 ${batch.id} 没有可发布内容`, "IMPORT_BATCH_EMPTY", 409);
      }
      if (questionRows.some((row) => !row.draftId || !row.draft)) {
        throw new AppError(`导入批次 ${batch.id} 的题目草稿不完整`, "IMPORT_BATCH_DRAFTS_INCOMPLETE", 409);
      }
      const batchDraftIds = Array.from(new Set(questionRows.map((row) => row.draftId!)));
      if (batchDraftIds.some((draftId) => !selected.has(draftId))) {
        throw new AppError("同一导入批次必须一次发布全部题目草稿", "IMPORT_BATCH_PARTIAL_RELEASE", 409);
      }
      if (questionRows.some((row) => row.draft?.status !== "APPROVED")) {
        throw new AppError(`导入批次 ${batch.id} 仍有未通过复核的题目`, "IMPORT_BATCH_NOT_APPROVED", 409);
      }

      for (const row of batch.rows) {
        if (row.entityType !== "subject" && row.entityType !== "chapter") continue;
        const value = row.normalizedData;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new AppError(`导入批次 ${batch.id} 缺少可发布的目录候选数据`, "IMPORT_CATALOG_CANDIDATE_INVALID", 409);
        }
        const record = value as Record<string, unknown>;
        if (row.entityType === "subject") {
          if (![record.id, record.name, record.shortName, record.color].every((item) => typeof item === "string" && item.length > 0)) {
            throw new AppError(`导入批次 ${batch.id} 的学科候选数据无效`, "IMPORT_CATALOG_CANDIDATE_INVALID", 409);
          }
          mergeCandidate(subjects, {
            id: record.id as string,
            name: record.name as string,
            shortName: record.shortName as string,
            color: record.color as string,
            description: typeof record.description === "string" ? record.description : null,
            qualityPolicy: subjectQualityPolicy(record.qualityPolicy)
          }, "学科");
        } else {
          if (![record.id, record.subjectId, record.name].every((item) => typeof item === "string" && item.length > 0)) {
            throw new AppError(`导入批次 ${batch.id} 的章节候选数据无效`, "IMPORT_CATALOG_CANDIDATE_INVALID", 409);
          }
          mergeCandidate(chapters, {
            id: record.id as string,
            subjectId: record.subjectId as string,
            name: record.name as string,
            description: typeof record.description === "string" ? record.description : null
          }, "章节");
        }
      }
    }
    return {
      batchIds,
      batches: batches.map((batch) => ({ id: batch.id, revision: batch.revision, contentHash: batch.contentHash! })),
      subjects: Array.from(subjects.values()).sort((left, right) => left.id.localeCompare(right.id)),
      chapters: Array.from(chapters.values()).sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  private async applyImportCatalogCandidates(tx: Prisma.TransactionClient, candidates: ImportCatalogCandidates): Promise<void> {
    if (!candidates.batchIds.length) return;
    const subjectIds = candidates.subjects.map((subject) => subject.id);
    const chapterIds = candidates.chapters.map((chapter) => chapter.id);
    const [currentSubjects, currentChapters, subjectMaximum, moduleMaximum] = await Promise.all([
      tx.subject.findMany({ where: { id: { in: subjectIds } } }),
      tx.chapter.findMany({ where: { id: { in: chapterIds } } }),
      tx.subject.aggregate({ _max: { order: true } }),
      tx.catalogModule.aggregate({ _max: { order: true } })
    ]);
    const subjectById = new Map(currentSubjects.map((subject) => [subject.id, subject]));
    const chapterById = new Map(currentChapters.map((chapter) => [chapter.id, chapter]));
    let nextSubjectOrder = (subjectMaximum._max.order || 0) + 1;
    let nextModuleOrder = (moduleMaximum._max.order || 0) + 1;

    for (const candidate of candidates.subjects) {
      const current = subjectById.get(candidate.id);
      // Only a newly imported/inactive subject placeholder receives the
      // conventional same-id module. Existing active subjects may intentionally
      // live in a group/exam module and their manual composition must stay intact.
      const activateDefaultModule = !current || !current.active;
      await tx.subject.upsert({
        where: { id: candidate.id },
        update: {
          name: candidate.name,
          shortName: candidate.shortName,
          color: candidate.color,
          description: candidate.description,
          qualityPolicy: candidate.qualityPolicy === null ? Prisma.DbNull : inputJson(candidate.qualityPolicy),
          active: true
        },
        create: {
          ...candidate,
          qualityPolicy: candidate.qualityPolicy === null ? Prisma.DbNull : inputJson(candidate.qualityPolicy),
          order: nextSubjectOrder++,
          active: true
        }
      });
      if (activateDefaultModule) {
        await tx.catalogModule.upsert({
          where: { id: candidate.id },
          update: {
            name: candidate.name,
            subtitle: candidate.description || "专项练习",
            color: candidate.color,
            type: "SUBJECT",
            active: true
          },
          create: {
            id: candidate.id,
            name: candidate.name,
            subtitle: candidate.description || "专项练习",
            color: candidate.color,
            type: "SUBJECT",
            order: nextModuleOrder++,
            active: true
          }
        });
        await tx.catalogModuleSubject.upsert({
          where: { moduleId_subjectId: { moduleId: candidate.id, subjectId: candidate.id } },
          update: { order: 0 },
          create: { moduleId: candidate.id, subjectId: candidate.id, order: 0 }
        });
      }
    }

    const chapterMaximumBySubject = new Map<string, number>();
    for (const candidate of candidates.chapters) {
      const current = chapterById.get(candidate.id);
      if (current && current.subjectId !== candidate.subjectId) {
        throw new AppError(`章节 ${candidate.id} 不能移动到其他学科`, "CHAPTER_SUBJECT_CONFLICT", 409);
      }
      let order = current?.order;
      if (order === undefined) {
        if (!chapterMaximumBySubject.has(candidate.subjectId)) {
          const maximum = await tx.chapter.aggregate({ where: { subjectId: candidate.subjectId }, _max: { order: true } });
          chapterMaximumBySubject.set(candidate.subjectId, maximum._max.order || 0);
        }
        order = (chapterMaximumBySubject.get(candidate.subjectId) || 0) + 1;
        chapterMaximumBySubject.set(candidate.subjectId, order);
      }
      await tx.chapter.upsert({
        where: { id: candidate.id },
        update: { name: candidate.name, description: candidate.description, active: true },
        create: { ...candidate, order, active: true }
      });
    }
  }

  private async applyCatalogPayload(tx: Prisma.TransactionClient, value: CatalogDraftPayload): Promise<void> {
    const payload = normalizeCatalogDraftPayload(value);
    const subjectIds = payload.subjects.map((subject) => subject.id);
    const chapterIds = payload.chapters.map((chapter) => chapter.id);
    const moduleIds = payload.modules.map((module) => module.id);
    await tx.catalogModule.updateMany({ data: { order: { increment: 200_000 }, active: false } });
    await tx.chapter.updateMany({ data: { order: { increment: 200_000 }, active: false } });
    await tx.subject.updateMany({ data: { order: { increment: 200_000 }, active: false } });
    for (const subject of payload.subjects) {
      await tx.subject.upsert({
        where: { id: subject.id },
        update: {
          name: subject.name, shortName: subject.shortName, order: subject.order, color: subject.color,
          description: subject.description, iconKey: subject.iconKey,
          qualityPolicy: subject.qualityPolicy === null ? Prisma.DbNull : inputJson(subject.qualityPolicy),
          active: subject.active
        },
        create: {
          id: subject.id, name: subject.name, shortName: subject.shortName, order: subject.order, color: subject.color,
          description: subject.description, iconKey: subject.iconKey,
          qualityPolicy: subject.qualityPolicy === null ? Prisma.DbNull : inputJson(subject.qualityPolicy),
          active: subject.active
        }
      });
    }
    for (const chapter of payload.chapters) {
      await tx.chapter.upsert({
        where: { id: chapter.id },
        update: { subjectId: chapter.subjectId, name: chapter.name, order: chapter.order, description: chapter.description, active: chapter.active },
        create: chapter
      });
    }
    await tx.catalogModuleSubject.deleteMany({});
    for (const module of payload.modules) {
      await tx.catalogModule.upsert({
        where: { id: module.id },
        update: { name: module.name, subtitle: module.subtitle, color: module.color, type: module.type as never, order: module.order, active: module.active },
        create: { id: module.id, name: module.name, subtitle: module.subtitle, color: module.color, type: module.type as never, order: module.order, active: module.active }
      });
      if (module.subjects.length) {
        await tx.catalogModuleSubject.createMany({ data: module.subjects.map((link) => ({ moduleId: module.id, subjectId: link.subjectId, order: link.order })) });
      }
    }
    if (subjectIds.length) await tx.subject.updateMany({ where: { id: { notIn: subjectIds } }, data: { active: false } });
    if (chapterIds.length) await tx.chapter.updateMany({ where: { id: { notIn: chapterIds } }, data: { active: false } });
    if (moduleIds.length) await tx.catalogModule.updateMany({ where: { id: { notIn: moduleIds } }, data: { active: false } });
  }

  private async activeCatalogBase(): Promise<{ releaseId: string; payload: CatalogDraftPayload; catalogHash: string; snapshot: ReleaseSnapshot }> {
    const state = await this.prisma.catalogState.findUnique({
      where: { id: 1 },
      include: { activeRelease: true }
    });
    const release = state?.activeRelease;
    if (!release || release.status !== "PUBLISHED" || !release.snapshotKey || !release.snapshotHash) {
      throw new AppError("当前题库缺少可编辑的活动发布快照", "CATALOG_BASE_UNAVAILABLE", 503);
    }
    const snapshot = this.parseVerifiedSnapshot(
      await this.storage.get(release.snapshotKey),
      release.snapshotHash,
      "CATALOG_SNAPSHOT_HASH_MISMATCH"
    );
    const payload = normalizeCatalogDraftPayload(snapshot);
    const catalogHash = catalogPayloadHash(payload);
    if (release.catalogHash !== catalogHash) {
      await this.prisma.questionRelease.updateMany({
        where: { id: release.id, catalogHash: release.catalogHash },
        data: { catalogHash }
      });
    }
    return { releaseId: release.id, payload, catalogHash, snapshot };
  }

  async listCatalogDrafts(query: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    if (status && !["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "PUBLISHED", "CANCELLED"].includes(status)) {
      throw new AppError("目录草稿状态筛选值无效", "INVALID_CATALOG_DRAFT_FILTER", 400);
    }
    const where: Prisma.CatalogDraftWhereInput = status ? { status: status as never } : {};
    const [total, items] = await Promise.all([
      this.prisma.catalogDraft.count({ where }),
      this.prisma.catalogDraft.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { username: true, displayName: true } },
          submittedBy: { select: { username: true, displayName: true } },
          reviews: { orderBy: { createdAt: "desc" }, take: 1, include: { reviewer: { select: { username: true, displayName: true } } } },
          publishedRelease: { select: { id: true, name: true, snapshotHash: true, publishedAt: true } }
        }
      })
    ]);
    return { page, pageSize, total, items };
  }

  async getCatalogDraft(id: string) {
    const draft = await this.prisma.catalogDraft.findUnique({
      where: { id },
      include: {
        createdBy: { select: { username: true, displayName: true } },
        submittedBy: { select: { username: true, displayName: true } },
        reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { username: true, displayName: true } } } },
        publishedRelease: { select: { id: true, name: true, snapshotHash: true, publishedAt: true } }
      }
    });
    if (!draft) throw new AppError("目录草稿不存在", "CATALOG_DRAFT_NOT_FOUND", 404);
    return draft;
  }

  async createCatalogDraft(adminUserId: string, name: string, requestId?: string) {
    const base = await this.activeCatalogBase();
    const payload = normalizeCatalogDraftPayload(base.payload);
    const validation = validateCatalogDraftPayload(payload);
    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await tx.catalogDraft.create({
        data: {
          name: normalizedText(name || `目录变更 ${new Date().toISOString()}`, "目录草稿名称", 128),
          baseReleaseId: base.releaseId,
          baseCatalogHash: base.catalogHash,
          payload: inputJson(payload),
          contentHash: catalogPayloadHash(payload),
          validationErrors: inputJson(validation.errors),
          validationWarnings: inputJson(validation.warnings),
          createdById: adminUserId
        }
      });
      await tx.adminAuditLog.create({
        data: this.auditData({ adminUserId, action: "catalog_draft.create", entityType: "catalog_draft", entityId: created.id, afterState: { name: created.name, baseCatalogHash: created.baseCatalogHash, contentHash: created.contentHash }, requestId })
      });
      return created;
    });
    return draft;
  }

  async updateCatalogDraft(adminUserId: string, id: string, revision: number, value: unknown, requestId?: string) {
    const before = await this.prisma.catalogDraft.findUnique({ where: { id } });
    if (!before) throw new AppError("目录草稿不存在", "CATALOG_DRAFT_NOT_FOUND", 404);
    if (!["DRAFT", "REJECTED"].includes(before.status)) throw new AppError("目录草稿当前不可编辑", "CATALOG_DRAFT_NOT_EDITABLE", 409);
    const payload = normalizeCatalogDraftPayload(value);
    const validation = validateCatalogDraftPayload(payload);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.catalogDraft.updateMany({
        where: { id, revision, status: { in: ["DRAFT", "REJECTED"] } },
        data: {
          payload: inputJson(payload),
          contentHash: catalogPayloadHash(payload),
          validationErrors: inputJson(validation.errors),
          validationWarnings: inputJson(validation.warnings),
          status: "DRAFT",
          submittedById: null,
          submittedAt: null,
          warningsAcknowledgedAt: null,
          revision: { increment: 1 }
        }
      });
      if (claimed.count !== 1) throw new AppError("目录草稿已被其他操作更新，请刷新后重试", "CATALOG_DRAFT_REVISION_CONFLICT", 409);
      const updated = await tx.catalogDraft.findUniqueOrThrow({ where: { id } });
      await tx.adminAuditLog.create({ data: this.auditData({ adminUserId, action: "catalog_draft.update", entityType: "catalog_draft", entityId: id, beforeState: { revision: before.revision, contentHash: before.contentHash }, afterState: { revision: updated.revision, contentHash: updated.contentHash }, requestId }) });
      return updated;
    });
  }

  async submitCatalogDraft(adminUserId: string, id: string, acknowledgeWarnings = false, requestId?: string) {
    const before = await this.prisma.catalogDraft.findUnique({ where: { id } });
    if (!before) throw new AppError("目录草稿不存在", "CATALOG_DRAFT_NOT_FOUND", 404);
    if (!["DRAFT", "REJECTED"].includes(before.status)) throw new AppError("目录草稿当前不能提交复核", "CATALOG_DRAFT_NOT_SUBMITTABLE", 409);
    const payload = normalizeCatalogDraftPayload(before.payload);
    const validation = validateCatalogDraftPayload(payload);
    const contentHash = catalogPayloadHash(payload);
    if (contentHash === before.baseCatalogHash) throw new AppError("目录草稿没有实际变更", "CATALOG_DRAFT_NO_CHANGES", 409);
    if (validation.errors.length) throw new AppError("目录草稿仍有阻断错误", "CATALOG_DRAFT_VALIDATION_FAILED", 409, validation.errors);
    if (validation.warnings.length && !acknowledgeWarnings) throw new AppError("请先确认目录校验警告", "CATALOG_DRAFT_WARNINGS_NOT_ACKNOWLEDGED", 409, validation.warnings);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.catalogDraft.updateMany({
        where: { id, revision: before.revision, status: { in: ["DRAFT", "REJECTED"] }, contentHash: before.contentHash },
        data: {
          payload: inputJson(payload), contentHash,
          validationErrors: inputJson(validation.errors), validationWarnings: inputJson(validation.warnings),
          status: "IN_REVIEW", submittedById: adminUserId, submittedAt: new Date(),
          warningsAcknowledgedAt: validation.warnings.length ? new Date() : null,
          revision: { increment: 1 }
        }
      });
      if (claimed.count !== 1) throw new AppError("目录草稿在提交时发生变化，请刷新后重试", "CATALOG_DRAFT_REVISION_CONFLICT", 409);
      const updated = await tx.catalogDraft.findUniqueOrThrow({ where: { id } });
      await tx.adminAuditLog.create({ data: this.auditData({ adminUserId, action: "catalog_draft.submit", entityType: "catalog_draft", entityId: id, beforeState: { status: before.status, contentHash: before.contentHash }, afterState: { status: updated.status, contentHash: updated.contentHash }, requestId }) });
      return updated;
    });
  }

  async reviewCatalogDraft(adminUserId: string, id: string, decision: "APPROVED" | "REJECTED", comment?: string, requestId?: string) {
    const before = await this.prisma.catalogDraft.findUnique({ where: { id } });
    if (!before) throw new AppError("目录草稿不存在", "CATALOG_DRAFT_NOT_FOUND", 404);
    if (before.status !== "IN_REVIEW") throw new AppError("目录草稿不在复核状态", "CATALOG_DRAFT_NOT_IN_REVIEW", 409);
    if (before.submittedById === adminUserId) throw new AppError("提交人不能复核自己的目录草稿", "SELF_REVIEW_FORBIDDEN", 403);
    const contentHash = catalogPayloadHash(normalizeCatalogDraftPayload(before.payload));
    if (contentHash !== before.contentHash) throw new AppError("目录草稿冻结内容校验失败", "CATALOG_DRAFT_HASH_MISMATCH", 409);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.catalogDraft.updateMany({
        where: { id, revision: before.revision, status: "IN_REVIEW", contentHash },
        data: { status: decision, revision: { increment: 1 } }
      });
      if (claimed.count !== 1) throw new AppError("目录草稿已被其他复核者处理，请刷新后重试", "CATALOG_DRAFT_REVIEW_CONFLICT", 409);
      await tx.catalogDraftReview.create({ data: { catalogDraftId: id, reviewerId: adminUserId, decision, contentHash, comment: comment?.normalize("NFKC").trim() || null } });
      const updated = await tx.catalogDraft.findUniqueOrThrow({ where: { id } });
      await tx.adminAuditLog.create({ data: this.auditData({ adminUserId, action: `catalog_draft.review.${decision.toLowerCase()}`, entityType: "catalog_draft", entityId: id, beforeState: { status: before.status, contentHash }, afterState: { status: updated.status, contentHash }, requestId }) });
      return updated;
    });
  }

  async adminCatalog(catalogDraftId?: string) {
    const payload = catalogDraftId
      ? normalizeCatalogDraftPayload((await this.getCatalogDraft(catalogDraftId)).payload)
      : (await this.activeCatalogBase()).payload;
    return {
      modules: payload.modules,
      subjects: payload.subjects.map((subject) => ({
        ...subject,
        chapters: payload.chapters.filter((chapter) => chapter.subjectId === subject.id)
      }))
    };
  }

  async createSubject(adminUserId: string, input: { id: string; name: string; shortName: string; color?: string; description?: string; iconKey?: string; qualityPolicy?: unknown }, requestId?: string) {
    void adminUserId; void input; void requestId;
    throw new AppError("请通过目录变更集创建学科", "CATALOG_DRAFT_REQUIRED", 409);
    /* legacy implementation is intentionally unreachable; retained temporarily for source-compatible callers */
    const id = String(input.id || "").normalize("NFKC").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new AppError("学科 ID 必须以字母开头并使用小写字母、数字或连字符", "INVALID_SUBJECT_ID", 400);
    const name = String(input.name || "").normalize("NFKC").trim();
    const shortName = String(input.shortName || "").normalize("NFKC").trim();
    const qualityPolicy = subjectQualityPolicy(input.qualityPolicy);
    if (!name || !shortName) throw new AppError("学科名称和简称不能为空", "INVALID_SUBJECT", 400);
    const created = await this.prisma.$transaction(async (tx) => {
      const subjectMax = await tx.subject.aggregate({ _max: { order: true } });
      const moduleMax = await tx.catalogModule.aggregate({ _max: { order: true } });
      const order = (subjectMax._max.order || 0) + 1;
      const subject = await tx.subject.create({
        data: {
          id,
          name,
          shortName,
          order,
          color: input.color || "#2563eb",
          description: input.description?.trim() || null,
          iconKey: input.iconKey?.trim() || null,
          qualityPolicy: qualityPolicy === null ? Prisma.DbNull : inputJson(qualityPolicy)
        }
      });
      await tx.catalogModule.create({
        data: {
          id,
          name,
          subtitle: input.description?.trim() || "专项练习",
          color: input.color || "#2563eb",
          type: "SUBJECT",
          order: (moduleMax._max.order || 0) + 1,
          subjects: { create: { subjectId: id, order: 0 } }
        }
      });
      return subject;
    });
    await this.audit({ adminUserId, action: "subject.create", entityType: "subject", entityId: id, afterState: created, requestId });
    return created;
  }

  async updateSubject(adminUserId: string, id: string, input: { name?: string; shortName?: string; color?: string; description?: string | null; iconKey?: string | null; active?: boolean; qualityPolicy?: unknown }, requestId?: string) {
    void adminUserId; void id; void input; void requestId;
    throw new AppError("请通过目录变更集修改学科", "CATALOG_DRAFT_REQUIRED", 409);
    const before = await this.prisma.subject.findUnique({ where: { id } });
    const qualityPolicy = input.qualityPolicy === undefined ? undefined : subjectQualityPolicy(input.qualityPolicy);
    if (!before) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
    const updated = await this.prisma.subject.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name!.normalize("NFKC").trim() } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName!.normalize("NFKC").trim() } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.iconKey !== undefined ? { iconKey: input.iconKey?.trim() || null } : {}),
        ...(qualityPolicy !== undefined ? {
          qualityPolicy: qualityPolicy === null ? Prisma.DbNull : inputJson(qualityPolicy)
        } : {}),
        ...(input.active !== undefined ? { active: input.active } : {})
      }
    });
    await this.audit({ adminUserId, action: "subject.update", entityType: "subject", entityId: id, beforeState: before, afterState: updated, requestId });
    return updated;
  }

  async createChapter(adminUserId: string, subjectId: string, input: { id: string; name: string; description?: string }, requestId?: string) {
    void adminUserId; void subjectId; void input; void requestId;
    throw new AppError("请通过目录变更集创建章节", "CATALOG_DRAFT_REQUIRED", 409);
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new AppError("学科不存在", "SUBJECT_NOT_FOUND", 404);
    const id = String(input.id || "").normalize("NFKC").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new AppError("章节 ID 格式无效", "INVALID_CHAPTER_ID", 400);
    const max = await this.prisma.chapter.aggregate({ where: { subjectId }, _max: { order: true } });
    const created = await this.prisma.chapter.create({ data: { id, subjectId, name: input.name.normalize("NFKC").trim(), description: input.description?.trim() || null, order: (max._max.order || 0) + 1 } });
    await this.audit({ adminUserId, action: "chapter.create", entityType: "chapter", entityId: id, afterState: created, requestId });
    return created;
  }

  async updateChapter(adminUserId: string, id: string, input: { name?: string; description?: string | null; active?: boolean; order?: number }, requestId?: string) {
    void adminUserId; void id; void input; void requestId;
    throw new AppError("请通过目录变更集修改章节", "CATALOG_DRAFT_REQUIRED", 409);
    const before = await this.prisma.chapter.findUnique({ where: { id } });
    if (!before) throw new AppError("章节不存在", "CHAPTER_NOT_FOUND", 404);
    const updated = await this.prisma.chapter.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name!.normalize("NFKC").trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.order !== undefined ? { order: input.order } : {})
      }
    });
    await this.audit({ adminUserId, action: "chapter.update", entityType: "chapter", entityId: id, beforeState: before, afterState: updated, requestId });
    return updated;
  }

  async saveCatalogModule(adminUserId: string, idValue: string, input: { name: string; subtitle?: string | null; color?: string; type: "SUBJECT" | "GROUP" | "EXAM"; order?: number; active?: boolean; subjectIds: string[] }, requestId?: string) {
    void adminUserId; void idValue; void input; void requestId;
    throw new AppError("请通过目录变更集修改首页模块", "CATALOG_DRAFT_REQUIRED", 409);
    const id = String(idValue || "").normalize("NFKC").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new AppError("首页模块 ID 格式无效", "INVALID_MODULE_ID", 400);
    if (!['SUBJECT', 'GROUP', 'EXAM'].includes(input.type)) throw new AppError("首页模块类型无效", "INVALID_MODULE_TYPE", 400);
    const subjectIds = Array.from(new Set((input.subjectIds || []).map(String).filter(Boolean)));
    if (!subjectIds.length) throw new AppError("首页模块至少需要一个学科", "MODULE_SUBJECT_REQUIRED", 400);
    const activeSubjects = await this.prisma.subject.count({ where: { id: { in: subjectIds }, active: true } });
    if (activeSubjects !== subjectIds.length) throw new AppError("首页模块引用了不存在或停用的学科", "MODULE_SUBJECT_INVALID", 400);
    const before = await this.prisma.catalogModule.findUnique({ where: { id }, include: { subjects: true } });
    const saved = await this.prisma.$transaction(async (tx) => {
      const max = await tx.catalogModule.aggregate({ _max: { order: true } });
      const module = await tx.catalogModule.upsert({
        where: { id },
        update: {
          name: input.name.normalize("NFKC").trim(), subtitle: input.subtitle?.normalize("NFKC").trim() || null,
          color: input.color || "#2563eb", type: input.type, ...(input.order ? { order: input.order } : {}),
          ...(input.active !== undefined ? { active: input.active } : {})
        },
        create: {
          id, name: input.name.normalize("NFKC").trim(), subtitle: input.subtitle?.normalize("NFKC").trim() || null,
          color: input.color || "#2563eb", type: input.type, order: input.order || (max._max.order || 0) + 1,
          active: input.active ?? true
        }
      });
      await tx.catalogModuleSubject.deleteMany({ where: { moduleId: id } });
      await tx.catalogModuleSubject.createMany({ data: subjectIds.map((subjectId, order) => ({ moduleId: id, subjectId, order })) });
      return module;
    });
    await this.audit({ adminUserId, action: before ? "module.update" : "module.create", entityType: "catalog_module", entityId: id, beforeState: before, afterState: { ...saved, subjectIds }, requestId });
    return this.prisma.catalogModule.findUniqueOrThrow({ where: { id }, include: { subjects: { orderBy: { order: "asc" } } } });
  }

  private async validateAgainstDatabase(value: NormalizedDraftQuestion, questionId?: string) {
    const validation = validateDraftQuestion(value);
    const prefix = value.stem.slice(0, Math.min(12, value.stem.length));
    const [subject, chapter, duplicateExternal, exactStem, readyMedia, similarCandidates] = await Promise.all([
      this.prisma.subject.findFirst({ where: { id: value.subjectId, active: true } }),
      this.prisma.chapter.findFirst({ where: { id: value.chapterId, subjectId: value.subjectId, active: true } }),
      value.externalCode ? this.prisma.question.findFirst({ where: { externalCode: value.externalCode, ...(questionId ? { id: { not: questionId } } : {}) } }) : null,
      value.stem ? this.prisma.question.findFirst({
        where: { id: questionId ? { not: questionId } : undefined, currentVersion: { stem: value.stem } },
        select: { id: true }
      }) : null,
      value.images.length ? this.prisma.mediaAsset.count({ where: { status: "READY", publicUrl: { in: value.images.map((image) => image.src) } } }) : 0
      , value.stem.length >= 4 ? this.prisma.$queryRaw<Array<{ id: string; stem: string }>>(Prisma.sql`
          SELECT q.id, v.stem
          FROM questions q
          JOIN question_versions v ON v.id = q.current_version_id
          WHERE (${questionId ? Prisma.sql`q.id <> ${questionId} AND` : Prisma.empty} (v.stem LIKE ${`%${prefix}%`} OR MATCH(v.stem) AGAINST(${value.stem} IN NATURAL LANGUAGE MODE)))
          LIMIT 20
        `) : []
    ]);
    if (!subject) validation.errors.push("学科不存在或已停用");
    if (!chapter) validation.errors.push("章节不存在、已停用或不属于该学科");
    if (duplicateExternal) validation.errors.push("外部题号已被其他题目使用");
    if (exactStem) validation.warnings.push(`题干与已发布题目 ${exactStem.id} 完全相同`);
    const near = similarCandidates
      .map((candidate) => ({ ...candidate, similarity: questionTextSimilarity(value.stem, candidate.stem) }))
      .filter((candidate) => candidate.similarity >= 0.82)
      .sort((left, right) => right.similarity - left.similarity)[0];
    if (near && near.id !== exactStem?.id) validation.warnings.push(`题干可能与 ${near.id} 重复（相似度 ${Math.round(near.similarity * 100)}%）`);
    if (readyMedia !== value.images.length) validation.errors.push("题目引用了未完成上传或未通过校验的媒体资源");
    return validation;
  }

  async dashboard() {
    const [subjects, chapters, questions, drafts, imports, releases, media] = await Promise.all([
      this.prisma.subject.count({ where: { active: true } }),
      this.prisma.chapter.count({ where: { active: true } }),
      this.prisma.question.count({ where: { status: "ACTIVE" } }),
      this.prisma.questionDraft.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.questionImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      this.prisma.questionRelease.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      this.prisma.mediaAsset.groupBy({ by: ["status"], _count: { _all: true } })
    ]);
    return { subjects, chapters, questions, drafts, imports, releases, media };
  }

  async listQuestions(query: { page?: number; pageSize?: number; search?: string; subjectId?: string; chapterId?: string; type?: string; difficulty?: number; status?: string; publishedFrom?: string; publishedTo?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const search = String(query.search || "").normalize("NFKC").trim();
    const type = query.type ? String(query.type).toUpperCase() : undefined;
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    const rawDifficulty = query.difficulty as unknown;
    const difficulty = rawDifficulty === undefined || rawDifficulty === null || rawDifficulty === ""
      ? undefined
      : Number(rawDifficulty);
    if (type && !["SINGLE", "MULTIPLE", "JUDGE", "FILL_BLANK", "SHORT_ANSWER"].includes(type)) {
      throw new AppError("题型筛选值无效", "INVALID_QUESTION_FILTER", 400);
    }
    if (status && !["ACTIVE", "DISABLED"].includes(status)) throw new AppError("题目状态筛选值无效", "INVALID_QUESTION_FILTER", 400);
    if (difficulty !== undefined && ![1, 2, 3].includes(difficulty)) throw new AppError("难度筛选值无效", "INVALID_QUESTION_FILTER", 400);
    const matchedIds = search ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT q.id
      FROM questions q
      JOIN question_versions v ON v.id = q.current_version_id
      WHERE MATCH(v.stem) AGAINST(${search} IN NATURAL LANGUAGE MODE)
      UNION DISTINCT
      SELECT q.id
      FROM questions q
      WHERE q.id LIKE ${`${search}%`} OR q.external_code LIKE ${`${search}%`}
      UNION DISTINCT
      SELECT q.id
      FROM questions q
      JOIN question_versions v ON v.id = q.current_version_id
      WHERE JSON_SEARCH(v.tags, 'one', ${`%${search}%`}) IS NOT NULL
      LIMIT 100000
    `) : [];
    const dateFilter = (value: string | undefined, label: string): Date | undefined => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new AppError(`${label}格式无效`, "INVALID_DATE_FILTER", 400);
      return parsed;
    };
    const publishedFrom = dateFilter(query.publishedFrom, "发布起始时间");
    const publishedTo = dateFilter(query.publishedTo, "发布截止时间");
    if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
      throw new AppError("发布起始时间不能晚于截止时间", "INVALID_DATE_FILTER", 400);
    }
    const createdAt = query.publishedFrom || query.publishedTo ? {
      ...(publishedFrom ? { gte: publishedFrom } : {}),
      ...(publishedTo ? { lte: publishedTo } : {})
    } : undefined;
    const where: Prisma.QuestionWhereInput = {
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.chapterId ? { chapterId: query.chapterId } : {}),
      ...(status ? { status: status as "ACTIVE" | "DISABLED" } : {}),
      ...((type || difficulty || createdAt) ? {
        currentVersion: {
          ...(type ? { type: type as never } : {}),
          ...(difficulty ? { difficulty } : {}),
          ...(createdAt ? { createdAt } : {})
        }
      } : {}),
      ...(search ? { id: { in: matchedIds.map((item) => item.id) } } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { subject: true, chapter: true, currentVersion: { include: { options: { orderBy: { position: "asc" } } } } }
      })
    ]);
    return { page, pageSize, total, items };
  }

  async listDrafts(query: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    if (status && !["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "PUBLISHED", "CANCELLED"].includes(status)) {
      throw new AppError("题目草稿状态筛选值无效", "INVALID_DRAFT_FILTER", 400);
    }
    const where: Prisma.QuestionDraftWhereInput = status ? { status: status as never } : {};
    const [total, items] = await Promise.all([
      this.prisma.questionDraft.count({ where }),
      this.prisma.questionDraft.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          baseVersion: { include: { options: { orderBy: { position: "asc" } } } },
          createdBy: { select: { username: true, displayName: true } },
          submittedBy: { select: { username: true, displayName: true } },
          reviews: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      })
    ]);
    return { page, pageSize, total, items };
  }

  async createDraft(adminUserId: string, input: DraftQuestionInput & { action?: "UPSERT" | "DISABLE" }, requestId?: string) {
    const normalized = normalizeDraftQuestion(input);
    const questionId = input.questionId || generateQuestionId();
    const existing = await this.prisma.question.findUnique({ where: { id: questionId }, include: { currentVersion: true } });
    if (input.questionId && !existing) throw new AppError("待修改题目不存在", "QUESTION_NOT_FOUND", 404);
    const openDraft = existing ? await this.prisma.questionDraft.findFirst({
      where: { questionId, status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] } },
      select: { id: true }
    }) : null;
    if (openDraft) throw new AppError("该题已有未完成草稿，请先处理现有草稿", "QUESTION_DRAFT_ALREADY_EXISTS", 409, { draftId: openDraft.id });
    const validation = await this.validateAgainstDatabase(normalized, existing?.id);
    const action = input.action || "UPSERT";
    if (action === "DISABLE" && !existing?.currentVersionId) throw new AppError("只能停用已发布题目", "QUESTION_NOT_PUBLISHED", 409);
    const draft = await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.question.create({
          data: {
            id: questionId,
            externalCode: normalized.externalCode,
            subjectId: normalized.subjectId,
            chapterId: normalized.chapterId,
            status: "DISABLED",
            sourceSystem: "admin"
          }
        });
      }
      const created = await tx.questionDraft.create({
        data: {
          questionId,
          externalCode: normalized.externalCode,
          baseVersionId: existing?.currentVersionId || null,
          subjectId: normalized.subjectId,
          chapterId: normalized.chapterId,
          type: normalized.type,
          stem: normalized.stem,
          code: normalized.code,
          explanation: normalized.explanation,
          difficulty: normalized.difficulty,
          tags: inputJson(normalized.tags),
          images: inputJson(normalized.images),
          examScopes: inputJson(normalized.examScopes),
          correctOptionIds: inputJson(normalized.correctOptionIds),
          acceptedAnswers: inputJson(normalized.acceptedAnswers),
          answerConfig: inputJson(normalized.answerConfig),
          referenceAnswer: normalized.referenceAnswer,
          options: inputJson(normalized.options),
          contentHash: questionContentHash(normalized),
          action,
          validationErrors: inputJson(validation.errors),
          validationWarnings: inputJson(validation.warnings),
          createdById: adminUserId
        }
      });
      await tx.adminAuditLog.create({
        data: this.auditData({ adminUserId, action: "draft.create", entityType: "question_draft", entityId: created.id, afterState: created, requestId })
      });
      return created;
    });
    return publicDraft(draft as unknown as Record<string, unknown>);
  }

  async updateDraft(adminUserId: string, draftId: string, revision: number, input: DraftQuestionInput, requestId?: string) {
    const before = await this.prisma.questionDraft.findUnique({ where: { id: draftId } });
    if (!before) throw new AppError("草稿不存在", "DRAFT_NOT_FOUND", 404);
    if (!["DRAFT", "REJECTED"].includes(before.status)) throw new AppError("当前草稿状态不可编辑", "DRAFT_NOT_EDITABLE", 409);
    if (before.revision !== revision) throw new AppError("草稿已被其他操作更新，请刷新后重试", "DRAFT_REVISION_CONFLICT", 409);
    const normalized = normalizeDraftQuestion(input);
    const validation = await this.validateAgainstDatabase(normalized, before.questionId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.questionDraft.updateMany({
        where: { id: draftId, revision, status: { in: ["DRAFT", "REJECTED"] } },
        data: {
          externalCode: normalized.externalCode,
          subjectId: normalized.subjectId,
          chapterId: normalized.chapterId,
          type: normalized.type,
          stem: normalized.stem,
          code: normalized.code,
          explanation: normalized.explanation,
          difficulty: normalized.difficulty,
          tags: inputJson(normalized.tags),
          images: inputJson(normalized.images),
          examScopes: inputJson(normalized.examScopes),
          correctOptionIds: inputJson(normalized.correctOptionIds),
          acceptedAnswers: inputJson(normalized.acceptedAnswers),
          answerConfig: inputJson(normalized.answerConfig),
          referenceAnswer: normalized.referenceAnswer,
          options: inputJson(normalized.options),
          contentHash: questionContentHash(normalized),
          validationErrors: inputJson(validation.errors),
          validationWarnings: inputJson(validation.warnings),
          status: "DRAFT",
          warningsAcknowledgedAt: null,
          revision: { increment: 1 }
        }
      });
      if (claimed.count !== 1) {
        throw new AppError("草稿已被其他操作更新，请刷新后重试", "DRAFT_REVISION_CONFLICT", 409);
      }
      const result = await tx.questionDraft.findUnique({ where: { id: draftId } });
      if (!result) throw new AppError("草稿不存在", "DRAFT_NOT_FOUND", 404);
      await tx.adminAuditLog.create({
        data: this.auditData({ adminUserId, action: "draft.update", entityType: "question_draft", entityId: draftId, beforeState: before, afterState: result, requestId })
      });
      return result;
    });
    return updated;
  }

  async submitDraft(adminUserId: string, draftId: string, acknowledgeWarnings = false, requestId?: string) {
    const imported = await this.prisma.questionImportRow.findFirst({ where: { draftId }, select: { batchId: true } });
    if (imported) throw new AppError("Excel 导入题目必须通过整批提交复核", "IMPORT_BATCH_SUBMIT_REQUIRED", 409, { importBatchId: imported.batchId });
    const before = await this.prisma.questionDraft.findUnique({ where: { id: draftId } });
    if (!before) throw new AppError("草稿不存在", "DRAFT_NOT_FOUND", 404);
    if (!["DRAFT", "REJECTED"].includes(before.status)) throw new AppError("草稿当前不能提交复核", "DRAFT_NOT_SUBMITTABLE", 409);
    if (jsonArray(before.validationErrors).length) throw new AppError("草稿仍有阻断错误", "DRAFT_VALIDATION_FAILED", 409, before.validationErrors);
    if (jsonArray(before.validationWarnings).length && !acknowledgeWarnings) throw new AppError("请先确认题目校验警告", "DRAFT_WARNINGS_NOT_ACKNOWLEDGED", 409, before.validationWarnings);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.questionDraft.updateMany({
        where: { id: draftId, revision: before.revision, status: { in: ["DRAFT", "REJECTED"] } },
        data: { status: "IN_REVIEW", submittedById: adminUserId, submittedAt: new Date(), warningsAcknowledgedAt: jsonArray(before.validationWarnings).length ? new Date() : null, revision: { increment: 1 } }
      });
      if (claimed.count !== 1) throw new AppError("草稿已被其他操作更新，请刷新后重试", "DRAFT_SUBMIT_CONFLICT", 409);
      const updated = await tx.questionDraft.findUniqueOrThrow({ where: { id: draftId } });
      await tx.adminAuditLog.create({
        data: this.auditData({ adminUserId, action: "draft.submit", entityType: "question_draft", entityId: draftId, beforeState: before, afterState: updated, requestId })
      });
      return updated;
    });
  }

  async reviewDraft(adminUserId: string, draftId: string, decision: "APPROVED" | "REJECTED", comment?: string, requestId?: string) {
    const imported = await this.prisma.questionImportRow.findFirst({ where: { draftId }, select: { batchId: true } });
    if (imported) {
      throw new AppError("Excel 导入题目必须通过整批复核", "IMPORT_BATCH_REVIEW_REQUIRED", 409, { importBatchId: imported.batchId });
    }
    const draft = await this.prisma.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new AppError("草稿不存在", "DRAFT_NOT_FOUND", 404);
    if (draft.status !== "IN_REVIEW") throw new AppError("草稿不在复核状态", "DRAFT_NOT_IN_REVIEW", 409);
    if (draft.submittedById === adminUserId) throw new AppError("提交人不能复核自己的草稿", "SELF_REVIEW_FORBIDDEN", 403);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.questionDraft.updateMany({
        where: { id: draftId, status: "IN_REVIEW", revision: draft.revision },
        data: { status: decision, revision: { increment: 1 } }
      });
      if (claimed.count !== 1) {
        throw new AppError("草稿已被其他复核者处理，请刷新后重试", "DRAFT_REVIEW_CONFLICT", 409);
      }
      await tx.draftReview.create({ data: { draftId, reviewerId: adminUserId, decision, comment: comment?.trim() || null } });
      const result = await tx.questionDraft.findUnique({ where: { id: draftId } });
      if (!result) throw new AppError("草稿不存在", "DRAFT_NOT_FOUND", 404);
      await tx.adminAuditLog.create({
        data: this.auditData({ adminUserId, action: `draft.review.${decision.toLowerCase()}`, entityType: "question_draft", entityId: draftId, beforeState: draft, afterState: result, requestId })
      });
      await this.syncImportBatchStatus(tx, [draftId]);
      return result;
    });
    return updated;
  }

  private async withReleaseLock<T>(callback: () => Promise<T>): Promise<T> {
    const options = parseMysqlDatabaseUrl(this.config.databaseUrl);
    const connection = await mariadb.createConnection({ ...options, allowPublicKeyRetrieval: true });
    try {
      const result = await connection.query<Array<{ acquired: number }>>("SELECT GET_LOCK(?, 15) AS acquired", ["quzijie-question-bank-release"]);
      if (Number(result[0]?.acquired || 0) !== 1) throw new AppError("另一个题库发布正在执行", "RELEASE_LOCKED", 409);
      return await callback();
    } finally {
      try { await connection.query("SELECT RELEASE_LOCK(?)", ["quzijie-question-bank-release"]); } catch {}
      await connection.end();
    }
  }

  private versionSnapshot(question: {
    id: string;
    externalCode: string | null;
    contentHash: string | null;
    subjectId: string;
    chapterId: string;
    status: string;
    currentVersion: {
      id: string;
      version: number;
      type: string;
      stem: string;
      code: string | null;
      explanation: string;
      difficulty: number;
      tags: Prisma.JsonValue;
      images: Prisma.JsonValue;
      examScopes: Prisma.JsonValue;
      correctOptionIds: Prisma.JsonValue;
      acceptedAnswers: Prisma.JsonValue;
      answerConfig: Prisma.JsonValue;
      referenceAnswer: string | null;
      options: Array<{ optionId: string; label: string; text: string; position: number }>;
    } | null;
  }) {
    if (!question.currentVersion) return null;
    const contentHash = question.contentHash || questionContentHash(normalizeDraftQuestion({
      externalCode: question.externalCode,
      subjectId: question.subjectId,
      chapterId: question.chapterId,
      type: question.currentVersion.type as DraftQuestionInput["type"],
      stem: question.currentVersion.stem,
      code: question.currentVersion.code,
      explanation: question.currentVersion.explanation,
      difficulty: question.currentVersion.difficulty,
      tags: jsonArray<string>(question.currentVersion.tags),
      images: jsonArray<{ src: string; alt: string; caption?: string }>(question.currentVersion.images),
      examScopes: jsonArray<string>(question.currentVersion.examScopes),
      correctOptionIds: jsonArray<string>(question.currentVersion.correctOptionIds),
      acceptedAnswers: jsonArray<string[]>(question.currentVersion.acceptedAnswers),
      answerConfig: question.currentVersion.answerConfig as Record<string, boolean>,
      referenceAnswer: question.currentVersion.referenceAnswer,
      options: question.currentVersion.options.map((option) => ({ id: option.optionId, label: option.label, text: option.text }))
    }));
    return {
      id: question.id,
      externalCode: question.externalCode,
      contentHash,
      subjectId: question.subjectId,
      chapterId: question.chapterId,
      status: question.status,
      versionId: question.currentVersion.id,
      version: question.currentVersion.version,
      type: question.currentVersion.type,
      stem: question.currentVersion.stem,
      code: question.currentVersion.code,
      explanation: question.currentVersion.explanation,
      difficulty: question.currentVersion.difficulty,
      tags: question.currentVersion.tags,
      images: question.currentVersion.images,
      examScopes: question.currentVersion.examScopes,
      correctOptionIds: question.currentVersion.correctOptionIds,
      acceptedAnswers: question.currentVersion.acceptedAnswers,
      answerConfig: question.currentVersion.answerConfig,
      referenceAnswer: question.currentVersion.referenceAnswer,
      options: question.currentVersion.options.map((option) => ({ id: option.optionId, label: option.label, text: option.text, position: option.position }))
    };
  }

  private draftSnapshot(item: PreparedVersion) {
    const draft = item.draft;
    return {
      id: draft.questionId,
      externalCode: draft.externalCode,
      contentHash: draft.contentHash,
      subjectId: draft.subjectId,
      chapterId: draft.chapterId,
      status: "ACTIVE",
      versionId: item.versionId,
      version: item.version,
      type: draft.type,
      stem: draft.stem,
      code: draft.code,
      explanation: draft.explanation,
      difficulty: draft.difficulty,
      tags: draft.tags,
      images: draft.images,
      examScopes: draft.examScopes,
      correctOptionIds: draft.correctOptionIds,
      acceptedAnswers: draft.acceptedAnswers,
      answerConfig: draft.answerConfig,
      referenceAnswer: draft.referenceAnswer,
      options: jsonArray<{ id: string; label: string; text: string }>(draft.options).map((option, position) => ({ ...option, position }))
    };
  }

  private async buildSnapshot(
    releaseId: string,
    prepared: PreparedVersion[] = [],
    candidates: ImportCatalogCandidates = { batchIds: [], batches: [], subjects: [], chapters: [] },
    catalogPayload?: CatalogDraftPayload
  ) {
    const candidateSubjectIds = candidates.subjects.map((subject) => subject.id);
    const candidateChapterIds = candidates.chapters.map((chapter) => chapter.id);
    const preparedQuestionIds = prepared.map((item) => item.draft.questionId);
    return this.prisma.$transaction(async (tx) => {
      const normalizedCatalog = catalogPayload ? normalizeCatalogDraftPayload(catalogPayload) : null;
      const [storedModules, storedSubjects, storedChapters] = normalizedCatalog ? [
        normalizedCatalog.modules.map((module) => ({ ...module, createdAt: new Date(0), updatedAt: new Date(0) })),
        normalizedCatalog.subjects.map((subject) => ({ ...subject, createdAt: new Date(0), updatedAt: new Date(0) })),
        normalizedCatalog.chapters.map((chapter) => ({ ...chapter, createdAt: new Date(0), updatedAt: new Date(0) }))
      ] : await Promise.all([
        tx.catalogModule.findMany({
          where: candidateSubjectIds.length ? { OR: [{ active: true }, { id: { in: candidateSubjectIds } }] } : { active: true },
          orderBy: { order: "asc" },
          include: { subjects: { orderBy: { order: "asc" } } }
        }),
        tx.subject.findMany({
          where: candidateSubjectIds.length ? { OR: [{ active: true }, { id: { in: candidateSubjectIds } }] } : { active: true },
          orderBy: { order: "asc" }
        }),
        tx.chapter.findMany({
          where: candidateChapterIds.length ? { OR: [{ active: true }, { id: { in: candidateChapterIds } }] } : { active: true },
          orderBy: [{ subjectId: "asc" }, { order: "asc" }]
        })
      ]);
      const effectiveSubjects = [...storedSubjects];
      let nextSubjectOrder = effectiveSubjects.reduce((maximum, subject) => Math.max(maximum, subject.order), 0) + 1;
      for (const candidate of candidates.subjects) {
        if (effectiveSubjects.some((subject) => subject.id === candidate.id)) continue;
        effectiveSubjects.push({
          ...candidate,
          order: nextSubjectOrder++,
          iconKey: null,
          qualityPolicy: candidate.qualityPolicy as unknown as Prisma.JsonValue,
          active: false,
          createdAt: new Date(0),
          updatedAt: new Date(0)
        });
      }
      const effectiveChapters = [...storedChapters];
      const nextChapterOrder = new Map<string, number>();
      for (const candidate of candidates.chapters) {
        if (effectiveChapters.some((chapter) => chapter.id === candidate.id)) continue;
        if (!nextChapterOrder.has(candidate.subjectId)) {
          nextChapterOrder.set(candidate.subjectId, effectiveChapters.filter((chapter) => chapter.subjectId === candidate.subjectId).reduce((maximum, chapter) => Math.max(maximum, chapter.order), 0) + 1);
        }
        const order = nextChapterOrder.get(candidate.subjectId)!;
        nextChapterOrder.set(candidate.subjectId, order + 1);
        effectiveChapters.push({ ...candidate, order, active: false, createdAt: new Date(0), updatedAt: new Date(0) });
      }
      const subjectCandidates = new Map(candidates.subjects.map((subject) => [subject.id, subject]));
      const chapterCandidates = new Map(candidates.chapters.map((chapter) => [chapter.id, chapter]));
      const storedSubjectById = new Map(effectiveSubjects.map((subject) => [subject.id, subject]));
      const subjects = effectiveSubjects
        .map((subject) => {
          const candidate = subjectCandidates.get(subject.id);
          return candidate ? { ...subject, ...candidate, active: true } : subject;
        })
        .filter((subject) => subject.active)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      const publishedSubjectIds = new Set(subjects.map((subject) => subject.id));
      const chapters = effectiveChapters
        .map((chapter) => {
          const candidate = chapterCandidates.get(chapter.id);
          return candidate ? { ...chapter, ...candidate, active: true } : chapter;
        })
        .filter((chapter) => chapter.active && publishedSubjectIds.has(chapter.subjectId))
        .sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.order - right.order || left.id.localeCompare(right.id));

      const moduleIds = new Set(storedModules.map((module) => module.id));
      const modules = storedModules.map((module) => {
        const candidate = subjectCandidates.get(module.id);
        const activateCandidateModule = Boolean(candidate && !storedSubjectById.get(module.id)?.active);
        const links = module.subjects
          .map((link) => ({ subjectId: link.subjectId, order: link.order }))
          .filter((link) => publishedSubjectIds.has(link.subjectId));
        if (activateCandidateModule && !links.some((link) => link.subjectId === module.id)) links.push({ subjectId: module.id, order: 0 });
        return {
          ...module,
          ...(activateCandidateModule ? {
            name: candidate!.name,
            subtitle: candidate!.description || "专项练习",
            color: candidate!.color,
            type: "SUBJECT" as const,
            active: true
          } : {}),
          subjects: links.sort((left, right) => left.order - right.order || left.subjectId.localeCompare(right.subjectId))
        };
      }).filter((module) => module.active);
      let nextModuleOrder = storedModules.reduce((maximum, module) => Math.max(maximum, module.order), 0) + 1;
      for (const candidate of candidates.subjects) {
        if (moduleIds.has(candidate.id) || storedSubjectById.get(candidate.id)?.active) continue;
        modules.push({
          id: candidate.id,
          name: candidate.name,
          subtitle: candidate.description || "专项练习",
          color: candidate.color,
          type: "SUBJECT",
          order: nextModuleOrder++,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          subjects: [{ subjectId: candidate.id, order: 0 }]
        });
      }
      modules.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

      // A release snapshot still necessarily contains all public questions, but
      // pages keep Prisma result objects bounded at 1,000 rows. Prepared drafts
      // are excluded from the database scan and appended once, avoiding a second
      // 100k-entry map just to replace them.
      const questions: ReleaseSnapshotQuestion[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await tx.question.findMany({
          where: {
            status: "ACTIVE",
            currentVersionId: { not: null },
            ...(preparedQuestionIds.length ? { id: { notIn: preparedQuestionIds } } : {})
          },
          orderBy: { id: "asc" },
          take: 1_000,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: { currentVersion: { include: { options: { orderBy: { position: "asc" } } } } }
        });
        for (const question of page) {
          const snapshot = this.versionSnapshot(question);
          if (snapshot) questions.push(snapshot);
        }
        if (page.length < 1_000) break;
        cursor = page[page.length - 1]!.id;
      }
      for (const item of prepared) {
        if (item.draft.action !== "DISABLE") questions.push(this.draftSnapshot(item));
      }
      questions.sort((left, right) => left.id.localeCompare(right.id));

      return {
        schemaVersion: 1,
        releaseId,
        generatedAt: new Date().toISOString(),
        modules,
        subjects,
        chapters,
        questions
      } as ReleaseSnapshot;
    }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private validateReleaseSnapshot(snapshot: ReleaseSnapshot): ReleaseQualityReport {
    if (!snapshot.questions.length) throw new AppError("候选题库不能为空", "RELEASE_EMPTY_CATALOG", 409);
    if (snapshot.questions.length > 100_000) throw new AppError("题库容量不能超过 10 万题", "RELEASE_CAPACITY_EXCEEDED", 409);
    const subjects = new Set(snapshot.subjects.map((subject) => subject.id));
    for (const module of snapshot.modules) {
      for (const link of module.subjects) {
        if (!subjects.has(link.subjectId)) {
          throw new AppError(`目录模块 ${module.id} 引用了未启用学科 ${link.subjectId}`, "RELEASE_MODULE_SUBJECT_INVALID", 409);
        }
      }
    }
    for (const chapter of snapshot.chapters) {
      if (!subjects.has(chapter.subjectId)) {
        throw new AppError(`章节 ${chapter.id} 引用了未启用学科 ${chapter.subjectId}`, "RELEASE_CHAPTER_SUBJECT_INVALID", 409);
      }
    }
    const chapters = new Map(snapshot.chapters.map((chapter) => [chapter.id, chapter.subjectId]));
    const ids = new Set<string>();
    const externalCodes = new Set<string>();
    for (const question of snapshot.questions) {
      if (ids.has(question.id)) throw new AppError(`候选题库题目 ID 重复：${question.id}`, "RELEASE_DUPLICATE_QUESTION", 409);
      ids.add(question.id);
      if (question.externalCode) {
        if (externalCodes.has(question.externalCode)) throw new AppError(`候选题库外部题号重复：${question.externalCode}`, "RELEASE_DUPLICATE_EXTERNAL_CODE", 409);
        externalCodes.add(question.externalCode);
      }
      if (!subjects.has(question.subjectId)) throw new AppError(`题目 ${question.id} 引用了未启用学科`, "RELEASE_SUBJECT_INVALID", 409);
      if (chapters.get(question.chapterId) !== question.subjectId) throw new AppError(`题目 ${question.id} 引用了无效章节`, "RELEASE_CHAPTER_INVALID", 409);
      if (!question.versionId || question.status !== "ACTIVE") throw new AppError(`题目 ${question.id} 缺少可发布版本`, "RELEASE_VERSION_INVALID", 409);
    }
    const requirements: Record<string, number> = { ds: 12, co: 12, os: 9, network: 7 };
    for (const [subjectId, required] of Object.entries(requirements)) {
      const available = snapshot.questions.filter((question) => (
        question.subjectId === subjectId
        && question.type === "SINGLE"
        && jsonArray<string>(question.examScopes).includes("408")
      )).length;
      if (available < required) {
        throw new AppError(`408 ${subjectId} 单选题池至少需要 ${required} 题，当前为 ${available} 题`, "RELEASE_408_POOL_INSUFFICIENT", 409);
      }
    }
    try {
      return evaluateSubjectQualityPolicies(snapshot.subjects, snapshot.questions);
    } catch (error) {
      if (error instanceof QualityPolicyValidationError) {
        throw new AppError(error.message, "RELEASE_QUALITY_POLICY_INVALID", 409);
      }
      throw error;
    }
  }

  private async verifySnapshotMedia(snapshot: ReleaseSnapshot): Promise<NonNullable<ReleaseSnapshot["media"]>> {
    const sources = Array.from(new Set(snapshot.questions.flatMap((question) => (
      jsonArray<{ src?: string }>(question.images).map((image) => String(image.src || "").trim()).filter(Boolean)
    )))).sort();
    if (!sources.length) return [];
    const assets = await this.prisma.mediaAsset.findMany({
      where: { status: "READY", publicUrl: { in: sources } }
    });
    const byUrl = new Map(assets.map((asset) => [asset.publicUrl, asset]));
    const verified: NonNullable<ReleaseSnapshot["media"]> = [];
    for (const src of sources) {
      const asset = byUrl.get(src);
      if (!asset?.sha256 || !asset.publicUrl) {
        throw new AppError(`题图 ${src} 未完成上传或未通过校验`, "RELEASE_MEDIA_INVALID", 409);
      }
      const body = await this.storage.get(asset.objectKey);
      const sha256 = createHash("sha256").update(body).digest("hex");
      if (body.length !== asset.size || sha256 !== asset.sha256) {
        throw new AppError(`题图 ${src} 的对象内容与登记哈希不一致`, "RELEASE_MEDIA_HASH_MISMATCH", 409);
      }
      verified.push({
        id: asset.id,
        src,
        objectKey: asset.objectKey,
        sha256,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height
      });
    }
    return verified;
  }

  private async persistSnapshot(releaseId: string, snapshot: ReleaseSnapshot, releaseQuestionMemory = true) {
    snapshot.media = await this.verifySnapshotMedia(snapshot);
    const qualityReport = this.validateReleaseSnapshot(snapshot);
    const questionCount = snapshot.questions.length;
    const catalogHash = catalogPayloadHash(snapshot);
    const publicCatalog = buildPublicCatalog(snapshot, "pending");
    let serialized = JSON.stringify(snapshot);
    const body = Buffer.from(`${serialized}\n`, "utf8");
    const hash = createHash("sha256").update(serialized).digest("hex");
    serialized = "";
    if (body.length > this.config.questionBankMaxSnapshotBytes) {
      throw new AppError(
        `题库快照大小 ${body.length} 超过配置上限 ${this.config.questionBankMaxSnapshotBytes}`,
        "RELEASE_SNAPSHOT_TOO_LARGE",
        409
      );
    }
    if (releaseQuestionMemory) snapshot.questions.length = 0;
    publicCatalog.version = hash;
    const objectKey = `question-bank/releases/${releaseId}/${hash}.json`;
    await this.storage.put(objectKey, body, "application/json; charset=utf-8");
    const stored = await this.storage.head(objectKey);
    if (!stored || stored.size !== body.length) throw new Error("题库快照上传后校验失败");
    const storedChecksum = await this.storage.checksum(objectKey);
    const uploadedBodyHash = createHash("sha256").update(body).digest("hex");
    if (storedChecksum.size !== body.length || storedChecksum.sha256 !== uploadedBodyHash) {
      throw new Error("题库快照 SHA-256 校验失败");
    }
    return {
      objectKey,
      hash,
      catalogHash,
      size: body.length,
      questionCount,
      publicCatalog,
      qualityWarnings: qualityReport.warnings,
      qualitySummary: {
        configuredSubjectCount: qualityReport.configuredSubjectCount,
        warningCount: qualityReport.warningCount,
        subjects: qualityReport.subjects
      }
    };
  }

  private parseVerifiedSnapshot(body: Buffer, expectedHash: string, mismatchCode: string): ReleaseSnapshot {
    if (body.length < 2 || body[body.length - 1] !== 0x0a) {
      throw new AppError("题库快照缺少规范结束标记", mismatchCode, 409);
    }
    const payload = body.subarray(0, body.length - 1);
    const actualHash = createHash("sha256").update(payload).digest("hex");
    if (actualHash !== expectedHash) {
      throw new AppError("题库快照的原始字节或 SHA-256 校验失败", mismatchCode, 409);
    }
    let snapshot: ReleaseSnapshot;
    try {
      snapshot = JSON.parse(payload.toString("utf8")) as ReleaseSnapshot;
    } catch {
      throw new AppError("题库快照不是有效 JSON", mismatchCode, 409);
    }
    return snapshot;
  }

  private async inspectPublishedRelease(releaseId: string): Promise<ReleaseVerificationReport> {
    const startedAt = Date.now();
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
    let missingVersionCount = 0;
    let objectUploadFailureCount = 0;
    let validationErrorCount = 0;
    const release = await this.prisma.questionRelease.findUnique({ where: { id: releaseId } });
    const state = await this.prisma.catalogState.findUnique({ where: { id: 1 } });
    check("active_pointer", state?.activeReleaseId === releaseId, state?.activeReleaseId || "missing");
    check("release_published", release?.status === "PUBLISHED", release?.status || "missing");
    if (!release?.snapshotKey || !release.snapshotHash) {
      check("snapshot_metadata", false, "snapshot key/hash missing");
      return { ok: false, releaseId, checkedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, checks, validationErrorCount, missingVersionCount, objectUploadFailureCount };
    }

    let body: Buffer;
    try {
      body = await this.storage.get(release.snapshotKey);
      check("snapshot_object", release.snapshotSize === null || body.length === release.snapshotSize, `bytes=${body.length}`);
    } catch (error) {
      objectUploadFailureCount += 1;
      check("snapshot_object", false, error instanceof Error ? error.message : String(error));
      return { ok: false, releaseId, checkedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, checks, validationErrorCount, missingVersionCount, objectUploadFailureCount };
    }

    let snapshot: ReleaseSnapshot;
    try {
      snapshot = this.parseVerifiedSnapshot(body, release.snapshotHash, "RELEASE_VERIFICATION_HASH_MISMATCH");
      check("snapshot_hash", true);
      this.validateReleaseSnapshot(snapshot);
      check("snapshot_structure", true);
    } catch (error) {
      check("snapshot_hash_or_structure", false, error instanceof Error ? error.message : String(error));
      return { ok: false, releaseId, checkedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, checks, validationErrorCount, missingVersionCount, objectUploadFailureCount };
    }

    check("snapshot_release_id", snapshot.releaseId === releaseId, snapshot.releaseId);
    check("question_count", snapshot.questions.length === release.questionCount, `${snapshot.questions.length}/${release.questionCount}`);
    const projection = release.publicCatalog as { version?: unknown; modules?: unknown; chapters?: unknown } | null;
    const expectedProjection = buildPublicCatalog(snapshot, release.snapshotHash);
    check("public_catalog", stableStringify(projection) === stableStringify(expectedProjection));

    for (const question of snapshot.questions) {
      const normalized = normalizeDraftQuestion({
        externalCode: question.externalCode,
        subjectId: question.subjectId,
        chapterId: question.chapterId,
        type: question.type as DraftQuestionInput["type"],
        stem: question.stem,
        code: question.code,
        explanation: question.explanation,
        difficulty: question.difficulty,
        tags: jsonArray<string>(question.tags),
        images: jsonArray<{ src: string; alt: string; caption?: string }>(question.images),
        examScopes: jsonArray<string>(question.examScopes),
        correctOptionIds: jsonArray<string>(question.correctOptionIds),
        acceptedAnswers: jsonArray<string[]>(question.acceptedAnswers),
        answerConfig: question.answerConfig as Record<string, boolean>,
        referenceAnswer: question.referenceAnswer,
        options: question.options.map((option) => ({ id: option.id, label: option.label, text: option.text }))
      });
      validationErrorCount += validateDraftQuestion(normalized).errors.length;
    }
    check("question_content", validationErrorCount === 0, `errors=${validationErrorCount}`);

    for (let offset = 0; offset < snapshot.questions.length; offset += 500) {
      const group = snapshot.questions.slice(offset, offset + 500);
      const rows = await this.prisma.question.findMany({
        where: { id: { in: group.map((question) => question.id) } },
        select: { id: true, currentVersionId: true, status: true }
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const question of group) {
        const row = byId.get(question.id);
        if (!row || row.status !== "ACTIVE" || row.currentVersionId !== question.versionId) missingVersionCount += 1;
      }
    }
    const activeQuestionCount = await this.prisma.question.count({ where: { status: "ACTIVE" } });
    check("active_question_versions", missingVersionCount === 0, `missing=${missingVersionCount}`);
    check("active_question_count", activeQuestionCount === snapshot.questions.length, `${activeQuestionCount}/${snapshot.questions.length}`);

    for (const media of snapshot.media || []) {
      try {
        const stored = await this.storage.checksum(media.objectKey);
        if (stored.size !== media.size || stored.sha256 !== media.sha256) objectUploadFailureCount += 1;
      } catch {
        objectUploadFailureCount += 1;
      }
    }
    check("media_objects", objectUploadFailureCount === 0, `failed=${objectUploadFailureCount}`);
    return {
      ok: checks.every((item) => item.ok),
      releaseId,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
      validationErrorCount,
      missingVersionCount,
      objectUploadFailureCount
    };
  }

  private async verifyPublishedRelease(releaseId: string, adminUserId?: string, requestId?: string) {
    const verificationStartedAt = new Date();
    await this.prisma.questionRelease.update({
      where: { id: releaseId },
      data: { verificationStatus: "PENDING", verificationStartedAt, verificationCompletedAt: null }
    });
    let report: ReleaseVerificationReport;
    try {
      report = await this.inspectPublishedRelease(releaseId);
    } catch (error) {
      report = {
        ok: false,
        releaseId,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - verificationStartedAt.getTime(),
        checks: [{ name: "verification_internal", ok: false, detail: error instanceof Error ? error.message : String(error) }],
        validationErrorCount: 1,
        missingVersionCount: 0,
        objectUploadFailureCount: 0
      };
    }
    const verificationCompletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.questionRelease.update({
        where: { id: releaseId },
        data: {
          verificationStatus: report.ok ? "PASSED" : "FAILED",
          verificationReport: inputJson(report),
          verificationCompletedAt,
          verificationDurationMs: report.durationMs,
          validationErrorCount: report.validationErrorCount + report.checks.filter((item) => !item.ok).length,
          missingVersionCount: report.missingVersionCount,
          objectUploadFailureCount: report.objectUploadFailureCount
        }
      });
      const state = await tx.catalogState.findUnique({ where: { id: 1 } });
      if (state?.activeReleaseId === releaseId) {
        await tx.catalogState.update({
          where: { id: 1 },
          data: report.ok
            ? { publishFrozen: false, freezeReason: null, frozenAt: null, frozenReleaseId: null }
            : { publishFrozen: true, freezeReason: "RELEASE_POST_PUBLISH_VERIFICATION_FAILED", frozenAt: verificationCompletedAt, frozenReleaseId: releaseId }
        });
      }
      await tx.adminAuditLog.create({
        data: this.auditData({
          adminUserId,
          action: report.ok ? "release.verify.passed" : "release.verify.failed",
          entityType: "question_release",
          entityId: releaseId,
          afterState: report,
          requestId
        })
      });
    });
    const log = { event: "question_bank_release_verification", releaseId, ok: report.ok, durationMs: report.durationMs, validationErrorCount: report.validationErrorCount + report.checks.filter((item) => !item.ok).length, missingVersionCount: report.missingVersionCount, objectUploadFailureCount: report.objectUploadFailureCount };
    if (report.ok) console.info(JSON.stringify(log));
    else console.error(JSON.stringify(log));
    if (!report.ok) throw new AppError("发布后自检失败，已冻结后续发布，请回滚或由所有者重试验证", "RELEASE_VERIFICATION_FAILED", 503, report);
    return this.prisma.questionRelease.findUniqueOrThrow({ where: { id: releaseId }, include: { _count: { select: { items: true } } } });
  }

  async retryReleaseVerification(adminUserId: string, releaseId: string, requestId?: string) {
    return this.withReleaseLock(async () => {
      const state = await this.prisma.catalogState.findUnique({ where: { id: 1 } });
      if (state?.activeReleaseId !== releaseId) throw new AppError("只能重试当前活动发布的自检", "RELEASE_NOT_ACTIVE", 409);
      return this.verifyPublishedRelease(releaseId, adminUserId, requestId);
    });
  }

  private async ensureActiveCatalogProjection(): Promise<boolean> {
    const state = await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } });
    if (!state) return false;
    const release = state.activeRelease;
    if (!release) throw new AppError("活动题库指针缺少发布记录", "CATALOG_RELEASE_INVALID", 503);
    const projection = release.publicCatalog as { version?: unknown; modules?: unknown; chapters?: unknown } | null;
    if (
      projection?.version === release.snapshotHash
      && Array.isArray(projection.modules)
      && Array.isArray(projection.chapters)
      && release.qualityWarnings !== null
      && release.qualitySummary !== null
    ) return true;
    if (!release.snapshotKey || !release.snapshotHash || release.status !== "PUBLISHED") {
      throw new AppError("活动题库发布缺少可恢复的目录快照", "CATALOG_RELEASE_INVALID", 503);
    }
    const body = await this.storage.get(release.snapshotKey);
    let snapshot: ReleaseSnapshot;
    try {
      snapshot = this.parseVerifiedSnapshot(body, release.snapshotHash, "CATALOG_SNAPSHOT_HASH_MISMATCH");
    } catch (error) {
      if (error instanceof AppError) throw new AppError(error.message, error.code, 503, error.details);
      throw error;
    }
    const qualityReport = this.validateReleaseSnapshot(snapshot);
    await this.prisma.questionRelease.update({
      where: { id: release.id },
      data: {
        publicCatalog: inputJson(buildPublicCatalog(snapshot, release.snapshotHash)),
        qualityWarnings: inputJson(qualityReport.warnings),
        qualitySummary: inputJson({
          configuredSubjectCount: qualityReport.configuredSubjectCount,
          warningCount: qualityReport.warningCount,
          subjects: qualityReport.subjects
        })
      }
    });
    return true;
  }

  async ensureBaselineRelease(): Promise<void> {
    if (await this.ensureActiveCatalogProjection()) {
      const state = await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } });
      if (state?.activeRelease && state.activeRelease.verificationStatus !== "PASSED") await this.verifyPublishedRelease(state.activeRelease.id);
      return;
    }
    await this.withReleaseLock(async () => {
      if (await this.ensureActiveCatalogProjection()) {
        const state = await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } });
        if (state?.activeRelease && state.activeRelease.verificationStatus !== "PASSED") await this.verifyPublishedRelease(state.activeRelease.id);
        return;
      }
      const release = await this.prisma.questionRelease.create({ data: { name: "现有题库基线", kind: "BASELINE", status: "PREPARING" } });
      try {
        const snapshot = await this.buildSnapshot(release.id);
        const stored = await this.persistSnapshot(release.id, snapshot);
        await this.prisma.$transaction([
          this.prisma.questionRelease.update({
            where: { id: release.id },
            data: {
              status: "PUBLISHED",
              snapshotKey: stored.objectKey,
              snapshotHash: stored.hash,
              catalogHash: stored.catalogHash,
              snapshotSize: stored.size,
              publicCatalog: inputJson(stored.publicCatalog),
              qualityWarnings: inputJson(stored.qualityWarnings),
              qualitySummary: inputJson(stored.qualitySummary),
              questionCount: stored.questionCount,
              publishedAt: new Date()
            }
          }),
          this.prisma.catalogState.create({ data: { id: 1, activeReleaseId: release.id } })
        ]);
        await this.verifyPublishedRelease(release.id);
      } catch (error) {
        await this.prisma.questionRelease.updateMany({
          where: { id: release.id, status: "PREPARING" },
          data: { status: "FAILED", failureReason: String(error).slice(0, 4000) }
        });
        throw error;
      }
    });
  }

  async publish(adminUserId: string, name: string, draftIds: string[], catalogDraftId?: string, importBatchIds: string[] = [], requestId?: string) {
    return this.withReleaseLock(async () => {
      const gate = await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: { select: { verificationStatus: true } } } });
      assertReleasePublishingAllowed(gate);
      const explicitImportBatchIds = Array.from(new Set(importBatchIds.map((id) => String(id).trim()).filter(Boolean)));
      const importedDraftRows = explicitImportBatchIds.length ? await this.prisma.questionImportRow.findMany({
        where: { batchId: { in: explicitImportBatchIds }, entityType: "question" },
        select: { draftId: true }
      }) : [];
      const releaseDraftIds = Array.from(new Set([
        ...draftIds.map((id) => String(id).trim()).filter(Boolean),
        ...importedDraftRows.map((row) => row.draftId).filter((id): id is string => Boolean(id))
      ]));
      const drafts = await this.prisma.questionDraft.findMany({ where: { id: { in: releaseDraftIds } } });
      if (drafts.length !== releaseDraftIds.length) throw new AppError("部分草稿不存在", "DRAFT_NOT_FOUND", 404);
      if (drafts.some((draft) => draft.status !== "APPROVED")) throw new AppError("只有复核通过的草稿可以发布", "DRAFT_NOT_APPROVED", 409);
      if (new Set(drafts.map((draft) => draft.questionId)).size !== drafts.length) throw new AppError("同一发布批次不能包含同一题目的多个草稿", "RELEASE_DUPLICATE_QUESTION", 409);
      const importCandidates = await this.resolveImportCatalogCandidates(releaseDraftIds, explicitImportBatchIds);
      const activeBase = await this.activeCatalogBase();
      const catalogDraft = catalogDraftId ? await this.prisma.catalogDraft.findUnique({
        where: { id: catalogDraftId },
        include: { reviews: { where: { decision: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } }
      }) : null;
      if (catalogDraftId && !catalogDraft) throw new AppError("目录草稿不存在", "CATALOG_DRAFT_NOT_FOUND", 404);
      if (catalogDraft && catalogDraft.status !== "APPROVED") throw new AppError("只有复核通过的目录草稿可以发布", "CATALOG_DRAFT_NOT_APPROVED", 409);
      const catalogPayload = catalogDraft ? normalizeCatalogDraftPayload(catalogDraft.payload) : activeBase.payload;
      if (catalogDraft) {
        const contentHash = catalogPayloadHash(catalogPayload);
        if (contentHash !== catalogDraft.contentHash || catalogDraft.reviews[0]?.contentHash !== contentHash) {
          throw new AppError("目录草稿冻结内容或复核哈希不一致", "CATALOG_DRAFT_HASH_MISMATCH", 409);
        }
        if (catalogDraft.baseCatalogHash !== activeBase.catalogHash) {
          throw new AppError("线上目录已发生变化，请重新创建并复核目录草稿", "CATALOG_DRAFT_STALE", 409);
        }
      }
      if (!releaseDraftIds.length && !catalogDraft && !importCandidates.batchIds.length) throw new AppError("没有可发布的题目、目录或导入批次变更", "RELEASE_NO_CHANGES", 409);
      const previous = await this.prisma.catalogState.findUnique({
        where: { id: 1 },
        include: { activeRelease: { select: { publicCatalog: true, snapshotKey: true, snapshotHash: true } } }
      });
      const activeCatalog = previous?.activeRelease?.publicCatalog;
      if (!releaseDraftIds.length && !catalogDraft && !importCandidates.batchIds.length && activeCatalog) {
        const candidate = await this.buildSnapshot("catalog-preview");
        this.validateReleaseSnapshot(candidate);
        const candidateCatalog = buildPublicCatalog(candidate, "catalog-preview");
        const active = activeCatalog as { modules?: unknown; chapters?: unknown };
        const publicCatalogUnchanged = stableStringify({ modules: candidateCatalog.modules, chapters: candidateCatalog.chapters })
          === stableStringify({ modules: active.modules, chapters: active.chapters });
        let snapshotDirectoryUnchanged = false;
        if (previous.activeRelease?.snapshotKey && previous.activeRelease.snapshotHash) {
          const activeSnapshot = this.parseVerifiedSnapshot(
            await this.storage.get(previous.activeRelease.snapshotKey),
            previous.activeRelease.snapshotHash,
            "CATALOG_SNAPSHOT_HASH_MISMATCH"
          );
          snapshotDirectoryUnchanged = stableStringify({
            modules: candidate.modules,
            subjects: candidate.subjects,
            chapters: candidate.chapters
          }) === stableStringify({
            modules: activeSnapshot.modules,
            subjects: activeSnapshot.subjects,
            chapters: activeSnapshot.chapters
          });
        }
        if (publicCatalogUnchanged && snapshotDirectoryUnchanged) {
          throw new AppError("目录配置没有待发布变更", "RELEASE_NO_CHANGES", 409);
        }
      }
      const release = await this.prisma.questionRelease.create({
        data: { name: name.trim().slice(0, 128) || `题库发布 ${new Date().toISOString()}`, createdById: adminUserId, previousReleaseId: previous?.activeReleaseId || null }
      });
      try {
        const prepared: PreparedVersion[] = [];
        for (const draft of drafts) {
          const latest = await this.prisma.questionVersion.aggregate({ where: { questionId: draft.questionId }, _max: { version: true } });
          prepared.push({ draft: draft as unknown as PreparedDraft, versionId: randomUUID(), version: (latest._max.version || 0) + 1 });
        }
        const snapshot = await this.buildSnapshot(release.id, prepared, importCandidates, catalogPayload);
        const releasedCatalog = normalizeCatalogDraftPayload(snapshot);
        const stored = await this.persistSnapshot(release.id, snapshot);
        const published = await this.prisma.$transaction(async (tx) => {
          const fresh = await tx.questionDraft.findMany({ where: { id: { in: releaseDraftIds }, status: "APPROVED" } });
          if (fresh.length !== drafts.length || fresh.some((item) => item.contentHash !== drafts.find((draft) => draft.id === item.id)?.contentHash)) {
            throw new AppError("草稿在发布准备期间发生变化", "RELEASE_CONTENT_CHANGED", 409);
          }
          if (importCandidates.batchIds.length) {
            const freshBatches = await tx.questionImportBatch.findMany({
              where: { id: { in: importCandidates.batchIds }, status: "APPROVED" },
              include: {
                reviews: { where: { decision: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 },
                rows: { include: { draft: { select: { contentHash: true } } }, orderBy: [{ entityType: "asc" }, { rowNumber: "asc" }] }
              }
            });
            if (freshBatches.length !== importCandidates.batchIds.length) throw new AppError("导入批次在发布准备期间发生变化", "IMPORT_BATCH_CHANGED", 409);
            for (const batch of freshBatches) {
              const expected = importCandidates.batches.find((item) => item.id === batch.id);
              const frozenHash = importBatchContentHash(batch.sourceHash, batch.rows);
              if (!expected || batch.revision !== expected.revision || batch.contentHash !== expected.contentHash
                || frozenHash !== expected.contentHash || batch.reviews[0]?.contentHash !== expected.contentHash) {
                throw new AppError(`导入批次 ${batch.id} 在发布准备期间发生变化`, "IMPORT_BATCH_HASH_MISMATCH", 409);
              }
            }
          }
          const currentState = await tx.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } });
          if (currentState?.activeReleaseId !== activeBase.releaseId) {
            throw new AppError("活动题库在发布准备期间发生变化", "RELEASE_BASE_CHANGED", 409);
          }
          if (catalogDraft) {
            const freshCatalogDraft = await tx.catalogDraft.findUnique({
              where: { id: catalogDraft.id },
              include: { reviews: { where: { decision: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } }
            });
            if (!freshCatalogDraft || freshCatalogDraft.status !== "APPROVED" || freshCatalogDraft.contentHash !== catalogDraft.contentHash
              || freshCatalogDraft.baseCatalogHash !== activeBase.catalogHash || freshCatalogDraft.reviews[0]?.contentHash !== catalogDraft.contentHash) {
              throw new AppError("目录草稿在发布准备期间发生变化", "CATALOG_DRAFT_CONTENT_CHANGED", 409);
            }
          }
          await this.applyCatalogPayload(tx, releasedCatalog);
          for (const item of prepared) {
            const current = await tx.question.findUniqueOrThrow({ where: { id: item.draft.questionId } });
            if (current.currentVersionId !== item.draft.baseVersionId) {
              throw new AppError(`题目 ${current.id} 已发布更新版本，请重新创建修订`, "RELEASE_VERSION_CONFLICT", 409);
            }
            if (item.draft.action === "DISABLE") {
              await tx.question.update({ where: { id: current.id }, data: { status: "DISABLED" } });
              await tx.questionReleaseItem.create({
                data: { releaseId: release.id, draftId: item.draft.id, questionId: current.id, action: "DISABLE", previousVersionId: current.currentVersionId, beforeState: inputJson({ status: current.status }), afterState: inputJson({ status: "DISABLED" }) }
              });
            } else {
              const options = jsonArray<{ id: string; label: string; text: string }>(item.draft.options);
              const version = await tx.questionVersion.create({
                data: {
                  id: item.versionId,
                  questionId: item.draft.questionId,
                  version: item.version,
                  type: item.draft.type as never,
                  stem: item.draft.stem,
                  code: item.draft.code,
                  explanation: item.draft.explanation,
                  difficulty: item.draft.difficulty,
                  tags: inputJson(item.draft.tags),
                  images: inputJson(item.draft.images),
                  examScopes: inputJson(item.draft.examScopes),
                  correctOptionIds: inputJson(item.draft.correctOptionIds),
                  acceptedAnswers: inputJson(item.draft.acceptedAnswers),
                  answerConfig: inputJson(item.draft.answerConfig),
                  referenceAnswer: item.draft.referenceAnswer,
                  options: { create: options.map((option, position) => ({ optionId: option.id, label: option.label, text: option.text, position })) }
                }
              });
              await tx.question.update({
                where: { id: item.draft.questionId },
                data: { subjectId: item.draft.subjectId, chapterId: item.draft.chapterId, externalCode: item.draft.externalCode, contentHash: item.draft.contentHash, currentVersionId: version.id, status: "ACTIVE" }
              });
              await tx.questionReleaseItem.create({
                data: { releaseId: release.id, draftId: item.draft.id, questionId: item.draft.questionId, action: "UPSERT", previousVersionId: current.currentVersionId, publishedVersionId: version.id }
              });
            }
            await tx.questionDraft.update({ where: { id: item.draft.id }, data: { status: "PUBLISHED" } });
          }
          if (catalogDraft) {
            const claimedCatalog = await tx.catalogDraft.updateMany({
              where: { id: catalogDraft.id, status: "APPROVED", revision: catalogDraft.revision, contentHash: catalogDraft.contentHash },
              data: { status: "PUBLISHED", revision: { increment: 1 } }
            });
            if (claimedCatalog.count !== 1) throw new AppError("目录草稿发布状态冲突", "CATALOG_DRAFT_PUBLISH_CONFLICT", 409);
          }
          for (const batch of importCandidates.batches) {
            const claimedBatch = await tx.questionImportBatch.updateMany({
              where: { id: batch.id, status: "APPROVED", revision: batch.revision, contentHash: batch.contentHash, publishedReleaseId: null },
              data: { status: "PUBLISHED", publishedReleaseId: release.id, revision: { increment: 1 } }
            });
            if (claimedBatch.count !== 1) throw new AppError(`导入批次 ${batch.id} 发布状态冲突`, "IMPORT_BATCH_PUBLISH_CONFLICT", 409);
          }
          await tx.questionRelease.update({
            where: { id: release.id },
            data: {
              status: "PUBLISHED",
              publishedById: adminUserId,
              catalogDraftId: catalogDraft?.id || null,
              snapshotKey: stored.objectKey,
              snapshotHash: stored.hash,
              catalogHash: stored.catalogHash,
              snapshotSize: stored.size,
              publicCatalog: inputJson(stored.publicCatalog),
              qualityWarnings: inputJson(stored.qualityWarnings),
              qualitySummary: inputJson(stored.qualitySummary),
              questionCount: stored.questionCount,
              publishedAt: new Date()
            }
          });
          await tx.catalogState.upsert({ where: { id: 1 }, update: { activeReleaseId: release.id }, create: { id: 1, activeReleaseId: release.id } });
          await tx.adminAuditLog.create({
            data: this.auditData({
              adminUserId,
              action: "release.publish",
              entityType: "question_release",
              entityId: release.id,
              afterState: { draftIds: releaseDraftIds, catalogDraftId: catalogDraft?.id || null, importBatchIds: importCandidates.batchIds, snapshotHash: stored.hash, catalogHash: stored.catalogHash },
              requestId
            })
          });
          return tx.questionRelease.findUniqueOrThrow({ where: { id: release.id }, include: { _count: { select: { items: true } } } });
        }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return await this.verifyPublishedRelease(published.id, adminUserId, requestId);
      } catch (error) {
        await this.prisma.questionRelease.updateMany({
          where: { id: release.id, status: "PREPARING" },
          data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 4000) : String(error) }
        });
        throw error;
      }
    });
  }

  async listReleases(query: { page?: number; pageSize?: number; status?: string; kind?: string } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    const kind = query.kind ? String(query.kind).toUpperCase() : undefined;
    if (status && !["PREPARING", "PUBLISHED", "FAILED"].includes(status)) throw new AppError("发布状态筛选值无效", "INVALID_RELEASE_FILTER", 400);
    if (kind && !["NORMAL", "ROLLBACK", "BASELINE"].includes(kind)) throw new AppError("发布类型筛选值无效", "INVALID_RELEASE_FILTER", 400);
    const where: Prisma.QuestionReleaseWhereInput = {
      ...(status ? { status: status as never } : {}),
      ...(kind ? { kind: kind as never } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.questionRelease.count({ where }),
      this.prisma.questionRelease.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { displayName: true } }, publishedBy: { select: { displayName: true } }, _count: { select: { items: true } } }
      })
    ]);
    return { page, pageSize, total, items };
  }

  async rollback(adminUserId: string, targetReleaseId: string, requestId?: string) {
    return this.withReleaseLock(async () => {
      const target = await this.prisma.questionRelease.findFirst({ where: { id: targetReleaseId, status: "PUBLISHED" } });
      if (!target?.snapshotKey) throw new AppError("目标发布不存在或缺少快照", "RELEASE_NOT_ROLLBACKABLE", 409);
      if (!target.snapshotHash) throw new AppError("目标发布缺少快照哈希", "RELEASE_NOT_ROLLBACKABLE", 409);
      const snapshot = this.parseVerifiedSnapshot(await this.storage.get(target.snapshotKey), target.snapshotHash, "ROLLBACK_SNAPSHOT_HASH_MISMATCH");
      this.validateReleaseSnapshot(snapshot);
      const currentState = await this.prisma.catalogState.findUnique({ where: { id: 1 } });
      const release = await this.prisma.questionRelease.create({
        data: { name: `回滚到 ${target.name}`, kind: "ROLLBACK", createdById: adminUserId, previousReleaseId: currentState?.activeReleaseId || null }
      });
      try {
        const rollbackSnapshot = { ...snapshot, releaseId: release.id, generatedAt: new Date().toISOString(), rollbackOf: target.id } as ReleaseSnapshot;
        const stored = await this.persistSnapshot(release.id, rollbackSnapshot, false);
        const published = await this.prisma.$transaction(async (tx) => {
          const moduleIds = snapshot.modules.map((module) => module.id);
          const subjectIds = snapshot.subjects.map((subject) => subject.id);
          const chapterIds = snapshot.chapters.map((chapter) => chapter.id);
          await tx.catalogModule.updateMany({ data: { order: { increment: 100_000 }, active: false } });
          await tx.chapter.updateMany({ data: { order: { increment: 100_000 }, active: false } });
          await tx.subject.updateMany({ where: { id: { notIn: subjectIds } }, data: { active: false } });
          for (const subject of snapshot.subjects) {
            await tx.subject.upsert({
              where: { id: subject.id },
              update: {
                name: subject.name, shortName: subject.shortName, order: subject.order, color: subject.color,
                description: subject.description, iconKey: subject.iconKey,
                qualityPolicy: subject.qualityPolicy === null ? Prisma.DbNull : inputJson(subject.qualityPolicy),
                active: true
              },
              create: {
                id: subject.id, name: subject.name, shortName: subject.shortName, order: subject.order, color: subject.color,
                description: subject.description, iconKey: subject.iconKey,
                qualityPolicy: subject.qualityPolicy === null ? Prisma.DbNull : inputJson(subject.qualityPolicy),
                active: true
              }
            });
          }
          for (const chapter of snapshot.chapters) {
            await tx.chapter.upsert({
              where: { id: chapter.id },
              update: { subjectId: chapter.subjectId, name: chapter.name, order: chapter.order, description: chapter.description, active: true },
              create: { id: chapter.id, subjectId: chapter.subjectId, name: chapter.name, order: chapter.order, description: chapter.description, active: true }
            });
          }
          await tx.catalogModuleSubject.deleteMany({});
          for (const module of snapshot.modules) {
            await tx.catalogModule.upsert({
              where: { id: module.id },
              update: { name: module.name, subtitle: module.subtitle, color: module.color, type: module.type as never, order: module.order, active: true },
              create: { id: module.id, name: module.name, subtitle: module.subtitle, color: module.color, type: module.type as never, order: module.order, active: true }
            });
            if (module.subjects.length) {
              await tx.catalogModuleSubject.createMany({
                data: module.subjects.map((link) => ({ moduleId: module.id, subjectId: link.subjectId, order: link.order }))
              });
            }
          }
          await tx.catalogModule.updateMany({ where: { id: { notIn: moduleIds } }, data: { active: false } });
          await tx.chapter.updateMany({ where: { id: { notIn: chapterIds } }, data: { active: false } });
          const targetIds = new Set(snapshot.questions.map((question) => question.id));
          const active = await tx.question.findMany({ where: { status: "ACTIVE" } });
          for (const question of active.filter((item) => !targetIds.has(item.id))) {
            await tx.question.update({ where: { id: question.id }, data: { status: "DISABLED" } });
            await tx.questionReleaseItem.create({ data: { releaseId: release.id, questionId: question.id, action: "DISABLE", previousVersionId: question.currentVersionId } });
          }
          for (const question of snapshot.questions) {
            const existing = await tx.question.findUnique({ where: { id: question.id } });
            if (!existing) throw new AppError(`回滚快照引用不存在的题目 ${question.id}`, "ROLLBACK_DATA_MISSING", 409);
            const version = await tx.questionVersion.findUnique({ where: { id: question.versionId } });
            if (!version || version.questionId !== question.id) throw new AppError(`回滚快照缺少题目版本 ${question.id}`, "ROLLBACK_VERSION_MISSING", 409);
            const restoredContentHash = question.contentHash || questionContentHash(normalizeDraftQuestion({
              externalCode: question.externalCode,
              subjectId: question.subjectId,
              chapterId: question.chapterId,
              type: question.type as DraftQuestionInput["type"],
              stem: question.stem,
              code: question.code,
              explanation: question.explanation,
              difficulty: question.difficulty,
              tags: jsonArray<string>(question.tags),
              images: jsonArray<{ src: string; alt: string; caption?: string }>(question.images),
              examScopes: jsonArray<string>(question.examScopes),
              correctOptionIds: jsonArray<string>(question.correctOptionIds),
              acceptedAnswers: jsonArray<string[]>(question.acceptedAnswers),
              answerConfig: question.answerConfig as Record<string, boolean>,
              referenceAnswer: question.referenceAnswer,
              options: question.options.map((option) => ({ id: option.id, label: option.label, text: option.text }))
            }));
            await tx.question.update({
              where: { id: question.id },
              data: {
                externalCode: question.externalCode,
                contentHash: restoredContentHash,
                subjectId: question.subjectId,
                chapterId: question.chapterId,
                currentVersionId: version.id,
                status: "ACTIVE"
              }
            });
            await tx.questionReleaseItem.create({ data: { releaseId: release.id, questionId: question.id, action: "ROLLBACK", previousVersionId: existing.currentVersionId, publishedVersionId: version.id } });
          }
          await tx.questionRelease.update({
            where: { id: release.id },
            data: {
              status: "PUBLISHED",
              publishedById: adminUserId,
              snapshotKey: stored.objectKey,
              snapshotHash: stored.hash,
              catalogHash: stored.catalogHash,
              snapshotSize: stored.size,
              publicCatalog: inputJson(stored.publicCatalog),
              qualityWarnings: inputJson(stored.qualityWarnings),
              qualitySummary: inputJson(stored.qualitySummary),
              questionCount: stored.questionCount,
              publishedAt: new Date()
            }
          });
          await tx.catalogState.upsert({ where: { id: 1 }, update: { activeReleaseId: release.id }, create: { id: 1, activeReleaseId: release.id } });
          await tx.adminAuditLog.create({
            data: this.auditData({
              adminUserId,
              action: "release.rollback",
              entityType: "question_release",
              entityId: release.id,
              afterState: { targetReleaseId, snapshotHash: stored.hash },
              requestId
            })
          });
          return tx.questionRelease.findUniqueOrThrow({ where: { id: release.id }, include: { _count: { select: { items: true } } } });
        }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return await this.verifyPublishedRelease(published.id, adminUserId, requestId);
      } catch (error) {
        await this.prisma.questionRelease.updateMany({
          where: { id: release.id, status: "PREPARING" },
          data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 4000) : String(error) }
        });
        throw error;
      }
    });
  }
}
