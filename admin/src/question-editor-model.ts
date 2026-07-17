export const MANAGED_QUESTION_TYPES = ["SINGLE", "MULTIPLE", "JUDGE", "FILL_BLANK", "SHORT_ANSWER"] as const;

export type ManagedQuestionType = typeof MANAGED_QUESTION_TYPES[number];
export type QuestionDifficulty = 1 | 2 | 3;

export interface QuestionEditorOption {
  id: string;
  label: string;
  text: string;
}

export interface QuestionEditorImage {
  src: string;
  alt: string;
  caption?: string;
}

export interface QuestionAnswerConfig {
  caseSensitive: boolean;
  punctuationSensitive: boolean;
}

/**
 * The canonical, UI-friendly question state. It deliberately differs from the
 * API at the two places where a visual editor benefits from stronger concepts:
 * accepted answer groups and the 408 checkbox.
 */
export interface QuestionEditorState {
  questionId: string | null;
  externalCode: string;
  subjectId: string;
  chapterId: string;
  type: ManagedQuestionType;
  stem: string;
  code: string;
  explanation: string;
  difficulty: QuestionDifficulty;
  tags: string[];
  images: QuestionEditorImage[];
  includeIn408: boolean;
  options: QuestionEditorOption[];
  correctOptionIds: string[];
  acceptedAnswerGroups: string[][];
  answerConfig: QuestionAnswerConfig;
  referenceAnswer: string;
}

export interface QuestionApiPayload {
  questionId?: string;
  externalCode: string | null;
  subjectId: string;
  chapterId: string;
  type: ManagedQuestionType;
  stem: string;
  code: string | null;
  explanation: string;
  difficulty: QuestionDifficulty;
  tags: string[];
  images: QuestionEditorImage[];
  examScopes: string[];
  options: QuestionEditorOption[];
  correctOptionIds: string[];
  acceptedAnswers: string[][];
  answerConfig: QuestionAnswerConfig;
  referenceAnswer: string | null;
}

export interface QuestionEditorValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type AdvancedQuestionApplyResult =
  | ({ ok: true; state: QuestionEditorState } & QuestionEditorValidation)
  | { ok: false; errors: string[]; warnings: string[] };

export interface QuestionPreviewData {
  type: ManagedQuestionType;
  typeLabel: string;
  stem: string;
  code: string | null;
  difficulty: QuestionDifficulty;
  difficultyLabel: string;
  tags: string[];
  images: QuestionEditorImage[];
  options: Array<QuestionEditorOption & { correct: boolean }>;
  fillBlankCount: number;
  acceptedAnswerGroups: string[][];
  referenceAnswer: string | null;
  explanation: string;
  includeIn408: boolean;
  answerSummary: string;
}

export const QUESTION_TYPE_LABELS: Record<ManagedQuestionType, string> = {
  SINGLE: "单选题",
  MULTIPLE: "多选题",
  JUDGE: "判断题",
  FILL_BLANK: "填空题",
  SHORT_ANSWER: "简答题"
};

export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  1: "基础",
  2: "进阶",
  3: "挑战"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function cleanOptionalString(value: unknown): string | null {
  const result = cleanString(value).trim();
  return result || null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanString(item).normalize("NFKC").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function questionType(value: unknown): ManagedQuestionType {
  const normalized = cleanString(value).toUpperCase();
  return MANAGED_QUESTION_TYPES.includes(normalized as ManagedQuestionType)
    ? normalized as ManagedQuestionType
    : "SINGLE";
}

function difficulty(value: unknown): QuestionDifficulty {
  const parsed = Number(value);
  return parsed === 2 || parsed === 3 ? parsed : 1;
}

function optionIdAt(index: number): string {
  return String.fromCharCode(65 + index);
}

function normalizeOptions(value: unknown): QuestionEditorOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((option, index) => {
    const id = cleanString(option.id ?? option.optionId).trim() || optionIdAt(index);
    return {
      id,
      label: cleanString(option.label).trim() || id,
      text: cleanString(option.text)
    };
  });
}

