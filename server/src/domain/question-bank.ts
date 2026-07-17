import { createHash, randomBytes } from "node:crypto";

export type ManagedQuestionType = "SINGLE" | "MULTIPLE" | "JUDGE" | "FILL_BLANK" | "SHORT_ANSWER";

export interface ManagedOption {
  id: string;
  label: string;
  text: string;
}

export interface AnswerConfig {
  caseSensitive?: boolean;
  punctuationSensitive?: boolean;
}

export interface DraftQuestionInput {
  questionId?: string;
  externalCode?: string | null;
  subjectId: string;
  chapterId: string;
  type: ManagedQuestionType | Lowercase<ManagedQuestionType>;
  stem: string;
  code?: string | null;
  explanation: string;
  difficulty: number;
  tags?: string[];
  images?: Array<{ src: string; alt: string; caption?: string }>;
  examScopes?: string[];
  correctOptionIds?: string[];
  acceptedAnswers?: string[] | string[][];
  answerConfig?: AnswerConfig;
  referenceAnswer?: string | null;
  options?: ManagedOption[];
}

export interface NormalizedDraftQuestion {
  externalCode: string | null;
  subjectId: string;
  chapterId: string;
  type: ManagedQuestionType;
  stem: string;
  code: string | null;
  explanation: string;
  difficulty: number;
  tags: string[];
  images: Array<{ src: string; alt: string; caption?: string }>;
  examScopes: string[];
  correctOptionIds: string[];
  acceptedAnswers: string[][];
  answerConfig: AnswerConfig;
  referenceAnswer: string | null;
  options: ManagedOption[];
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function questionContentHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function questionTextSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]/gu, "");
  const bigrams = (value: string) => {
    const normalized = normalize(value);
    if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
    return new Set(Array.from({ length: normalized.length - 1 }, (_item, index) => normalized.slice(index, index + 2)));
  };
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const overlap = Array.from(a).filter((item) => b.has(item)).length;
  return (2 * overlap) / (a.size + b.size);
}

export function generateQuestionId(): string {
  return `q_${Date.now().toString(36)}_${randomBytes(7).toString("base64url")}`.slice(0, 32);
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((item) => String(item).normalize("NFKC").trim()).filter(Boolean)));
}

function normalizeAcceptedAnswers(value: DraftQuestionInput["acceptedAnswers"]): string[][] {
  if (!Array.isArray(value) || !value.length) return [];
  if (value.every((item) => typeof item === "string")) return [uniqueStrings(value)];
  return value.map((item) => uniqueStrings(item)).filter((item) => item.length > 0);
}

export function normalizeDraftQuestion(input: DraftQuestionInput): NormalizedDraftQuestion {
  const type = String(input.type || "").toUpperCase() as ManagedQuestionType;
  return {
    externalCode: input.externalCode ? String(input.externalCode).normalize("NFKC").trim() : null,
    subjectId: String(input.subjectId || "").normalize("NFKC").trim(),
    chapterId: String(input.chapterId || "").normalize("NFKC").trim(),
    type,
    stem: String(input.stem || "").normalize("NFKC").trim(),
    code: input.code ? String(input.code).replace(/\r\n/g, "\n").trimEnd() : null,
    explanation: String(input.explanation || "").normalize("NFKC").trim(),
    difficulty: Number(input.difficulty),
    tags: uniqueStrings(input.tags),
    images: Array.isArray(input.images) ? input.images.map((image) => ({
      src: String(image.src || "").trim(),
      alt: String(image.alt || "").normalize("NFKC").trim(),
      ...(image.caption ? { caption: String(image.caption).normalize("NFKC").trim() } : {})
    })) : [],
    examScopes: uniqueStrings(input.examScopes),
    correctOptionIds: uniqueStrings(input.correctOptionIds),
    acceptedAnswers: normalizeAcceptedAnswers(input.acceptedAnswers),
    answerConfig: {
      caseSensitive: Boolean(input.answerConfig?.caseSensitive),
      punctuationSensitive: Boolean(input.answerConfig?.punctuationSensitive)
    },
    referenceAnswer: input.referenceAnswer ? String(input.referenceAnswer).normalize("NFKC").trim() : null,
    options: Array.isArray(input.options) ? input.options.map((option) => ({
      id: String(option.id || "").trim(),
      label: String(option.label || "").trim(),
      text: String(option.text || "").normalize("NFKC").trim()
    })) : []
  };
}

