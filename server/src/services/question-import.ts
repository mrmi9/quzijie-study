import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { DatabaseClient } from "../db.js";
import { Prisma, type ImportBatchStatus } from "../generated/prisma/client.js";
import { AppError } from "../errors.js";
import {
  generateQuestionId,
  normalizeDraftQuestion,
  questionContentHash,
  stableStringify,
  validateDraftQuestion,
  type DraftQuestionInput,
  type ManagedOption,
  type NormalizedDraftQuestion
} from "../domain/question-bank.js";
import {
  normalizeSubjectQualityPolicy,
  QualityPolicyValidationError,
  type SubjectQualityPolicy
} from "../domain/quality-policy.js";
import type { AdminReviewContext, QuestionBankService } from "./question-bank.js";
import type { QuestionBankStorage } from "./question-bank-storage.js";

const MAX_IMPORT_ROWS = 5_000;
const OPEN_DRAFT_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED"] as const;

export type ImportBatchHashRow = {
  entityType: string;
  rowNumber: number;
  normalizedData: unknown;
  errors: unknown;
  warnings: unknown;
  draftId?: string | null;
  draft?: { contentHash?: string | null } | null;
};

export function importBatchContentHash(sourceHash: string, rows: ImportBatchHashRow[]): string {
  const frozen = rows
    .map((row) => ({
      entityType: row.entityType,
      rowNumber: row.rowNumber,
      normalizedData: row.normalizedData ?? null,
      errors: row.errors ?? [],
      warnings: row.warnings ?? [],
      draftId: row.draftId || null,
      draftContentHash: row.draft?.contentHash || null
    }))
    .sort((left, right) => left.entityType.localeCompare(right.entityType) || left.rowNumber - right.rowNumber);
  return createHash("sha256").update(stableStringify({ sourceHash, rows: frozen })).digest("hex");
}

const SUBJECT_COLUMNS = ["subject_id", "name", "short_name", "color", "description", "quality_policy_json"];
const CHAPTER_COLUMNS = ["chapter_id", "subject_id", "name", "description"];
const QUESTION_COLUMNS = [
  "question_id", "external_code", "subject_id", "chapter_id", "type", "stem", "code", "explanation", "difficulty",
  "tags", "exam_scopes", "correct_option_ids", "accepted_answers_json", "case_sensitive", "punctuation_sensitive", "reference_answer", "images_json"
];
const OPTION_COLUMNS = ["question_ref", "option_id", "label", "text", "position"];
const FILL_ANSWER_COLUMNS = ["question_ref", "blank_index", "accepted_answer"];
const MEDIA_COLUMNS = ["asset_id", "object_url", "alt", "caption", "sha256"];

export const QUESTION_IMPORT_SHEET_NAMES = ["学科", "章节", "题目", "选项", "填空答案", "媒体", "说明"] as const;

type ImportEntityType = "subject" | "chapter" | "question" | "option" | "fill_answer" | "media";

export interface ParsedSheetRow {
  rowNumber: number;
  rawData: Record<string, string>;
  storedRowId?: string;
  draftId?: string | null;
  previousNormalizedData?: unknown;
}

export interface ParsedQuestionImportWorkbook {
  subjects: ParsedSheetRow[];
  chapters: ParsedSheetRow[];
  questions: ParsedSheetRow[];
  options: ParsedSheetRow[];
  fillAnswers: ParsedSheetRow[];
  media: ParsedSheetRow[];
}

type ImportRowPlan = ParsedSheetRow & {
  entityType: ImportEntityType;
  normalizedData?: unknown;
  errors: string[];
  warnings: string[];
};

type SubjectPlan = {
  row: ImportRowPlan;
  value: { id: string; name: string; shortName: string; color: string; description: string | null; qualityPolicy: SubjectQualityPolicy | null };
};

type ChapterPlan = {
  row: ImportRowPlan;
  value: { id: string; subjectId: string; name: string; description: string | null };
};

type QuestionPlan = {
  row: ImportRowPlan;
  questionId: string;
  expectsExisting: boolean;
  value: NormalizedDraftQuestion;
};

type WorkbookPlan = {
  rows: ImportRowPlan[];
  subjects: SubjectPlan[];
  chapters: ChapterPlan[];
  questions: QuestionPlan[];
};

type ExportQuestion = {
  id: string;
  externalCode: string | null;
  subjectId: string;
  chapterId: string;
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
  options: Array<{ id: string; label: string; text: string; position: number }>;
};

type ExportSnapshot = {
  subjects: Array<{ id: string; name: string; shortName: string; color: string; description: string | null; qualityPolicy?: unknown; active: boolean }>;
  chapters: Array<{ id: string; subjectId: string; name: string; description: string | null; active: boolean }>;
  questions: Array<ExportQuestion & { status: string }>;
  media?: Array<{ id: string; src: string; sha256: string; mimeType: string; size: number }>;
};

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonArray(value: Prisma.JsonValue | unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return String(value.text || "").trim();
  }
  return String(value).trim();
}

function booleanValue(value: string): boolean {
  return ["1", "true", "是", "yes"].includes(value.toLowerCase());
}

function split(value: string): string[] {
  return value.split(/[|,，]/).map((item) => item.trim()).filter(Boolean);
}

function field(row: Record<string, string>, key: string): string {
  return row[key] || "";
}

function catalogId(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim();
}

function addUnique(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message);
}

function parseArrayField(value: string, label: string, errors: string[]): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      addUnique(errors, `${label} 必须是 JSON 数组`);
      return [];
    }
    return parsed;
  } catch {
    addUnique(errors, `${label} 不是合法 JSON`);
    return [];
  }
}

function parseQualityPolicyField(value: string, errors: string[]): SubjectQualityPolicy | null {
  if (!value) return null;
  try {
    return normalizeSubjectQualityPolicy(JSON.parse(value) as unknown);
  } catch (error) {
    addUnique(
      errors,
      error instanceof QualityPolicyValidationError
        ? `quality_policy_json：${error.message}`
        : "quality_policy_json 不是合法 JSON"
    );
    return null;
  }
}

function worksheetRows(sheet: ExcelJS.Worksheet | undefined): ParsedSheetRow[] {
  if (!sheet || sheet.rowCount < 2) return [];
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  const result: ParsedSheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rawData: Record<string, string> = {};
    for (let column = 1; column < headers.length; column += 1) {
      const header = cellText(headers[column] || "");
      if (header) rawData[header] = cellText(row.getCell(column).value);
    }
    if (Object.values(rawData).some(Boolean)) result.push({ rowNumber, rawData });
  });
  return result;
}

export async function parseQuestionImportWorkbook(body: Buffer): Promise<ParsedQuestionImportWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ExcelJS.Buffer);
  return {
    subjects: worksheetRows(workbook.getWorksheet("学科")),
    chapters: worksheetRows(workbook.getWorksheet("章节")),
    questions: worksheetRows(workbook.getWorksheet("题目")),
    options: worksheetRows(workbook.getWorksheet("选项")),
    fillAnswers: worksheetRows(workbook.getWorksheet("填空答案")),
    media: worksheetRows(workbook.getWorksheet("媒体"))
  };
}