function normalizeAnswerGroups(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (value.every((answer) => typeof answer === "string")) return [uniqueStrings(value)];
  return value.filter(Array.isArray).map(uniqueStrings).filter((answers) => answers.length > 0);
}

function normalizeImages(value: unknown): QuestionEditorImage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((image) => ({
    src: cleanString(image.src),
    alt: cleanString(image.alt),
    ...(cleanOptionalString(image.caption) ? { caption: cleanOptionalString(image.caption)! } : {})
  }));
}

function defaultChoiceOptions(): QuestionEditorOption[] {
  return ["A", "B", "C", "D"].map((id) => ({ id, label: id, text: "" }));
}

function judgeOptions(): QuestionEditorOption[] {
  return [
    { id: "A", label: "A", text: "正确" },
    { id: "B", label: "B", text: "错误" }
  ];
}

export function createQuestionEditorState(input: Record<string, unknown> = {}): QuestionEditorState {
  const type = questionType(input.type);
  const rawOptions = normalizeOptions(input.options);
  const options = type === "JUDGE"
    ? judgeOptions()
    : type === "SINGLE" || type === "MULTIPLE"
      ? (rawOptions.length ? rawOptions : defaultChoiceOptions())
      : [];
  const config = isRecord(input.answerConfig) ? input.answerConfig : {};
  const scopes = uniqueStrings(input.examScopes);
  const acceptedAnswers = input.acceptedAnswerGroups ?? input.acceptedAnswers;
  const state: QuestionEditorState = {
    questionId: cleanOptionalString(input.questionId),
    externalCode: cleanString(input.externalCode),
    subjectId: cleanString(input.subjectId),
    chapterId: cleanString(input.chapterId),
    type,
    stem: cleanString(input.stem),
    code: cleanString(input.code),
    explanation: cleanString(input.explanation),
    difficulty: difficulty(input.difficulty),
    tags: uniqueStrings(input.tags),
    images: normalizeImages(input.images),
    includeIn408: input.includeIn408 === true || scopes.includes("408"),
    options,
    correctOptionIds: uniqueStrings(input.correctOptionIds).filter((id) => options.some((option) => option.id === id)),
    acceptedAnswerGroups: type === "FILL_BLANK" ? normalizeAnswerGroups(acceptedAnswers) : [],
    answerConfig: {
      caseSensitive: Boolean(config.caseSensitive),
      punctuationSensitive: Boolean(config.punctuationSensitive)
    },
    referenceAnswer: type === "SHORT_ANSWER" ? cleanString(input.referenceAnswer) : ""
  };
  return enforceQuestionType(state, type);
}

export function questionStateFromApiPayload(input: unknown): QuestionEditorState {
  if (!isRecord(input)) throw new TypeError("题目数据必须是 JSON 对象");
  return createQuestionEditorState(input);
}

export function questionStateToApiPayload(state: QuestionEditorState): QuestionApiPayload {
  const normalized = enforceQuestionType(createQuestionEditorState({
    ...state,
    acceptedAnswers: state.acceptedAnswerGroups,
    examScopes: state.includeIn408 ? ["408"] : []
  }), state.type);
  return {
    ...(normalized.questionId ? { questionId: normalized.questionId } : {}),
    externalCode: cleanOptionalString(normalized.externalCode),
    subjectId: normalized.subjectId.trim(),
    chapterId: normalized.chapterId.trim(),
    type: normalized.type,
    stem: normalized.stem.trim(),
    code: cleanOptionalString(normalized.code),
    explanation: normalized.explanation.trim(),
    difficulty: normalized.difficulty,
    tags: uniqueStrings(normalized.tags),
    images: normalized.images.map((image) => ({
      src: image.src.trim(),
      alt: image.alt.normalize("NFKC").trim(),
      ...(cleanOptionalString(image.caption) ? { caption: cleanOptionalString(image.caption)! } : {})
    })),
    examScopes: normalized.includeIn408 ? ["408"] : [],
    options: normalized.options.map((option) => ({
      id: option.id.trim(),
      label: option.label.trim(),
      text: option.text.normalize("NFKC").trim()
    })),
    correctOptionIds: uniqueStrings(normalized.correctOptionIds),
    acceptedAnswers: normalized.acceptedAnswerGroups.map(uniqueStrings),
    answerConfig: { ...normalized.answerConfig },
    referenceAnswer: cleanOptionalString(normalized.referenceAnswer)
  };
}