export function validateDraftQuestion(value: NormalizedDraftQuestion): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!value.subjectId) errors.push("缺少学科");
  if (!value.chapterId) errors.push("缺少章节");
  if (!["SINGLE", "MULTIPLE", "JUDGE", "FILL_BLANK", "SHORT_ANSWER"].includes(value.type)) errors.push("题型无效");
  if (value.stem.length < 4) errors.push("题干至少需要 4 个字符");
  if (value.explanation.length < 8) errors.push("解析至少需要 8 个字符");
  else if (value.explanation.length < 20) warnings.push("解析较短，建议补充关键推理或易错点");
  if (![1, 2, 3].includes(value.difficulty)) errors.push("难度只能为 1、2 或 3");
  if (!value.tags.length) warnings.push("建议至少设置一个标签");
  if (value.images.length > 2) errors.push("每题最多允许两张图片");
  value.images.forEach((image, index) => {
    if (!image.src || !image.alt) errors.push(`第 ${index + 1} 张图片缺少地址或替代说明`);
  });
  if (value.examScopes.some((scope) => scope !== "408")) errors.push("考试范围目前只允许 408");
  if (value.examScopes.includes("408") && value.type !== "SINGLE") warnings.push("该题不是单选题，不会进入 408 组卷候选池");

  const choice = ["SINGLE", "MULTIPLE", "JUDGE"].includes(value.type);
  if (choice) {
    if (value.options.length < 2 || value.options.length > 6) errors.push("选择题必须有 2 至 6 个选项");
    const optionIds = value.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length || optionIds.some((id) => !id)) errors.push("选项 ID 不能为空或重复");
    if (value.options.some((option) => !option.label || !option.text)) errors.push("选项标签和内容不能为空");
    if (value.correctOptionIds.some((id) => !optionIds.includes(id))) errors.push("正确答案必须引用已存在的选项");
    if (value.type === "MULTIPLE" && value.correctOptionIds.length < 2) errors.push("多选题至少需要两个正确选项");
    if (value.type !== "MULTIPLE" && value.correctOptionIds.length !== 1) errors.push("单选和判断题必须只有一个正确选项");
    if (value.type === "JUDGE" && value.options.length !== 2) errors.push("判断题必须只有两个选项");
  } else if (value.options.length || value.correctOptionIds.length) {
    errors.push("填空题和简答题不能配置选择项答案");
  }
  if (value.type === "FILL_BLANK" && (!value.acceptedAnswers.length || value.acceptedAnswers.some((answers) => !answers.length))) {
    errors.push("填空题每个空都必须配置至少一个可接受答案");
  }
  if (value.type === "SHORT_ANSWER" && (!value.referenceAnswer || value.referenceAnswer.length < 4)) {
    errors.push("简答题必须配置参考答案");
  }
  if (value.type !== "FILL_BLANK" && value.acceptedAnswers.length) errors.push("只有填空题可以配置可接受答案");
  if (value.type !== "SHORT_ANSWER" && value.referenceAnswer) warnings.push("非简答题的参考答案不会展示");
  return { errors, warnings };
}

export function normalizeFillAnswer(value: string, config: AnswerConfig = {}): string {
  let normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!config.caseSensitive) normalized = normalized.toLocaleLowerCase("zh-CN");
  if (!config.punctuationSensitive) normalized = normalized.replace(/[\p{P}\p{S}]/gu, "");
  return normalized;
}

export function sameFillAnswer(submitted: string[], accepted: string[][], config: AnswerConfig = {}): boolean {
  if (submitted.length !== accepted.length) return false;
  return submitted.every((answer, index) => {
    const normalized = normalizeFillAnswer(answer, config);
    return (accepted[index] || []).some((candidate) => normalizeFillAnswer(candidate, config) === normalized);
  });
}