function setColumns(sheet: ExcelJS.Worksheet, values: string[]): void {
  sheet.addRow(values);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  header.alignment = { vertical: "middle" };
  values.forEach((_value, index) => { sheet.getColumn(index + 1).width = index > 7 ? 24 : 18; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + Math.min(values.length, 26))}1` };
}

function createWorkbookStructure(workbook: ExcelJS.Workbook) {
  const subjects = workbook.addWorksheet("学科");
  setColumns(subjects, SUBJECT_COLUMNS);
  const chapters = workbook.addWorksheet("章节");
  setColumns(chapters, CHAPTER_COLUMNS);
  const questions = workbook.addWorksheet("题目");
  setColumns(questions, QUESTION_COLUMNS);
  const options = workbook.addWorksheet("选项");
  setColumns(options, OPTION_COLUMNS);
  const fillAnswers = workbook.addWorksheet("填空答案");
  setColumns(fillAnswers, FILL_ANSWER_COLUMNS);
  const media = workbook.addWorksheet("媒体");
  setColumns(media, MEDIA_COLUMNS);
  const instructions = workbook.addWorksheet("说明");
  instructions.addRows([
    ["字段说明"],
    ["type", "single / multiple / judge / fill_blank / short_answer"],
    ["tags、exam_scopes、correct_option_ids", "使用 | 分隔"],
    ["accepted_answers_json", "填空题使用二维数组，例如 [[\"答案A\",\"别名A\"],[\"答案B\"]]"],
    ["images_json", "媒体库发布地址数组，例如 [{\"src\":\"https://...\",\"alt\":\"说明\"}]"],
    ["question_ref", "可填写 external_code 或已有的 question_id"],
    ["填空答案", "每个可接受答案单独一行；blank_index 从 1 开始且必须连续"],
    ["媒体", "asset_id、object_url、sha256 至少填写一个，且必须对应媒体库中已完成的资源"],
    ["导入安全", "整本工作簿通过结构校验后，学科、章节和题目草稿才会在同一事务中落库"]
  ]);
  instructions.getColumn(1).width = 28;
  instructions.getColumn(2).width = 100;
  return { subjects, chapters, questions, options, fillAnswers, media, instructions };
}

function reportSummary(rows: ImportRowPlan[]) {
  return rows.reduce((summary, row) => {
    if (row.errors.length) summary.errorRows += 1;
    else summary.validRows += 1;
    if (row.warnings.length) summary.warningRows += 1;
    return summary;
  }, { validRows: 0, errorRows: 0, warningRows: 0 });
}

function priorQuestionId(row: ParsedSheetRow): string | undefined {
  if (!row.previousNormalizedData || typeof row.previousNormalizedData !== "object" || Array.isArray(row.previousNormalizedData)) return undefined;
  const value = (row.previousNormalizedData as Record<string, unknown>).questionId;
  return typeof value === "string" && value ? value : undefined;
}

function parsedFromStoredRows(rows: Array<{
  id: string;
  entityType: string;
  rowNumber: number;
  rawData: Prisma.JsonValue;
  normalizedData: Prisma.JsonValue | null;
  draftId: string | null;
}>): ParsedQuestionImportWorkbook {
  const parsed: ParsedQuestionImportWorkbook = { subjects: [], chapters: [], questions: [], options: [], fillAnswers: [], media: [] };
  for (const row of rows) {
    const value: ParsedSheetRow = {
      rowNumber: row.rowNumber,
      rawData: row.rawData as Record<string, string>,
      storedRowId: row.id,
      draftId: row.draftId,
      previousNormalizedData: row.normalizedData
    };
    if (row.entityType === "subject") parsed.subjects.push(value);
    else if (row.entityType === "chapter") parsed.chapters.push(value);
    else if (row.entityType === "question") parsed.questions.push(value);
    else if (row.entityType === "option") parsed.options.push(value);
    else if (row.entityType === "fill_answer") parsed.fillAnswers.push(value);
    else if (row.entityType === "media") parsed.media.push(value);
  }
  return parsed;
}

export class QuestionImportService {
  constructor(private readonly prisma: DatabaseClient, private readonly bank: QuestionBankService, private readonly storage: QuestionBankStorage) {}

  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "趣刷题喽题库管理";
    const sheets = createWorkbookStructure(workbook);
    sheets.subjects.addRow(["cpp", "C/C++", "C/C++", "#2563eb", "语言基础、内存、面向对象与模板"]);
    sheets.chapters.addRow(["cpp-pointer", "cpp", "指针与动态内存", "指针、生命周期与资源管理"]);
    sheets.questions.addRow(["", "CPP-DEMO-001", "cpp", "cpp-pointer", "single", "示例题干（导入前请删除示例行）", "", "示例解析至少八个字符", 1, "指针|示例", "", "A", "[]", "否", "否", "", "[]"]);
    sheets.options.addRow(["CPP-DEMO-001", "A", "A", "示例正确选项", 1]);
    sheets.options.addRow(["CPP-DEMO-001", "B", "B", "示例错误选项", 2]);
    sheets.questions.addRow(["", "CPP-DEMO-FILL-001", "cpp", "cpp-pointer", "fill_blank", "C 语言动态分配内存常用哪个函数？", "", "malloc 用于申请指定字节数的动态内存。", 1, "内存|示例", "", "", "[[\"malloc\"]]", "否", "否", "", "[]"]);
    sheets.fillAnswers.addRow(["CPP-DEMO-FILL-001", 1, "malloc"]);
    sheets.media.addRow(["", "", "图片替代说明", "可选图片标题", ""]);
    sheets.subjects.getCell("F2").value = JSON.stringify({
      questionTypes: { SINGLE: { min: 20 } },
      difficulties: { "1": { min: 5 } },
      chapters: { "cpp-pointer": { min: 5 } }
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private rowPlan(entityType: ImportEntityType, row: ParsedSheetRow): ImportRowPlan {
    return { ...row, entityType, errors: [], warnings: [] };
  }

  private async analyzeWorkbook(parsed: ParsedQuestionImportWorkbook): Promise<WorkbookPlan> {
    const subjectRows = parsed.subjects.map((row) => this.rowPlan("subject", row));
    const chapterRows = parsed.chapters.map((row) => this.rowPlan("chapter", row));
    const questionRows = parsed.questions.map((row) => this.rowPlan("question", row));
    const optionRows = parsed.options.map((row) => this.rowPlan("option", row));
    const fillAnswerRows = parsed.fillAnswers.map((row) => this.rowPlan("fill_answer", row));
    const mediaRows = parsed.media.map((row) => this.rowPlan("media", row));
    const rows = [...subjectRows, ...chapterRows, ...questionRows, ...optionRows, ...fillAnswerRows, ...mediaRows];

    const [existingSubjects, existingChapters] = await Promise.all([
      this.prisma.subject.findMany({ select: { id: true, active: true } }),
      this.prisma.chapter.findMany({ select: { id: true, subjectId: true, active: true } })
    ]);
    const subjectState = new Map(existingSubjects.map((subject) => [subject.id, { active: subject.active }]));
    const chapterState = new Map(existingChapters.map((chapter) => [chapter.id, { subjectId: chapter.subjectId, active: chapter.active }]));

    const subjectPlans: SubjectPlan[] = [];
    const subjectCounts = new Map<string, number>();
    subjectRows.forEach((row) => {
      const id = catalogId(field(row.rawData, "subject_id"));
      if (id) subjectCounts.set(id, (subjectCounts.get(id) || 0) + 1);
    });
    for (const row of subjectRows) {
      const value = {
        id: catalogId(field(row.rawData, "subject_id")),
        name: normalizedText(field(row.rawData, "name")),
        shortName: normalizedText(field(row.rawData, "short_name")),
        color: field(row.rawData, "color") || "#2563eb",
        description: normalizedText(field(row.rawData, "description")) || null,
        qualityPolicy: parseQualityPolicyField(field(row.rawData, "quality_policy_json"), row.errors)
      };
      if (!value.id || !value.name || !value.shortName) addUnique(row.errors, "学科 ID、名称和简称不能为空");
      if (value.id && !/^[a-z][a-z0-9-]{1,31}$/.test(value.id)) addUnique(row.errors, "学科 ID 必须以字母开头并使用小写字母、数字或连字符");
      if ((subjectCounts.get(value.id) || 0) > 1) addUnique(row.errors, `学科 ID ${value.id} 在工作簿中重复`);
      row.normalizedData = value;
      subjectPlans.push({ row, value });
      // A valid catalog row is the candidate state that will become active with
      // this batch.  This deliberately differs from the current database state:
      // an earlier failed/rejected import may have left an inactive FK
      // placeholder which a corrected workbook must be able to reuse.
      if (!row.errors.length) subjectState.set(value.id, { active: true });
    }

    const chapterPlans: ChapterPlan[] = [];
    const chapterCounts = new Map<string, number>();
    chapterRows.forEach((row) => {
      const id = catalogId(field(row.rawData, "chapter_id"));
      if (id) chapterCounts.set(id, (chapterCounts.get(id) || 0) + 1);
    });
    for (const row of chapterRows) {
      const value = {
        id: catalogId(field(row.rawData, "chapter_id")),
        subjectId: catalogId(field(row.rawData, "subject_id")),
        name: normalizedText(field(row.rawData, "name")),
        description: normalizedText(field(row.rawData, "description")) || null
      };
      if (!value.id || !value.subjectId || !value.name) addUnique(row.errors, "章节 ID、学科和名称不能为空");
      if (value.id && !/^[a-z][a-z0-9-]{1,63}$/.test(value.id)) addUnique(row.errors, "章节 ID 格式无效");
      if ((chapterCounts.get(value.id) || 0) > 1) addUnique(row.errors, `章节 ID ${value.id} 在工作簿中重复`);
      const subject = subjectState.get(value.subjectId);
      if (!subject) addUnique(row.errors, "章节引用的学科不存在");
      else if (!subject.active) addUnique(row.errors, "章节引用的学科已停用");
      const existing = chapterState.get(value.id);
      if (existing && existing.subjectId !== value.subjectId) addUnique(row.errors, "已有章节不能移动到其他学科");
      row.normalizedData = value;
      chapterPlans.push({ row, value });
      if (!row.errors.length) chapterState.set(value.id, { subjectId: value.subjectId, active: true });
    }

    const questionRefs = new Map<string, ImportRowPlan[]>();
    const addQuestionRef = (ref: string, row: ImportRowPlan) => {
      if (!ref) return;
      const list = questionRefs.get(ref) || [];
      if (!list.includes(row)) list.push(row);
      questionRefs.set(ref, list);
    };
    for (const row of questionRows) {
      addQuestionRef(normalizedText(field(row.rawData, "question_id")), row);
      addQuestionRef(normalizedText(field(row.rawData, "external_code")), row);
    }
    for (const [ref, owners] of questionRefs) {
      if (owners.length > 1) owners.forEach((row) => addUnique(row.errors, `题目引用 ${ref} 在工作簿中重复`));
    }

    const optionGroups = new Map<number, Array<{ row: ImportRowPlan; value: ManagedOption & { position: number } }>>();
    for (const row of optionRows) {
      const ref = normalizedText(field(row.rawData, "question_ref"));
      const position = Number(field(row.rawData, "position"));
      const value = {
        id: normalizedText(field(row.rawData, "option_id")),
        label: normalizedText(field(row.rawData, "label")),
        text: normalizedText(field(row.rawData, "text")),
        position: field(row.rawData, "position") ? position : 0
      };
      if (!ref) addUnique(row.errors, "选项缺少 question_ref");
      if (!value.id || !value.label || !value.text) addUnique(row.errors, "选项 ID、标签和内容不能为空");
      if (field(row.rawData, "position") && (!Number.isInteger(position) || position < 1)) addUnique(row.errors, "选项位置必须为正整数");
      const owners = questionRefs.get(ref) || [];
      if (!owners.length) addUnique(row.errors, `选项引用的题目 ${ref || "（空）"} 不存在于工作簿`);
      if (owners.length > 1) addUnique(row.errors, `选项引用 ${ref} 无法唯一定位题目`);
      const owner = owners.length === 1 ? owners[0] : undefined;
      row.normalizedData = { questionRef: ref, ...value, questionRowNumber: owner?.rowNumber || null };
      if (owner) {
        const list = optionGroups.get(owner.rowNumber) || [];
        list.push({ row, value: { ...value, position: value.position || list.length + 1 } });
        optionGroups.set(owner.rowNumber, list);
      }
    }
    for (const list of optionGroups.values()) {
      const idCounts = new Map<string, number>();
      const positionCounts = new Map<number, number>();
      list.forEach(({ value }) => {
        idCounts.set(value.id, (idCounts.get(value.id) || 0) + 1);
        positionCounts.set(value.position, (positionCounts.get(value.position) || 0) + 1);
      });
      list.forEach(({ row, value }) => {
        if ((idCounts.get(value.id) || 0) > 1) addUnique(row.errors, `选项 ID ${value.id} 重复`);
        if ((positionCounts.get(value.position) || 0) > 1) addUnique(row.errors, `选项位置 ${value.position} 重复`);
      });
    }

    const fillAnswerGroups = new Map<number, Array<{ row: ImportRowPlan; blankIndex: number; answer: string }>>();
    for (const row of fillAnswerRows) {
      const ref = normalizedText(field(row.rawData, "question_ref"));
      const blankIndex = Number(field(row.rawData, "blank_index"));
      const answer = normalizedText(field(row.rawData, "accepted_answer"));
      if (!ref) addUnique(row.errors, "填空答案缺少 question_ref");
      if (!Number.isInteger(blankIndex) || blankIndex < 1) addUnique(row.errors, "blank_index 必须是从 1 开始的正整数");
      if (!answer) addUnique(row.errors, "accepted_answer 不能为空");
      const owners = questionRefs.get(ref) || [];
      if (!owners.length) addUnique(row.errors, `填空答案引用的题目 ${ref || "（空）"} 不存在于工作簿`);
      if (owners.length > 1) addUnique(row.errors, `填空答案引用 ${ref} 无法唯一定位题目`);
      const owner = owners.length === 1 ? owners[0] : undefined;
      row.normalizedData = { questionRef: ref, blankIndex, acceptedAnswer: answer, questionRowNumber: owner?.rowNumber || null };
      if (owner) {
        const list = fillAnswerGroups.get(owner.rowNumber) || [];
        list.push({ row, blankIndex, answer });
        fillAnswerGroups.set(owner.rowNumber, list);
      }
    }
    for (const list of fillAnswerGroups.values()) {
      const blankIndexes = Array.from(new Set(list.map((item) => item.blankIndex))).sort((left, right) => left - right);
      if (blankIndexes.some((blankIndex, index) => blankIndex !== index + 1)) {
        list.forEach(({ row }) => addUnique(row.errors, "同一题目的 blank_index 必须从 1 开始连续编号"));
      }
      const answers = new Set<string>();
      list.forEach(({ row, blankIndex, answer }) => {
        const key = `${blankIndex}\u0000${answer}`;
        if (answers.has(key)) addUnique(row.errors, `第 ${blankIndex} 空的可接受答案 ${answer} 重复`);
        answers.add(key);
      });
    }

    const preliminaryQuestions: Array<{ row: ImportRowPlan; rawQuestionId: string; externalCode: string; value: NormalizedDraftQuestion }> = [];
    for (const row of questionRows) {
      const accepted = parseArrayField(field(row.rawData, "accepted_answers_json"), "accepted_answers_json", row.errors);
      if (accepted.some((item) => typeof item !== "string" && (!Array.isArray(item) || item.some((answer) => typeof answer !== "string")))) {
        addUnique(row.errors, "accepted_answers_json 只能包含字符串或字符串数组");
      }
      const images = parseArrayField(field(row.rawData, "images_json"), "images_json", row.errors);
      if (images.some((image) => !image || typeof image !== "object" || Array.isArray(image))) addUnique(row.errors, "images_json 的每一项必须是图片对象");
      const options = (optionGroups.get(row.rowNumber) || [])
        .filter((option) => !option.row.errors.length)
        .sort((left, right) => left.value.position - right.value.position)
        .map(({ value }) => ({ id: value.id, label: value.label, text: value.text }));
      const rawQuestionId = normalizedText(field(row.rawData, "question_id"));
      const externalCode = normalizedText(field(row.rawData, "external_code"));
      const sheetAnswers = (fillAnswerGroups.get(row.rowNumber) || [])
        .filter((item) => !item.row.errors.length)
        .reduce<string[][]>((result, item) => {
          const answersForBlank = result[item.blankIndex - 1] || [];
          answersForBlank.push(item.answer);
          result[item.blankIndex - 1] = answersForBlank;
          return result;
        }, []);
      if (sheetAnswers.length && accepted.length) {
        const normalizedJsonAnswers = normalizeDraftQuestion({
          externalCode: null, subjectId: "x", chapterId: "x", type: "FILL_BLANK", stem: "占位题干", explanation: "用于规范化填空答案的占位解析", difficulty: 1,
          acceptedAnswers: accepted as string[][], options: []
        }).acceptedAnswers;
        const normalizedSheetAnswers = normalizeDraftQuestion({
          externalCode: null, subjectId: "x", chapterId: "x", type: "FILL_BLANK", stem: "占位题干", explanation: "用于规范化填空答案的占位解析", difficulty: 1,
          acceptedAnswers: sheetAnswers, options: []
        }).acceptedAnswers;
        if (JSON.stringify(normalizedJsonAnswers) !== JSON.stringify(normalizedSheetAnswers)) {
          addUnique(row.errors, "题目 accepted_answers_json 与“填空答案”工作表不一致");
        }
      }
      const input: DraftQuestionInput = {
        externalCode: externalCode || null,
        subjectId: catalogId(field(row.rawData, "subject_id")),
        chapterId: catalogId(field(row.rawData, "chapter_id")),
        type: field(row.rawData, "type").toUpperCase() as DraftQuestionInput["type"],
        stem: field(row.rawData, "stem"),
        code: field(row.rawData, "code") || null,
        explanation: field(row.rawData, "explanation"),
        difficulty: Number(field(row.rawData, "difficulty")),
        tags: split(field(row.rawData, "tags")),
        examScopes: split(field(row.rawData, "exam_scopes")),
        correctOptionIds: split(field(row.rawData, "correct_option_ids")),
        acceptedAnswers: sheetAnswers.length ? sheetAnswers : accepted as string[][],
        answerConfig: { caseSensitive: booleanValue(field(row.rawData, "case_sensitive")), punctuationSensitive: booleanValue(field(row.rawData, "punctuation_sensitive")) },
        referenceAnswer: field(row.rawData, "reference_answer") || null,
        images: images as DraftQuestionInput["images"],
        options
      };
      let value: NormalizedDraftQuestion;
      try {
        value = normalizeDraftQuestion(input);
        const validation = validateDraftQuestion(value);
        validation.errors.forEach((message) => addUnique(row.errors, message));
        validation.warnings.forEach((message) => addUnique(row.warnings, message));
      } catch {
        value = normalizeDraftQuestion({ ...input, images: [] });
        addUnique(row.errors, "题目字段结构无效");
      }
      const subject = subjectState.get(value.subjectId);
      const chapter = chapterState.get(value.chapterId);
      if (!subject) addUnique(row.errors, "学科不存在");
      else if (!subject.active) addUnique(row.errors, "学科已停用");
      if (!chapter || chapter.subjectId !== value.subjectId) addUnique(row.errors, "章节不存在或不属于该学科");
      else if (!chapter.active) addUnique(row.errors, "章节已停用");
      preliminaryQuestions.push({ row, rawQuestionId, externalCode, value });
    }

    const requestedIds = Array.from(new Set(preliminaryQuestions.map((item) => item.rawQuestionId).filter(Boolean)));
    const externalCodes = Array.from(new Set(preliminaryQuestions.map((item) => item.externalCode).filter(Boolean)));
    const stems = Array.from(new Set(preliminaryQuestions.map((item) => item.value.stem).filter(Boolean)));
    const questionConditions: Prisma.QuestionWhereInput[] = [];
    if (requestedIds.length) questionConditions.push({ id: { in: requestedIds } });
    if (externalCodes.length) questionConditions.push({ externalCode: { in: externalCodes } });
    if (stems.length) questionConditions.push({ currentVersion: { stem: { in: stems } } });
    const existingQuestions = questionConditions.length ? await this.prisma.question.findMany({
      where: { OR: questionConditions },
      select: {
        id: true,
        externalCode: true,
        currentVersionId: true,
        currentVersion: { select: { stem: true } },
        drafts: { where: { status: { in: [...OPEN_DRAFT_STATUSES] } }, select: { id: true } }
      }
    }) : [];
    const questionsById = new Map(existingQuestions.map((question) => [question.id, question]));
    const questionsByExternalCode = new Map(existingQuestions.filter((question) => question.externalCode).map((question) => [question.externalCode!, question]));
    const exactStemMatches = new Map<string, typeof existingQuestions>();
    existingQuestions.forEach((question) => {
      const stem = question.currentVersion?.stem;
      if (!stem) return;
      const list = exactStemMatches.get(stem) || [];
      list.push(question);
      exactStemMatches.set(stem, list);
    });

    const linkedDraftIds = preliminaryQuestions.map((question) => question.row.draftId).filter((id): id is string => Boolean(id));
    const linkedDrafts = linkedDraftIds.length ? await this.prisma.questionDraft.findMany({
      where: { id: { in: linkedDraftIds } },
      select: { id: true, questionId: true, validationErrors: true, validationWarnings: true }
    }) : [];
    const linkedDraftMap = new Map(linkedDrafts.map((draft) => [draft.id, draft]));

    const questionPlans: QuestionPlan[] = [];
    const resolvedQuestionRows = new Map<string, ImportRowPlan[]>();
    for (const item of preliminaryQuestions) {
      const byId = item.rawQuestionId ? questionsById.get(item.rawQuestionId) : undefined;
      const byExternal = item.externalCode ? questionsByExternalCode.get(item.externalCode) : undefined;
      if (item.rawQuestionId && !byId) addUnique(item.row.errors, "指定的 question_id 不存在；新题请留空由系统生成");
      if (byId && byExternal && byId.id !== byExternal.id) addUnique(item.row.errors, "question_id 与 external_code 指向不同题目");
      const expectsExisting = Boolean(byId || byExternal);
      const questionId = byId?.id || byExternal?.id || priorQuestionId(item.row) || generateQuestionId();
      const ownDraftId = item.row.draftId || undefined;
      const existing = byId || byExternal || questionsById.get(questionId);
      if (existing?.drafts.some((draft) => draft.id !== ownDraftId)) addUnique(item.row.errors, "该题已有未完成草稿，请先处理现有草稿");
      if (ownDraftId) {
        const draft = linkedDraftMap.get(ownDraftId);
        if (!draft) addUnique(item.row.errors, "题目草稿未生成或已不存在");
        else {
          if (draft.questionId !== questionId) addUnique(item.row.errors, "导入行关联的草稿与题目不一致");
          jsonArray(draft.validationErrors).map(String).forEach((message) => addUnique(item.row.errors, message));
          jsonArray(draft.validationWarnings).map(String).forEach((message) => addUnique(item.row.warnings, message));
        }
      }
      (exactStemMatches.get(item.value.stem) || [])
        .filter((match) => match.id !== questionId)
        .forEach((match) => addUnique(item.row.warnings, `题干与已发布题目 ${match.id} 完全相同`));
      const list = resolvedQuestionRows.get(questionId) || [];
      list.push(item.row);
      resolvedQuestionRows.set(questionId, list);
      item.row.normalizedData = { questionId, value: item.value };
      questionPlans.push({ row: item.row, questionId, expectsExisting, value: item.value });
    }
    resolvedQuestionRows.forEach((questionRowsForId, questionId) => {
      if (questionRowsForId.length > 1) questionRowsForId.forEach((row) => addUnique(row.errors, `工作簿中多行指向同一题目 ${questionId}`));
    });
    const importedStems = new Map<string, ImportRowPlan[]>();
    questionPlans.forEach((question) => {
      const list = importedStems.get(question.value.stem) || [];
      list.push(question.row);
      importedStems.set(question.value.stem, list);
    });
    importedStems.forEach((stemRows) => {
      if (stemRows.length > 1) stemRows.forEach((row) => addUnique(row.warnings, "题干与本批次其他题目完全相同"));
    });

    const imageUrls = questionPlans.flatMap((question) => question.value.images.map((image) => image.src));
    const mediaIds = mediaRows.map((row) => field(row.rawData, "asset_id")).filter(Boolean);
    const mediaUrls = [...mediaRows.map((row) => field(row.rawData, "object_url")), ...imageUrls].filter(Boolean);
    const mediaHashes = mediaRows.map((row) => field(row.rawData, "sha256").toLowerCase()).filter(Boolean);
    const mediaConditions: Prisma.MediaAssetWhereInput[] = [];
    if (mediaIds.length) mediaConditions.push({ id: { in: Array.from(new Set(mediaIds)) } });
    if (mediaUrls.length) mediaConditions.push({ publicUrl: { in: Array.from(new Set(mediaUrls)) } });
    if (mediaHashes.length) mediaConditions.push({ sha256: { in: Array.from(new Set(mediaHashes)) } });
    const assets = mediaConditions.length ? await this.prisma.mediaAsset.findMany({
      where: { OR: mediaConditions },
      select: { id: true, publicUrl: true, sha256: true, status: true }
    }) : [];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const assetsByUrl = new Map(assets.filter((asset) => asset.publicUrl).map((asset) => [asset.publicUrl!, asset]));
    const assetsByHash = new Map(assets.filter((asset) => asset.sha256).map((asset) => [asset.sha256!, asset]));
    for (const row of mediaRows) {
      const assetId = field(row.rawData, "asset_id");
      const objectUrl = field(row.rawData, "object_url");
      const sha256 = field(row.rawData, "sha256").toLowerCase();
      const alt = normalizedText(field(row.rawData, "alt"));
      if (!assetId && !objectUrl && !sha256) addUnique(row.errors, "媒体行的 asset_id、object_url、sha256 至少填写一个");
      if (!alt) addUnique(row.errors, "媒体替代说明 alt 不能为空");
      if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) addUnique(row.errors, "媒体 sha256 格式无效");
      const candidates = [assetId ? assetsById.get(assetId) : undefined, objectUrl ? assetsByUrl.get(objectUrl) : undefined, sha256 ? assetsByHash.get(sha256) : undefined].filter(Boolean);
      const ids = new Set(candidates.map((asset) => asset!.id));
      if (!candidates.length && (assetId || objectUrl || sha256)) addUnique(row.errors, "媒体资源不存在");
      if (ids.size > 1) addUnique(row.errors, "媒体行中的 ID、地址和哈希指向不同资源");
      const asset = candidates[0];
      if (asset && asset.status !== "READY") addUnique(row.errors, "媒体资源尚未完成校验");
      row.normalizedData = { assetId: asset?.id || assetId || null, objectUrl: asset?.publicUrl || objectUrl || null, sha256: asset?.sha256 || sha256 || null, alt, caption: normalizedText(field(row.rawData, "caption")) || null };
    }
    questionPlans.forEach((question) => question.value.images.forEach((image) => {
      const asset = assetsByUrl.get(image.src);
      if (!asset || asset.status !== "READY") addUnique(question.row.errors, `题图 ${image.src} 未在媒体库完成上传校验`);
    }));

    return { rows, subjects: subjectPlans, chapters: chapterPlans, questions: questionPlans };
  }

  private async updateValidationReport(
    batchId: string,
    plan: WorkbookPlan,
    expected?: { status: ImportBatchStatus; revision: number }
  ) {
    const summary = reportSummary(plan.rows);
    return this.prisma.$transaction(async (tx) => {
      for (const row of plan.rows) {
        await tx.questionImportRow.update({
          where: row.storedRowId ? { id: row.storedRowId } : { batchId_rowNumber_entityType: { batchId, rowNumber: row.rowNumber, entityType: row.entityType } },
          data: {
            normalizedData: row.normalizedData === undefined ? Prisma.JsonNull : inputJson(row.normalizedData),
            errors: inputJson(row.errors),
            warnings: inputJson(row.warnings)
          }
        });
      }
      const nextStatus: ImportBatchStatus = summary.errorRows ? "STAGING" : "VALID";
      const data = {
        ...summary, status: nextStatus,
        contentHash: null, submittedById: null, submittedAt: null, warningsAcknowledgedAt: null,
        revision: { increment: 1 }
      };
      if (expected) {
        const claimed = await tx.questionImportBatch.updateMany({
          where: { id: batchId, status: expected.status, revision: expected.revision },
          data
        });
        if (claimed.count !== 1) {
          throw new AppError("导入批次在重新校验期间发生变化", "IMPORT_BATCH_REVISION_CONFLICT", 409);
        }
        return tx.questionImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      }
      return tx.questionImportBatch.update({ where: { id: batchId }, data });
    }, { timeout: 120_000 });
  }

  private auditData(adminUserId: string, action: string, entityType: string, entityId: string, beforeState: unknown, afterState: unknown, requestId?: string) {
    return {
      adminUserId,
      action,
      entityType,
      entityId,
      beforeState: inputJson(beforeState),
      afterState: inputJson(afterState),
      requestId: requestId || null
    };
  }

  private async materializeBatch(adminUserId: string, batchId: string, plan: WorkbookPlan, requestId?: string) {
    const summary = reportSummary(plan.rows);
    if (summary.errorRows) throw new AppError("导入批次仍有阻断错误", "IMPORT_VALIDATION_FAILED", 409);
    return this.prisma.$transaction(async (tx) => {
      const subjectMaximum = await tx.subject.aggregate({ _max: { order: true } });
      const moduleMaximum = await tx.catalogModule.aggregate({ _max: { order: true } });
      let nextSubjectOrder = (subjectMaximum._max.order || 0) + 1;
      let nextModuleOrder = (moduleMaximum._max.order || 0) + 1;
      for (const subject of plan.subjects) {
        const before = await tx.subject.findUnique({ where: { id: subject.value.id } });
        if (!before) {
          const after = await tx.subject.create({
            data: {
              ...subject.value,
              qualityPolicy: subject.value.qualityPolicy === null ? Prisma.DbNull : inputJson(subject.value.qualityPolicy),
              order: nextSubjectOrder,
              active: false
            }
          });
          nextSubjectOrder += 1;
          await tx.catalogModule.create({
            data: {
              id: subject.value.id,
              name: subject.value.name,
              subtitle: subject.value.description || "专项练习",
              color: subject.value.color,
              type: "SUBJECT",
              order: nextModuleOrder,
              active: false,
              subjects: { create: { subjectId: subject.value.id, order: 0 } }
            }
          });
          nextModuleOrder += 1;
          await tx.adminAuditLog.create({ data: this.auditData(adminUserId, "subject.placeholder.create", "subject", subject.value.id, null, after, requestId) });
        }
      }

      const chapterSubjectIds = Array.from(new Set(plan.chapters.map((chapter) => chapter.value.subjectId)));
      const currentChapters = chapterSubjectIds.length ? await tx.chapter.findMany({ where: { subjectId: { in: chapterSubjectIds } }, select: { subjectId: true, order: true } }) : [];
      const nextChapterOrder = new Map<string, number>();
      chapterSubjectIds.forEach((subjectId) => {
        const maximum = currentChapters.filter((chapter) => chapter.subjectId === subjectId).reduce((value, chapter) => Math.max(value, chapter.order), 0);
        nextChapterOrder.set(subjectId, maximum + 1);
      });
      for (const chapter of plan.chapters) {
        const before = await tx.chapter.findUnique({ where: { id: chapter.value.id } });
        if (before && before.subjectId !== chapter.value.subjectId) throw new AppError("已有章节不能移动到其他学科", "CHAPTER_SUBJECT_CONFLICT", 409);
        if (!before) {
          const order = nextChapterOrder.get(chapter.value.subjectId) || 1;
          const after = await tx.chapter.create({ data: { ...chapter.value, order, active: false } });
          nextChapterOrder.set(chapter.value.subjectId, order + 1);
          await tx.adminAuditLog.create({ data: this.auditData(adminUserId, "chapter.placeholder.create", "chapter", chapter.value.id, null, after, requestId) });
        }
      }

      for (const question of plan.questions) {
        const existing = await tx.question.findUnique({ where: { id: question.questionId } });
        if (question.expectsExisting && !existing) throw new AppError("导入期间目标题目发生变化，请重新校验", "IMPORT_QUESTION_CHANGED", 409);
        if (question.value.externalCode) {
          const externalConflict = await tx.question.findFirst({ where: { externalCode: question.value.externalCode, id: { not: question.questionId } }, select: { id: true } });
          if (externalConflict) throw new AppError("外部题号已被其他题目使用", "QUESTION_EXTERNAL_CODE_CONFLICT", 409);
        }
        const openDraft = await tx.questionDraft.findFirst({ where: { questionId: question.questionId, status: { in: [...OPEN_DRAFT_STATUSES] } }, select: { id: true } });
        if (openDraft) throw new AppError("该题已有未完成草稿，请重新校验", "QUESTION_DRAFT_ALREADY_EXISTS", 409);
        if (!existing) {
          await tx.question.create({
            data: {
              id: question.questionId,
              externalCode: question.value.externalCode,
              subjectId: question.value.subjectId,
              chapterId: question.value.chapterId,
              status: "DISABLED",
              sourceSystem: "admin-import"
            }
          });
        }
        const draft = await tx.questionDraft.create({
          data: {
            questionId: question.questionId,
            externalCode: question.value.externalCode,
            baseVersionId: existing?.currentVersionId || null,
            subjectId: question.value.subjectId,
            chapterId: question.value.chapterId,
            type: question.value.type,
            stem: question.value.stem,
            code: question.value.code,
            explanation: question.value.explanation,
            difficulty: question.value.difficulty,
            tags: inputJson(question.value.tags),
            images: inputJson(question.value.images),
            examScopes: inputJson(question.value.examScopes),
            correctOptionIds: inputJson(question.value.correctOptionIds),
            acceptedAnswers: inputJson(question.value.acceptedAnswers),
            answerConfig: inputJson(question.value.answerConfig),
            referenceAnswer: question.value.referenceAnswer,
            options: inputJson(question.value.options),
            contentHash: questionContentHash(question.value),
            validationErrors: inputJson([]),
            validationWarnings: inputJson(question.row.warnings),
            createdById: adminUserId
          }
        });
        question.row.draftId = draft.id;
        await tx.questionImportRow.update({
          where: question.row.storedRowId ? { id: question.row.storedRowId } : { batchId_rowNumber_entityType: { batchId, rowNumber: question.row.rowNumber, entityType: "question" } },
          data: { draftId: draft.id, normalizedData: inputJson(question.row.normalizedData), errors: inputJson([]), warnings: inputJson(question.row.warnings) }
        });
        await tx.adminAuditLog.create({ data: this.auditData(adminUserId, "draft.create", "question_draft", draft.id, null, { questionId: question.questionId, importBatchId: batchId }, requestId) });
      }
      for (const row of plan.rows.filter((item) => item.entityType !== "question")) {
        await tx.questionImportRow.update({
          where: row.storedRowId ? { id: row.storedRowId } : { batchId_rowNumber_entityType: { batchId, rowNumber: row.rowNumber, entityType: row.entityType } },
          data: { normalizedData: row.normalizedData === undefined ? Prisma.JsonNull : inputJson(row.normalizedData), errors: inputJson(row.errors), warnings: inputJson(row.warnings) }
        });
      }
      const updated = await tx.questionImportBatch.update({
        where: { id: batchId },
        data: { ...summary, status: "VALID", contentHash: null, submittedById: null, submittedAt: null, warningsAcknowledgedAt: null, revision: { increment: 1 } }
      });
      await tx.adminAuditLog.create({ data: this.auditData(adminUserId, "import.materialize", "question_import_batch", batchId, null, { validRows: summary.validRows, warningRows: summary.warningRows }, requestId) });
      return updated;
    }, { timeout: 120_000 });
  }

  private async markMaterializationFailure(
    batchId: string,
    plan: WorkbookPlan,
    error: unknown,
    expected?: { status: ImportBatchStatus; revision: number }
  ) {
    const message = error instanceof AppError ? error.message : "批次原子落库失败，请稍后重新校验";
    const target = plan.questions[0]?.row || plan.rows[0];
    if (target) addUnique(target.errors, `原子落库失败：${message}`);
    return this.updateValidationReport(batchId, plan, expected);
  }

  async importWorkbook(adminUserId: string, fileName: string, body: Buffer, requestId?: string) {
    const sourceHash = createHash("sha256").update(body).digest("hex");
    const duplicate = await this.prisma.questionImportBatch.findUnique({
      where: { sourceHash_createdById: { sourceHash, createdById: adminUserId } }
    });
    if (duplicate && duplicate.status !== "CANCELLED") return duplicate;
    const parsed = await parseQuestionImportWorkbook(body);
    const totalRows = parsed.subjects.length + parsed.chapters.length + parsed.questions.length + parsed.options.length + parsed.fillAnswers.length + parsed.media.length;
    if (!parsed.questions.length && !parsed.subjects.length && !parsed.chapters.length) {
      throw new AppError("工作簿缺少学科、章节或题目数据", "IMPORT_EMPTY", 400);
    }
    if (totalRows > MAX_IMPORT_ROWS) throw new AppError(`单次导入最多允许 ${MAX_IMPORT_ROWS} 行`, "IMPORT_TOO_LARGE", 413);
    const plan = await this.analyzeWorkbook(parsed);
    const summary = reportSummary(plan.rows);
    const batch = duplicate
      ? await this.prisma.$transaction(async (tx) => {
          await tx.questionImportRow.deleteMany({ where: { batchId: duplicate.id } });
          return tx.questionImportBatch.update({
            where: { id: duplicate.id },
            data: {
              fileName: fileName.slice(0, 255),
              status: "STAGING",
              totalRows,
              validRows: 0,
              errorRows: 0,
              warningRows: 0,
              contentHash: null,
              submittedById: null,
              submittedAt: null,
              warningsAcknowledgedAt: null,
              publishedReleaseId: null,
              revision: { increment: 1 },
              sourceObjectKey: null,
              sourceExpiresAt: null
            }
          });
        })
      : await this.prisma.questionImportBatch.create({
          data: { fileName: fileName.slice(0, 255), sourceHash, createdById: adminUserId, totalRows }
        });
    const sourceObjectKey = `question-bank/imports/${batch.id}/${sourceHash}.xlsx`;
    try {
      await this.storage.put(sourceObjectKey, body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await this.prisma.$transaction(async (tx) => {
        await tx.questionImportBatch.update({
          where: { id: batch.id },
          data: { sourceObjectKey, sourceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) }
        });
        await tx.questionImportRow.createMany({
          data: plan.rows.map((row) => ({
            batchId: batch.id,
            entityType: row.entityType,
            rowNumber: row.rowNumber,
            rawData: inputJson(row.rawData),
            ...(row.normalizedData === undefined ? {} : { normalizedData: inputJson(row.normalizedData) }),
            errors: inputJson(row.errors),
            warnings: inputJson(row.warnings)
          }))
        });
      });
    } catch (error) {
      await this.prisma.questionImportBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED" } });
      await this.bank.audit({
        adminUserId,
        action: "import.create.storage_failed",
        entityType: "question_import_batch",
        entityId: batch.id,
        afterState: { sourceObjectKey, error: error instanceof Error ? error.message : String(error) },
        requestId
      });
      throw error;
    }
    if (summary.errorRows) {
      const updated = await this.prisma.questionImportBatch.update({ where: { id: batch.id }, data: { ...summary, status: "STAGING" } });
      await this.bank.audit({ adminUserId, action: "import.create", entityType: "question_import_batch", entityId: batch.id, afterState: updated, requestId });
      return updated;
    }
    try {
      const updated = await this.materializeBatch(adminUserId, batch.id, plan, requestId);
      return updated;
    } catch (error) {
      const updated = await this.markMaterializationFailure(batch.id, plan, error);
      await this.bank.audit({ adminUserId, action: "import.create.failed", entityType: "question_import_batch", entityId: batch.id, afterState: { ...summary, error: error instanceof Error ? error.message : String(error) }, requestId });
      return updated;
    }
  }

  async listBatches(query: { page?: number; pageSize?: number; status?: string } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    if (status && !["STAGING", "VALID", "IN_REVIEW", "APPROVED", "REJECTED", "PUBLISHED", "CANCELLED"].includes(status)) {
      throw new AppError("导入状态筛选值无效", "INVALID_IMPORT_FILTER", 400);
    }
    const where: Prisma.QuestionImportBatchWhereInput = status
      ? { status: status as never }
      : {};
    const [total, items] = await Promise.all([
      this.prisma.questionImportBatch.count({ where }),
      this.prisma.questionImportBatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { username: true, displayName: true } },
          submittedBy: { select: { username: true, displayName: true } },
          reviews: { orderBy: { createdAt: "desc" }, take: 1, include: { reviewer: { select: { username: true, displayName: true } } } },
          _count: { select: { rows: true } }
        }
      })
    ]);
    return { page, pageSize, total, items };
  }

  async getBatch(id: string) {
    const batch = await this.prisma.questionImportBatch.findUnique({
      where: { id },
      include: {
        createdBy: { select: { username: true, displayName: true } },
        submittedBy: { select: { username: true, displayName: true } },
        reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { username: true, displayName: true } } } },
        rows: { orderBy: [{ entityType: "asc" }, { rowNumber: "asc" }], include: { draft: { select: { id: true, contentHash: true, status: true, revision: true, submittedById: true } } } }
      }
    });
    if (!batch) throw new AppError("导入批次不存在", "IMPORT_NOT_FOUND", 404);
    return batch;
  }

  async getBatchSummary(id: string) {
    const batch = await this.prisma.questionImportBatch.findUnique({
      where: { id },
      include: {
        createdBy: { select: { username: true, displayName: true } },
        submittedBy: { select: { username: true, displayName: true } },
        reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { username: true, displayName: true } } } },
        _count: { select: { rows: true } }
      }
    });
    if (!batch) throw new AppError("导入批次不存在", "IMPORT_NOT_FOUND", 404);
    return batch;
  }

  async listBatchRows(id: string, query: { page?: number; pageSize?: number; status?: string; entityType?: string } = {}) {
    const exists = await this.prisma.questionImportBatch.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError("导入批次不存在", "IMPORT_NOT_FOUND", 404);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const status = String(query.status || "all").toLowerCase();
    if (!["all", "error", "warning", "valid"].includes(status)) {
      throw new AppError("导入行状态筛选值无效", "INVALID_IMPORT_ROW_FILTER", 400);
    }
    const entityType = String(query.entityType || "").trim();
    const where: Prisma.QuestionImportRowWhereInput = { batchId: id, ...(entityType ? { entityType } : {}) };
    const orderBy = [{ entityType: "asc" as const }, { rowNumber: "asc" as const }];
    const include = { draft: { select: { id: true, status: true, revision: true, contentHash: true } } };
    if (status === "all") {
      const [total, items] = await Promise.all([
        this.prisma.questionImportRow.count({ where }),
        this.prisma.questionImportRow.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include })
      ]);
      return { page, pageSize, total, items };
    }
    // MySQL JSON-array length is not exposed by Prisma's portable filters. An
    // import is hard-capped at 5,000 rows, so status filtering scans only ids
    // and the two small validation arrays, then fetches the requested page.
    const candidates = await this.prisma.questionImportRow.findMany({
      where,
      orderBy,
      select: { id: true, errors: true, warnings: true }
    });
    const filteredIds = candidates.filter((row) => {
      const errors = Array.isArray(row.errors) ? row.errors.length : 0;
      const warnings = Array.isArray(row.warnings) ? row.warnings.length : 0;
      if (status === "error") return errors > 0;
      if (status === "warning") return errors === 0 && warnings > 0;
      if (status === "valid") return errors === 0 && warnings === 0;
      return true;
    }).map((row) => row.id);
    const pageIds = filteredIds.slice((page - 1) * pageSize, page * pageSize);
    const pageRows = pageIds.length ? await this.prisma.questionImportRow.findMany({ where: { id: { in: pageIds } }, include }) : [];
    const byId = new Map(pageRows.map((row) => [row.id, row]));
    return {
      page,
      pageSize,
      total: filteredIds.length,
      items: pageIds.map((rowId) => byId.get(rowId)).filter(Boolean)
    };
  }

  async validationReport(id: string): Promise<Buffer> {
    const batch = await this.getBatch(id);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "趣刷题喽题库管理";
    const sheet = workbook.addWorksheet("校验报告");
    sheet.columns = [
      { header: "实体类型", key: "entityType", width: 16 },
      { header: "行号", key: "rowNumber", width: 10 },
      { header: "状态", key: "status", width: 12 },
      { header: "错误", key: "errors", width: 48 },
      { header: "警告", key: "warnings", width: 48 },
      { header: "原始数据", key: "rawData", width: 72 }
    ];
    for (const row of batch.rows) {
      const errors = Array.isArray(row.errors) ? row.errors.map(String) : [];
      const warnings = Array.isArray(row.warnings) ? row.warnings.map(String) : [];
      sheet.addRow({
        entityType: row.entityType,
        rowNumber: row.rowNumber,
        status: errors.length ? "错误" : warnings.length ? "警告" : "通过",
        errors: errors.join("\n"),
        warnings: warnings.join("\n"),
        rawData: JSON.stringify(row.rawData)
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const payload = await workbook.xlsx.writeBuffer();
    return Buffer.from(payload);
  }

  async revalidateBatch(id: string, adminUserId?: string, requestId?: string) {
    const batch = await this.getBatch(id);
    const actorId = adminUserId || batch.createdById;
    if (["IN_REVIEW", "APPROVED", "PUBLISHED", "CANCELLED"].includes(batch.status)) {
      throw new AppError("当前导入批次不能重新校验", "IMPORT_NOT_EDITABLE", 409);
    }
    const plan = await this.analyzeWorkbook(parsedFromStoredRows(batch.rows));
    const linkedQuestionRows = plan.questions.filter((question) => Boolean(question.row.draftId));
    if (linkedQuestionRows.length > 0 && linkedQuestionRows.length < plan.questions.length) {
      plan.questions.forEach((question) => addUnique(question.row.errors, "批次草稿状态不完整，请重新导入原文件"));
    }
    const summary = reportSummary(plan.rows);
    if (summary.errorRows || linkedQuestionRows.length === plan.questions.length) {
      return this.updateValidationReport(id, plan, { status: batch.status, revision: batch.revision });
    }
    try {
      return await this.materializeBatch(actorId, id, plan, requestId);
    } catch (error) {
      return this.markMaterializationFailure(id, plan, error, { status: batch.status, revision: batch.revision });
    }
  }

  async submitBatch(adminUserId: string, id: string, acknowledgeWarnings = false, requestId?: string) {
    await this.revalidateBatch(id, adminUserId, requestId);
    const checked = await this.getBatch(id);
    if (checked.errorRows) throw new AppError("导入批次仍有阻断错误", "IMPORT_VALIDATION_FAILED", 409);
    if (checked.warningRows && !acknowledgeWarnings) throw new AppError("请先确认导入批次中的全部警告", "IMPORT_WARNINGS_NOT_ACKNOWLEDGED", 409);
    if (checked.status !== "VALID") throw new AppError("导入批次当前不能提交复核", "IMPORT_NOT_SUBMITTABLE", 409);
    const draftIds = Array.from(new Set(checked.rows.map((row) => row.draftId).filter((draftId): draftId is string => Boolean(draftId))));
    const hasCatalogCandidates = checked.rows.some((row) => row.entityType === "subject" || row.entityType === "chapter");
    if (!draftIds.length && !hasCatalogCandidates) throw new AppError("导入批次没有可提交内容", "IMPORT_EMPTY", 409);
    const contentHash = importBatchContentHash(checked.sourceHash, checked.rows);
    await this.prisma.$transaction(async (tx) => {
      const drafts = await tx.questionDraft.findMany({ where: { id: { in: draftIds } } });
      if (drafts.length !== draftIds.length || drafts.some((draft) => !["DRAFT", "REJECTED"].includes(draft.status))) {
        throw new AppError("批次中存在不可提交的题目草稿", "IMPORT_DRAFT_NOT_SUBMITTABLE", 409);
      }
      if (drafts.some((draft) => Array.isArray(draft.validationErrors) && draft.validationErrors.length)) {
        throw new AppError("批次中仍有题目校验错误", "IMPORT_VALIDATION_FAILED", 409);
      }
      if (draftIds.length) {
        const claimedDrafts = await tx.questionDraft.updateMany({
          where: { id: { in: draftIds }, status: { in: ["DRAFT", "REJECTED"] } },
          data: { status: "IN_REVIEW", submittedById: adminUserId, submittedAt: new Date(), warningsAcknowledgedAt: checked.warningRows ? new Date() : null, revision: { increment: 1 } }
        });
        if (claimedDrafts.count !== draftIds.length) throw new AppError("批次题目在提交期间发生变化", "IMPORT_DRAFT_SUBMIT_CONFLICT", 409);
      }
      const claimedBatch = await tx.questionImportBatch.updateMany({
        where: { id, status: "VALID", revision: checked.revision },
        data: {
          status: "IN_REVIEW", contentHash, submittedById: adminUserId, submittedAt: new Date(),
          warningsAcknowledgedAt: checked.warningRows ? new Date() : null, revision: { increment: 1 }
        }
      });
      if (claimedBatch.count !== 1) throw new AppError("导入批次在提交期间发生变化", "IMPORT_BATCH_REVISION_CONFLICT", 409);
      await tx.adminAuditLog.create({
        data: this.auditData(adminUserId, "import.submit", "question_import_batch", id, null, { draftIds, contentHash }, requestId)
      });
    });
    return this.getBatch(id);
  }

  async reviewBatch(adminUserId: string, id: string, decision: "APPROVED" | "REJECTED", comment?: string, requestId?: string, context: AdminReviewContext = {}) {
    const batch = await this.getBatch(id);
    if (batch.status !== "IN_REVIEW") throw new AppError("导入批次不在复核状态", "IMPORT_NOT_IN_REVIEW", 409);
    const review = await this.bank.reviewMetadata(adminUserId, batch.submittedById, decision, context);
    if (!batch.contentHash) throw new AppError("导入批次缺少冻结哈希", "IMPORT_BATCH_HASH_MISSING", 409);
    const contentHash = importBatchContentHash(batch.sourceHash, batch.rows);
    if (contentHash !== batch.contentHash) throw new AppError("导入批次冻结内容校验失败", "IMPORT_BATCH_HASH_MISMATCH", 409);
    const draftIds = Array.from(new Set(batch.rows.map((row) => row.draftId).filter((draftId): draftId is string => Boolean(draftId))));
    await this.prisma.$transaction(async (tx) => {
      if (draftIds.length) {
        const drafts = await tx.questionDraft.findMany({ where: { id: { in: draftIds } }, select: { id: true, status: true, submittedById: true, contentHash: true } });
        if (drafts.length !== draftIds.length || drafts.some((draft) => draft.status !== "IN_REVIEW" || draft.submittedById !== batch.submittedById)) {
          throw new AppError("导入批次题目草稿已发生变化", "IMPORT_DRAFT_REVIEW_CONFLICT", 409);
        }
        const claimedDrafts = await tx.questionDraft.updateMany({
          where: { id: { in: draftIds }, status: "IN_REVIEW", submittedById: batch.submittedById },
          data: { status: decision, revision: { increment: 1 } }
        });
        if (claimedDrafts.count !== draftIds.length) throw new AppError("导入批次题目草稿已被其他操作处理", "IMPORT_DRAFT_REVIEW_CONFLICT", 409);
      }
      const claimedBatch = await tx.questionImportBatch.updateMany({
        where: { id, status: "IN_REVIEW", revision: batch.revision, contentHash },
        data: { status: decision, revision: { increment: 1 } }
      });
      if (claimedBatch.count !== 1) throw new AppError("导入批次已被其他复核者处理", "IMPORT_BATCH_REVIEW_CONFLICT", 409);
      await tx.importBatchReview.create({ data: { batchId: id, reviewerId: adminUserId, decision, contentHash, comment: comment?.normalize("NFKC").trim() || null, ...review } });
      await tx.adminAuditLog.create({ data: this.auditData(adminUserId, `import.review.${decision.toLowerCase()}`, "question_import_batch", id, { status: batch.status, contentHash }, { status: decision, draftIds, contentHash, reviewMode: review.reviewMode, selfReviewNote: review.selfReviewNote }, requestId) });
    });
    return {
      ...(await this.getBatch(id)),
      reviewMode: review.reviewMode,
      selfReviewNote: review.selfReviewNote,
      checklist: review.checklist
    };
  }

  async withdrawBatch(adminUserId: string, id: string, requestId?: string) {
    const batch = await this.getBatch(id);
    if ((batch.status !== "IN_REVIEW" && batch.status !== "APPROVED") || batch.submittedById !== adminUserId) {
      throw new AppError("只能撤回自己待复核或已批准且尚未发布的导入批次", "IMPORT_BATCH_NOT_WITHDRAWABLE", 409);
    }
    const withdrawStatus: "IN_REVIEW" | "APPROVED" = batch.status;
    const draftIds = Array.from(new Set(batch.rows.map((row) => row.draftId).filter((draftId): draftId is string => Boolean(draftId))));
    await this.prisma.$transaction(async (tx) => {
      if (draftIds.length) {
        const claimedDrafts = await tx.questionDraft.updateMany({
          where: { id: { in: draftIds }, status: withdrawStatus, submittedById: adminUserId },
          data: {
            status: "DRAFT",
            submittedById: null,
            submittedAt: null,
            warningsAcknowledgedAt: null,
            revision: { increment: 1 }
          }
        });
        if (claimedDrafts.count !== draftIds.length) throw new AppError("批次题目撤回时发生变化", "IMPORT_BATCH_WITHDRAW_CONFLICT", 409);
      }
      const claimedBatch = await tx.questionImportBatch.updateMany({
        where: { id, status: withdrawStatus, revision: batch.revision, submittedById: adminUserId },
        data: {
          status: "VALID",
          contentHash: null,
          submittedById: null,
          submittedAt: null,
          warningsAcknowledgedAt: null,
          revision: { increment: 1 }
        }
      });
      if (claimedBatch.count !== 1) throw new AppError("导入批次撤回时发生变化", "IMPORT_BATCH_WITHDRAW_CONFLICT", 409);
      await tx.adminAuditLog.create({ data: this.auditData(adminUserId, "import.withdraw", "question_import_batch", id, { status: batch.status }, { status: "VALID", draftIds }, requestId) });
    });
    return this.getBatch(id);
  }

  private async activeReleaseSnapshot(): Promise<ExportSnapshot | null> {
    const state = await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } });
    if (!state) return null;
    const release = state.activeRelease;
    if (!release || release.status !== "PUBLISHED" || !release.snapshotKey || !release.snapshotHash) {
      throw new AppError("当前发布缺少可导出的题库快照", "EXPORT_RELEASE_INVALID", 503);
    }
    const body = await this.storage.get(release.snapshotKey);
    if (body.length < 2 || body[body.length - 1] !== 0x0a) {
      throw new AppError("当前发布快照缺少规范结束标记", "EXPORT_SNAPSHOT_HASH_MISMATCH", 503);
    }
    const payload = body.subarray(0, body.length - 1);
    const hash = createHash("sha256").update(payload).digest("hex");
    if (hash !== release.snapshotHash) {
      throw new AppError("当前发布快照的原始字节或 SHA-256 校验失败", "EXPORT_SNAPSHOT_HASH_MISMATCH", 503);
    }
    let snapshot: ExportSnapshot;
    try { snapshot = JSON.parse(payload.toString("utf8")) as ExportSnapshot; }
    catch { throw new AppError("当前发布快照不是有效 JSON", "EXPORT_SNAPSHOT_INVALID", 503); }
    return snapshot;
  }

  async exportPublished(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "趣刷题喽题库管理";
    const sheets = createWorkbookStructure(workbook);
    const snapshot = await this.activeReleaseSnapshot();
    let subjects: Array<{ id: string; name: string; shortName: string; color: string; description: string | null; qualityPolicy?: unknown }>;
    let chapters: Array<{ id: string; subjectId: string; name: string; description: string | null }>;
    let questions: ExportQuestion[];
    let mediaAssets: Array<{ id: string; src: string; sha256: string }>;
    if (snapshot) {
      subjects = snapshot.subjects.filter((subject) => subject.active);
      chapters = snapshot.chapters.filter((chapter) => chapter.active);
      questions = snapshot.questions.filter((question) => question.status === "ACTIVE");
      mediaAssets = (snapshot.media || []).map((asset) => ({ id: asset.id, src: asset.src, sha256: asset.sha256 }));
    } else {
      const [storedSubjects, storedChapters, storedQuestions, storedMedia] = await Promise.all([
        this.prisma.subject.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
        this.prisma.chapter.findMany({ where: { active: true }, orderBy: [{ subjectId: "asc" }, { order: "asc" }] }),
        this.prisma.question.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" }, include: { currentVersion: { include: { options: { orderBy: { position: "asc" } } } } } }),
        this.prisma.mediaAsset.findMany({ where: { status: "READY" }, orderBy: { createdAt: "asc" } })
      ]);
      subjects = storedSubjects;
      chapters = storedChapters;
      questions = storedQuestions.flatMap((question) => question.currentVersion ? [{
        id: question.id,
        externalCode: question.externalCode,
        subjectId: question.subjectId,
        chapterId: question.chapterId,
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
      }] : []);
      mediaAssets = storedMedia.filter((asset) => asset.publicUrl && asset.sha256).map((asset) => ({ id: asset.id, src: asset.publicUrl!, sha256: asset.sha256! }));
    }
    subjects.forEach((subject) => sheets.subjects.addRow([
      subject.id,
      subject.name,
      subject.shortName,
      subject.color,
      subject.description || "",
      subject.qualityPolicy ? JSON.stringify(subject.qualityPolicy) : ""
    ]));
    chapters.forEach((chapter) => sheets.chapters.addRow([chapter.id, chapter.subjectId, chapter.name, chapter.description || ""]));
    const imageMetadata = new Map<string, { alt: string; caption: string }>();
    questions.forEach((question) => {
      const config = question.answerConfig && typeof question.answerConfig === "object" && !Array.isArray(question.answerConfig)
        ? question.answerConfig as { caseSensitive?: boolean; punctuationSensitive?: boolean }
        : {};
      const images = Array.isArray(question.images) ? question.images as Array<{ src: string; alt?: string; caption?: string }> : [];
      images.forEach((image) => {
        if (image.src && !imageMetadata.has(image.src)) imageMetadata.set(image.src, { alt: image.alt || "题图资源", caption: image.caption || "" });
      });
      sheets.questions.addRow([
        question.id, question.externalCode || "", question.subjectId, question.chapterId, question.type.toLowerCase(), question.stem, question.code || "", question.explanation,
        question.difficulty, jsonArray(question.tags).map(String).join("|"), jsonArray(question.examScopes).map(String).join("|"), jsonArray(question.correctOptionIds).map(String).join("|"),
        JSON.stringify(question.acceptedAnswers), config.caseSensitive ? "yes" : "no", config.punctuationSensitive ? "yes" : "no", question.referenceAnswer || "", JSON.stringify(question.images)
      ]);
      question.options.forEach((option) => sheets.options.addRow([question.externalCode || question.id, option.id, option.label, option.text, option.position + 1]));
      const acceptedAnswers = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers as string[][] : [];
      acceptedAnswers.forEach((answers, blankIndex) => answers.forEach((answer) => sheets.fillAnswers.addRow([question.externalCode || question.id, blankIndex + 1, answer])));
    });
    mediaAssets.forEach((asset) => {
      const metadata = imageMetadata.get(asset.src);
      sheets.media.addRow([asset.id, asset.src, metadata?.alt || "题图资源", metadata?.caption || "", asset.sha256]);
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
