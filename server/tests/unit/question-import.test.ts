import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { DatabaseClient } from "../../src/db.js";
import {
  assertEmptyBaselineDatabase,
  readQuestionSources,
  type BaselineImportCounts
} from "../../src/scripts/import-questions.js";
import {
  importBatchContentHash,
  parseQuestionImportWorkbook,
  QUESTION_IMPORT_SHEET_NAMES,
  QuestionImportService
} from "../../src/services/question-import.js";
import type { QuestionBankService } from "../../src/services/question-bank.js";
import type { QuestionBankStorage } from "../../src/services/question-bank-storage.js";

const contentDirectory = fileURLToPath(new URL("../../../../content", import.meta.url));

function importService(prisma: unknown = {}, bank: unknown = {
  reviewMetadata: async (adminUserId: string, submittedById: string | null) => {
    if (adminUserId === submittedById) throw Object.assign(new Error("self review forbidden"), { code: "SELF_REVIEW_FORBIDDEN" });
    return { reviewMode: "INDEPENDENT", checklist: null, selfReviewNote: null };
  }
}, storage: unknown = {}) {
  return new QuestionImportService(
    prisma as DatabaseClient,
    bank as QuestionBankService,
    storage as QuestionBankStorage
  );
}

describe("题库导入源", () => {
  it("整批冻结哈希与行顺序无关且覆盖题目草稿内容", () => {
    const rows = [
      { entityType: "subject", rowNumber: 2, normalizedData: { id: "cpp", name: "C/C++" }, errors: [], warnings: [] },
      { entityType: "question", rowNumber: 2, normalizedData: { stem: "题干" }, errors: [], warnings: ["人工确认"], draftId: "draft-1", draft: { contentHash: "a".repeat(64) } }
    ];
    const first = importBatchContentHash("source", rows);
    assert.equal(first, importBatchContentHash("source", [...rows].reverse()));
    assert.notEqual(first, importBatchContentHash("source", rows.map((row) => row.draftId ? { ...row, draft: { contentHash: "b".repeat(64) } } : row)));
  });

  it("目录型导入批次执行跨人复核并用 revision CAS 防止双重处理", async () => {
    const rows = [{ id: "row-1", batchId: "batch-1", entityType: "subject", rowNumber: 2, normalizedData: { id: "new-subject", name: "新学科" }, errors: [], warnings: [], draftId: null, draft: null }];
    const contentHash = importBatchContentHash("source", rows);
    let state = { id: "batch-1", sourceHash: "source", status: "IN_REVIEW", revision: 3, submittedById: "submitter", contentHash, rows };
    let reviews = 0;
    const batchDelegate = {
      findUnique: async () => ({ ...state }),
      updateMany: async ({ where, data }: { where: { status: string; revision: number; contentHash: string }; data: { status: string } }) => {
        if (state.status !== where.status || state.revision !== where.revision || state.contentHash !== where.contentHash) return { count: 0 };
        state = { ...state, status: data.status, revision: state.revision + 1 };
        return { count: 1 };
      }
    };
    const tx = {
      questionImportBatch: batchDelegate,
      importBatchReview: { create: async () => { reviews += 1; return {}; } },
      adminAuditLog: { create: async () => ({}) }
    };
    const service = importService({
      questionImportBatch: batchDelegate,
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    });
    await assert.rejects(() => service.reviewBatch("submitter", state.id, "APPROVED"), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "SELF_REVIEW_FORBIDDEN"));
    const results = await Promise.allSettled([
      service.reviewBatch("reviewer-1", state.id, "APPROVED"),
      service.reviewBatch("reviewer-2", state.id, "REJECTED")
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal((rejected?.reason as { code?: string })?.code, "IMPORT_BATCH_REVIEW_CONFLICT");
    assert.equal(reviews, 1);
    assert.equal(state.revision, 4);
  });

  it("动态发现学科文件并保证 10 万题以内全局唯一", async () => {
    const questions = await readQuestionSources(contentDirectory);
    const ids = new Set(questions.map((question) => question.id));
    assert.equal(questions.length > 0, true);
    assert.equal(questions.length <= 100_000, true);
    assert.equal(ids.size, questions.length);
    assert.equal(new Set(questions.map((question) => question.subjectId)).size > 0, true);
  });

  it("只允许向完全空白的业务数据库导入基线", () => {
    const empty: BaselineImportCounts = {
      users: 0,
      subjects: 0,
      chapters: 0,
      questions: 0,
      questionVersions: 0,
      practiceSessions: 0,
      exams: 0,
      drafts: 0,
      imports: 0,
      releases: 0,
      catalogModules: 0,
      catalogStates: 0,
      mediaAssets: 0,
      administrators: 0
    };
    assert.doesNotThrow(() => assertEmptyBaselineDatabase(empty));
    assert.throws(
      () => assertEmptyBaselineDatabase({ ...empty, users: 1, questions: 500 }),
      /database is not empty.*users=1.*questions=500/
    );
  });

  it("模板、导出和重新解析保持六张数据表、说明表及媒体/填空答案数据", async () => {
    const template = await importService().template();
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(template as unknown as ExcelJS.Buffer);
    assert.deepEqual(templateWorkbook.worksheets.map((sheet) => sheet.name), [...QUESTION_IMPORT_SHEET_NAMES]);
    const parsedTemplate = await parseQuestionImportWorkbook(template);
    assert.equal(parsedTemplate.fillAnswers.length, 1);
    assert.equal(parsedTemplate.media.length, 1);
    assert.deepEqual(JSON.parse(parsedTemplate.subjects[0]?.rawData.quality_policy_json || "null"), {
      questionTypes: { SINGLE: { min: 20 } },
      difficulties: { "1": { min: 5 } },
      chapters: { "cpp-pointer": { min: 5 } }
    });

    const publicUrl = "/api/v1/media/asset-ready";
    const prisma = {
      catalogState: { findUnique: async () => null },
      subject: { findMany: async () => [{
        id: "cpp",
        name: "C/C++",
        shortName: "C/C++",
        color: "#2563eb",
        description: "语言基础",
        qualityPolicy: { questionTypes: { SINGLE: { min: 1 } } }
      }] },
      chapter: { findMany: async () => [{ id: "cpp-basic", subjectId: "cpp", name: "基础", description: "基础章节" }] },
      question: {
        findMany: async () => [{
          id: "q-export",
          externalCode: "CPP-EXPORT-001",
          subjectId: "cpp",
          chapterId: "cpp-basic",
          currentVersion: {
            type: "SINGLE",
            stem: "导出往返测试题目",
            code: null,
            explanation: "这是用于验证导出往返结构的完整解析。",
            difficulty: 1,
            tags: ["导出"],
            images: [{ src: publicUrl, alt: "指针关系示意图", caption: "示意图" }],
            examScopes: [],
            correctOptionIds: ["A"],
            acceptedAnswers: [],
            answerConfig: { caseSensitive: false, punctuationSensitive: false },
            referenceAnswer: null,
            options: [
              { optionId: "A", label: "A", text: "正确选项", position: 0 },
              { optionId: "B", label: "B", text: "错误选项", position: 1 }
            ]
          }
        }, {
          id: "q-export-fill",
          externalCode: "CPP-EXPORT-FILL-001",
          subjectId: "cpp",
          chapterId: "cpp-basic",
          currentVersion: {
            type: "FILL_BLANK",
            stem: "动态分配内存使用哪个函数",
            code: null,
            explanation: "malloc 函数用于申请指定字节数的动态内存。",
            difficulty: 1,
            tags: ["填空"],
            images: [],
            examScopes: [],
            correctOptionIds: [],
            acceptedAnswers: [["malloc", "动态分配"]],
            answerConfig: { caseSensitive: false, punctuationSensitive: false },
            referenceAnswer: null,
            options: []
          }
        }]
      },
      mediaAsset: {
        findMany: async () => [{ id: "asset-ready", publicUrl, sha256: "a".repeat(64), status: "READY", createdAt: new Date() }]
      }
    };
    const exported = await importService(prisma).exportPublished();
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(exported as unknown as ExcelJS.Buffer);
    assert.deepEqual(exportedWorkbook.worksheets.map((sheet) => sheet.name), [...QUESTION_IMPORT_SHEET_NAMES]);
    const parsed = await parseQuestionImportWorkbook(exported);
    assert.equal(parsed.subjects.length, 1);
    assert.equal(parsed.chapters.length, 1);
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.options.length, 2);
    assert.equal(parsed.fillAnswers.length, 2);
    assert.equal(parsed.media.length, 1);
    assert.deepEqual(JSON.parse(parsed.subjects[0]?.rawData.quality_policy_json || "null"), {
      questionTypes: { SINGLE: { min: 1 } }
    });
    assert.deepEqual(parsed.fillAnswers.map((row) => row.rawData), [
      { question_ref: "CPP-EXPORT-FILL-001", blank_index: "1", accepted_answer: "malloc" },
      { question_ref: "CPP-EXPORT-FILL-001", blank_index: "1", accepted_answer: "动态分配" }
    ]);
    assert.deepEqual(parsed.media[0]?.rawData, {
      asset_id: "asset-ready",
      object_url: publicUrl,
      alt: "指针关系示意图",
      caption: "示意图",
      sha256: "a".repeat(64)
    });
  });

  it("开放资料原创批次保持标准七表并可完整解析 350 道题", async () => {
    const batchPath = path.join(contentDirectory, "imports", "2026-07-17-open-sources", "趣刷题喽-开放资料原创题库-2026-07-17.xlsx");
    const body = await readFile(batchPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ExcelJS.Buffer);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [...QUESTION_IMPORT_SHEET_NAMES]);

    const parsed = await parseQuestionImportWorkbook(body);
    assert.equal(parsed.subjects.length, 0);
    assert.equal(parsed.chapters.length, 0);
    assert.equal(parsed.questions.length, 350);
    assert.equal(parsed.options.length, 1_134);
    assert.equal(parsed.fillAnswers.length, 66);
    assert.equal(parsed.media.length, 0);
    assert.equal(new Set(parsed.questions.map((row) => row.rawData.external_code)).size, 350);
    assert.equal(parsed.questions.every((row) => row.rawData.exam_scopes === ""), true);
    assert.equal(parsed.questions.filter((row) => row.rawData.type === "fill_blank").every((row) => {
      const answers = JSON.parse(row.rawData.accepted_answers_json || "null");
      return Array.isArray(answers) && answers.length > 0 && answers.every((group) => Array.isArray(group) && group.length > 0);
    }), true);
  });

  it("整本工作簿存在错误时只保留暂存报告，不触发目录落库事务", async () => {
    const template = await importService().template();
    let transactionCalls = 0;
    let catalogMutationCalls = 0;
    let storedRows: Array<Record<string, unknown>> = [];
    let batchState: Record<string, unknown> = { id: "batch-invalid", status: "STAGING" };
    const prisma = {
      subject: { findMany: async () => [] },
      chapter: { findMany: async () => [] },
      question: { findMany: async () => [] },
      questionDraft: { findMany: async () => [] },
      mediaAsset: { findMany: async () => [] },
      questionImportBatch: {
        findUnique: async () => null,
        create: async () => batchState,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          batchState = { ...batchState, ...data };
          return batchState;
        }
      },
      questionImportRow: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          storedRows = data;
          return { count: data.length };
        }
      },
      $transaction: async (callback: (tx: unknown) => unknown) => {
        transactionCalls += 1;
        return callback({
          questionImportBatch: {
            update: async ({ data }: { data: Record<string, unknown> }) => {
              batchState = { ...batchState, ...data };
              return batchState;
            }
          },
          questionImportRow: {
            createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
              storedRows = data;
              return { count: data.length };
            }
          },
          subject: { create: async () => { catalogMutationCalls += 1; } },
          chapter: { create: async () => { catalogMutationCalls += 1; } },
          question: { create: async () => { catalogMutationCalls += 1; } },
          questionDraft: { create: async () => { catalogMutationCalls += 1; } }
        });
      }
    };
    const audits: Array<Record<string, unknown>> = [];
    const bank = { audit: async (entry: Record<string, unknown>) => { audits.push(entry); } };
    const storage = { put: async () => ({ size: template.length }) };
    const result = await importService(prisma, bank, storage).importWorkbook("admin-1", "invalid.xlsx", template);
    assert.equal(result.status, "STAGING");
    assert.equal(transactionCalls, 1);
    assert.equal(catalogMutationCalls, 0);
    assert.equal(storedRows.some((row) => row.entityType === "media"), true);
    assert.equal(Number(result.errorRows) > 0, true);
    assert.equal(audits.length, 1);
  });

  it("重新校验会清除过期错误并同步每行报告与批次计数", async () => {
    const storedRows = [
      { id: "row-subject", entityType: "subject", rowNumber: 2, rawData: { subject_id: "cpp", name: "C/C++", short_name: "C/C++", color: "#2563eb", description: "语言基础" }, normalizedData: null, draftId: null, errors: ["旧错误"], warnings: [] },
      { id: "row-chapter", entityType: "chapter", rowNumber: 2, rawData: { chapter_id: "cpp-basic", subject_id: "cpp", name: "基础", description: "基础章节" }, normalizedData: null, draftId: null, errors: [], warnings: [] },
      { id: "row-question", entityType: "question", rowNumber: 2, rawData: { question_id: "", external_code: "CPP-FILL-001", subject_id: "cpp", chapter_id: "cpp-basic", type: "fill_blank", stem: "用于重新校验的填空题", code: "", explanation: "这是用于验证重新校验一致性的完整解析。", difficulty: "1", tags: "填空", exam_scopes: "", correct_option_ids: "", accepted_answers_json: "[[\"答案\"]]", case_sensitive: "否", punctuation_sensitive: "否", reference_answer: "", images_json: "[]" }, normalizedData: { questionId: "q_preserved" }, draftId: null, errors: [], warnings: [] },
      { id: "row-media", entityType: "media", rowNumber: 2, rawData: { asset_id: "missing-asset", object_url: "", alt: "缺失资源", caption: "", sha256: "" }, normalizedData: null, draftId: null, errors: ["过期错误"], warnings: ["过期警告"] }
    ];
    const rowUpdates = new Map<string, Record<string, unknown>>();
    let batchUpdate: Record<string, unknown> = {};
    let batchState = { id: "batch-revalidate", createdById: "admin-1", status: "STAGING", revision: 2, rows: storedRows };
    const transactionClient = {
      questionImportRow: {
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          rowUpdates.set(where.id, data);
          return data;
        }
      },
      questionImportBatch: {
        updateMany: async ({ where, data }: { where: { id: string; status: string; revision: number }; data: Record<string, unknown> }) => {
          if (where.id !== batchState.id || where.status !== batchState.status || where.revision !== batchState.revision) return { count: 0 };
          batchUpdate = data;
          batchState = { ...batchState, status: String(data.status), revision: batchState.revision + 1 };
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ ...batchState, ...batchUpdate })
      }
    };
    const prisma = {
      // Simulate inactive FK placeholders left by an earlier rejected import.
      // The valid rows in this revised workbook must make them valid candidate
      // state without mutating/activating the stored catalog during validation.
      subject: { findMany: async () => [{ id: "cpp", active: false }] },
      chapter: { findMany: async () => [{ id: "cpp-basic", subjectId: "cpp", active: false }] },
      question: { findMany: async () => [] },
      questionDraft: { findMany: async () => [] },
      mediaAsset: { findMany: async () => [] },
      questionImportBatch: {
        findUnique: async () => batchState
      },
      $transaction: async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)
    };
    const result = await importService(prisma).revalidateBatch("batch-revalidate");
    assert.deepEqual(rowUpdates.get("row-subject")?.errors, []);
    assert.deepEqual(rowUpdates.get("row-subject")?.warnings, []);
    assert.deepEqual(rowUpdates.get("row-question")?.errors, []);
    assert.equal((rowUpdates.get("row-media")?.errors as string[]).some((message) => message.includes("媒体资源不存在")), true);
    assert.deepEqual(rowUpdates.get("row-media")?.warnings, []);
    assert.equal(batchUpdate.errorRows, 1);
    assert.equal(batchUpdate.validRows, 3);
    assert.equal(batchUpdate.warningRows, 1);
    assert.equal(result.status, "STAGING");
  });

  it("驳回且已关联草稿的批次可重新校验回到 VALID", async () => {
    const storedRows = [
      { id: "row-subject", entityType: "subject", rowNumber: 2, rawData: { subject_id: "cpp", name: "C/C++", short_name: "C/C++", color: "#2563eb", description: "Language basics", active: "yes" }, normalizedData: null, draftId: null, errors: [], warnings: [] },
      { id: "row-chapter", entityType: "chapter", rowNumber: 2, rawData: { chapter_id: "cpp-basic", subject_id: "cpp", name: "Basics", description: "Basic chapter", active: "yes" }, normalizedData: null, draftId: null, errors: [], warnings: [] },
      { id: "row-question", entityType: "question", rowNumber: 2, rawData: { question_id: "", external_code: "CPP-FILL-REJECTED", subject_id: "cpp", chapter_id: "cpp-basic", type: "fill_blank", stem: "A rejected import can be checked again", code: "", explanation: "Complete explanation for the rejected import revalidation test.", difficulty: "1", tags: "fill", exam_scopes: "", correct_option_ids: "", accepted_answers_json: "[[\"answer\"]]", case_sensitive: "no", punctuation_sensitive: "no", reference_answer: "", images_json: "[]" }, normalizedData: { questionId: "q_rejected" }, draftId: "draft-rejected", errors: [], warnings: [] }
    ];
    let state = { id: "batch-rejected", createdById: "admin-1", status: "REJECTED", revision: 4, rows: storedRows };
    const rowUpdates = new Map<string, Record<string, unknown>>();
    const transactionClient = {
      questionImportRow: { update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { rowUpdates.set(where.id, data); return {}; } },
      questionImportBatch: {
        updateMany: async ({ where, data }: { where: { id: string; status: string; revision: number }; data: { status: string } }) => {
          if (where.id !== state.id || where.status !== state.status || where.revision !== state.revision) return { count: 0 };
          state = { ...state, status: data.status, revision: state.revision + 1 };
          return { count: 1 };
        },
        findUniqueOrThrow: async () => state
      }
    };
    const prisma = {
      subject: { findMany: async () => [{ id: "cpp", active: false }] },
      chapter: { findMany: async () => [{ id: "cpp-basic", subjectId: "cpp", active: false }] },
      question: { findMany: async () => [] },
      questionDraft: { findMany: async () => [{ id: "draft-rejected", questionId: "q_rejected", validationErrors: [], validationWarnings: [] }] },
      mediaAsset: { findMany: async () => [] },
      questionImportBatch: { findUnique: async () => state },
      $transaction: async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)
    };

    const result = await importService(prisma).revalidateBatch(state.id);
    assert.equal(result.status, "VALID", JSON.stringify(Object.fromEntries(rowUpdates)));
    assert.equal(state.revision, 5);
  });
});