export function enforceQuestionType(state: QuestionEditorState, nextType: ManagedQuestionType): QuestionEditorState {
  const type = questionType(nextType);
  if (type === "JUDGE") {
    const ids = new Set(["A", "B"]);
    return {
      ...state,
      type,
      options: judgeOptions(),
      correctOptionIds: state.correctOptionIds.filter((id) => ids.has(id)).slice(0, 1),
      acceptedAnswerGroups: [],
      referenceAnswer: ""
    };
  }
  if (type === "SINGLE" || type === "MULTIPLE") {
    const options = state.options.length ? state.options : defaultChoiceOptions();
    const optionIds = new Set(options.map((option) => option.id));
    const correct = state.correctOptionIds.filter((id) => optionIds.has(id));
    return {
      ...state,
      type,
      options,
      correctOptionIds: type === "SINGLE" ? correct.slice(0, 1) : correct,
      acceptedAnswerGroups: [],
      referenceAnswer: ""
    };
  }
  return {
    ...state,
    type,
    options: [],
    correctOptionIds: [],
    acceptedAnswerGroups: type === "FILL_BLANK" ? state.acceptedAnswerGroups : [],
    referenceAnswer: type === "SHORT_ANSWER" ? state.referenceAnswer : ""
  };
}

export function addQuestionOption(state: QuestionEditorState): QuestionEditorState {
  if (!(["SINGLE", "MULTIPLE"] as ManagedQuestionType[]).includes(state.type) || state.options.length >= 6) return state;
  const used = new Set(state.options.map((option) => option.id));
  let index = 0;
  while (used.has(optionIdAt(index))) index += 1;
  const id = optionIdAt(index);
  return { ...state, options: [...state.options, { id, label: id, text: "" }] };
}

export function updateQuestionOption(
  state: QuestionEditorState,
  optionId: string,
  changes: Partial<Pick<QuestionEditorOption, "label" | "text">>
): QuestionEditorState {
  return {
    ...state,
    options: state.options.map((option) => option.id === optionId ? { ...option, ...changes } : option)
  };
}

export function removeQuestionOption(state: QuestionEditorState, optionId: string): QuestionEditorState {
  if (state.type === "JUDGE" || state.options.length <= 2) return state;
  return {
    ...state,
    options: state.options.filter((option) => option.id !== optionId),
    correctOptionIds: state.correctOptionIds.filter((id) => id !== optionId)
  };
}

export function toggleCorrectOption(state: QuestionEditorState, optionId: string): QuestionEditorState {
  if (!state.options.some((option) => option.id === optionId)) return state;
  if (state.type === "MULTIPLE") {
    const selected = state.correctOptionIds.includes(optionId)
      ? state.correctOptionIds.filter((id) => id !== optionId)
      : [...state.correctOptionIds, optionId];
    return { ...state, correctOptionIds: selected };
  }
  if (state.type === "SINGLE" || state.type === "JUDGE") return { ...state, correctOptionIds: [optionId] };
  return state;
}

export function addAcceptedAnswerGroup(state: QuestionEditorState): QuestionEditorState {
  if (state.type !== "FILL_BLANK") return state;
  return { ...state, acceptedAnswerGroups: [...state.acceptedAnswerGroups, [""]] };
}

export function updateAcceptedAnswerGroup(state: QuestionEditorState, groupIndex: number, answers: string[]): QuestionEditorState {
  if (state.type !== "FILL_BLANK" || !state.acceptedAnswerGroups[groupIndex]) return state;
  return {
    ...state,
    acceptedAnswerGroups: state.acceptedAnswerGroups.map((group, index) => index === groupIndex ? [...answers] : group)
  };
}

export function removeAcceptedAnswerGroup(state: QuestionEditorState, groupIndex: number): QuestionEditorState {
  if (state.type !== "FILL_BLANK") return state;
  return { ...state, acceptedAnswerGroups: state.acceptedAnswerGroups.filter((_group, index) => index !== groupIndex) };
}

export function validateQuestionEditorState(state: QuestionEditorState): QuestionEditorValidation {
  const payload = questionStateToApiPayload(state);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!payload.subjectId) errors.push("请选择学科");
  if (!payload.chapterId) errors.push("请选择章节");
  if (payload.stem.length < 4) errors.push("题干至少需要 4 个字符");
  if (payload.explanation.length < 8) errors.push("解析至少需要 8 个字符");
  else if (payload.explanation.length < 20) warnings.push("解析较短，建议补充关键推理或易错点");
  if (!payload.tags.length) warnings.push("建议至少设置一个标签");
  if (payload.images.length > 2) errors.push("每题最多允许两张图片");
  payload.images.forEach((image, index) => {
    if (!image.src || !image.alt) errors.push(`第 ${index + 1} 张图片缺少地址或替代说明`);
  });
  if (payload.examScopes.includes("408") && payload.type !== "SINGLE") warnings.push("只有单选题会进入 408 组卷候选池");

  const choice = payload.type === "SINGLE" || payload.type === "MULTIPLE" || payload.type === "JUDGE";
  if (choice) {
    if (payload.options.length < 2 || payload.options.length > 6) errors.push("选择题必须有 2 至 6 个选项");
    const ids = payload.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !id)) errors.push("选项 ID 不能为空或重复");
    if (payload.options.some((option) => !option.label || !option.text)) errors.push("选项标签和内容不能为空");
    if (payload.correctOptionIds.some((id) => !ids.includes(id))) errors.push("正确答案必须引用已有选项");
    if (payload.type === "MULTIPLE" && payload.correctOptionIds.length < 2) errors.push("多选题至少需要两个正确选项");
    if (payload.type !== "MULTIPLE" && payload.correctOptionIds.length !== 1) errors.push("单选题和判断题必须且只能有一个正确选项");
    if (payload.type === "JUDGE" && payload.options.length !== 2) errors.push("判断题必须且只能有两个选项");
  }
  if (payload.type === "FILL_BLANK" && (!payload.acceptedAnswers.length || payload.acceptedAnswers.some((group) => !group.length))) {
    errors.push("填空题每个空都必须配置至少一个可接受答案");
  }
  if (payload.type === "SHORT_ANSWER" && (!payload.referenceAnswer || payload.referenceAnswer.length < 4)) {
    errors.push("简答题必须配置至少 4 个字符的参考答案");
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function serializeAdvancedQuestionJson(state: QuestionEditorState): string {
  return JSON.stringify(questionStateToApiPayload(state), null, 2);
}

function validateAdvancedQuestionShape(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const allowed = new Set([
    "questionId", "externalCode", "subjectId", "chapterId", "type", "stem", "code", "explanation", "difficulty",
    "tags", "images", "examScopes", "options", "correctOptionIds", "acceptedAnswers", "answerConfig", "referenceAnswer"
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) errors.push(`题目 JSON 包含未知字段：${unknown.join("、")}`);
  for (const key of ["subjectId", "chapterId", "stem", "explanation"] as const) {
    if (typeof input[key] !== "string") errors.push(`${key} 必须是字符串`);
  }
  for (const key of ["questionId", "externalCode", "code", "referenceAnswer"] as const) {
    if (input[key] !== undefined && input[key] !== null && typeof input[key] !== "string") errors.push(`${key} 必须是字符串或 null`);
  }
  if (!Number.isInteger(input.difficulty)) errors.push("difficulty 必须是整数");
  for (const key of ["tags", "images", "examScopes", "options", "correctOptionIds", "acceptedAnswers"] as const) {
    if (!Array.isArray(input[key])) errors.push(`${key} 必须是数组`);
  }
  for (const key of ["tags", "examScopes", "correctOptionIds"] as const) {
    if (Array.isArray(input[key]) && input[key].some((item) => typeof item !== "string")) errors.push(`${key} 只能包含字符串`);
  }
  if (Array.isArray(input.options)) {
    input.options.forEach((option, index) => {
      if (!isRecord(option)) {
        errors.push(`options[${index}] 必须是对象`);
        return;
      }
      if (typeof (option.id ?? option.optionId) !== "string" || typeof option.label !== "string" || typeof option.text !== "string") {
        errors.push(`options[${index}] 必须包含字符串 id、label 和 text`);
      }
    });
  }
  if (Array.isArray(input.images)) {
    input.images.forEach((image, index) => {
      if (!isRecord(image)) {
        errors.push(`images[${index}] 必须是对象`);
        return;
      }
      if (typeof image.src !== "string" || typeof image.alt !== "string") errors.push(`images[${index}] 必须包含字符串 src 和 alt`);
      if (image.caption !== undefined && typeof image.caption !== "string") errors.push(`images[${index}].caption 必须是字符串`);
    });
  }
  if (Array.isArray(input.acceptedAnswers)) {
    const flatStrings = input.acceptedAnswers.every((item) => typeof item === "string");
    const nestedStrings = input.acceptedAnswers.every((item) => Array.isArray(item) && item.every((answer) => typeof answer === "string"));
    if (!flatStrings && !nestedStrings) errors.push("acceptedAnswers 必须是字符串数组或字符串二维数组");
  }
  if (!isRecord(input.answerConfig)) errors.push("answerConfig 必须是对象");
  else {
    const unknownConfig = Object.keys(input.answerConfig).filter((key) => !["caseSensitive", "punctuationSensitive"].includes(key));
    if (unknownConfig.length) errors.push(`answerConfig 包含未知字段：${unknownConfig.join("、")}`);
    for (const key of ["caseSensitive", "punctuationSensitive"] as const) {
      if (input.answerConfig[key] !== undefined && typeof input.answerConfig[key] !== "boolean") errors.push(`answerConfig.${key} 必须是布尔值`);
    }
  }
  return errors;
}

export function applyAdvancedQuestionJson(text: string): AdvancedQuestionApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 格式错误：${error instanceof Error ? error.message : String(error)}`], warnings: [] };
  }
  if (!isRecord(parsed)) return { ok: false, errors: ["题目 JSON 顶层必须是对象"], warnings: [] };
  const shapeErrors = validateAdvancedQuestionShape(parsed);
  if (shapeErrors.length) return { ok: false, errors: shapeErrors, warnings: [] };
  const rawType = cleanString(parsed.type).toUpperCase();
  if (!MANAGED_QUESTION_TYPES.includes(rawType as ManagedQuestionType)) {
    return { ok: false, errors: ["type 必须是 SINGLE、MULTIPLE、JUDGE、FILL_BLANK 或 SHORT_ANSWER"], warnings: [] };
  }
  const state = questionStateFromApiPayload(parsed);
  const validation = validateQuestionEditorState(state);
  if (!validation.valid) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  return { ok: true, state, ...validation };
}

export function buildQuestionPreview(state: QuestionEditorState): QuestionPreviewData {
  const payload = questionStateToApiPayload(state);
  const answerSummary = payload.type === "FILL_BLANK"
    ? payload.acceptedAnswers.map((answers, index) => `第 ${index + 1} 空：${answers.join(" / ")}`).join("；")
    : payload.type === "SHORT_ANSWER"
      ? payload.referenceAnswer || "尚未填写参考答案"
      : payload.correctOptionIds.length ? `正确选项：${payload.correctOptionIds.join("、")}` : "尚未设置正确选项";
  return {
    type: payload.type,
    typeLabel: QUESTION_TYPE_LABELS[payload.type],
    stem: payload.stem,
    code: payload.code,
    difficulty: payload.difficulty,
    difficultyLabel: QUESTION_DIFFICULTY_LABELS[payload.difficulty],
    tags: payload.tags,
    images: payload.images,
    options: payload.options.map((option) => ({ ...option, correct: payload.correctOptionIds.includes(option.id) })),
    fillBlankCount: payload.acceptedAnswers.length,
    acceptedAnswerGroups: payload.acceptedAnswers,
    referenceAnswer: payload.referenceAnswer,
    explanation: payload.explanation,
    includeIn408: payload.examScopes.includes("408"),
    answerSummary
  };
}
