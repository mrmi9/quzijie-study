export const QUALITY_QUESTION_TYPES = ["SINGLE", "MULTIPLE", "JUDGE", "FILL_BLANK", "SHORT_ANSWER"] as const;
export const QUALITY_DIFFICULTIES = ["1", "2", "3"] as const;

export type QualityQuestionType = typeof QUALITY_QUESTION_TYPES[number];
export type QualityDifficulty = typeof QUALITY_DIFFICULTIES[number];
export type QualityDimension = "questionTypes" | "difficulties" | "chapters";

export interface QualityTargetRow {
  key: string;
  min: number | null;
  max: number | null;
}

export interface QualityPolicyEditorState {
  questionTypes: QualityTargetRow[];
  difficulties: QualityTargetRow[];
  chapters: QualityTargetRow[];
}

export interface QualityCountTarget {
  min?: number;
  max?: number;
}

export interface SubjectQualityPolicy {
  questionTypes?: Partial<Record<QualityQuestionType, QualityCountTarget>>;
  difficulties?: Partial<Record<QualityDifficulty, QualityCountTarget>>;
  chapters?: Record<string, QualityCountTarget>;
}

export interface QualityPolicyValidation {
  valid: boolean;
  errors: string[];
}

export type AdvancedQualityPolicyApplyResult =
  | { ok: true; state: QualityPolicyEditorState; policy: SubjectQualityPolicy | null; errors: [] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value: unknown): QualityTargetRow[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, target]) => {
    const record = isRecord(target) ? target : {};
    return {
      key,
      min: record.min === undefined || record.min === null || record.min === "" ? null : Number(record.min),
      max: record.max === undefined || record.max === null || record.max === "" ? null : Number(record.max)
    };
  });
}

export function createQualityPolicyEditorState(value: unknown = null): QualityPolicyEditorState {
  if (!isRecord(value)) return { questionTypes: [], difficulties: [], chapters: [] };
  return {
    questionTypes: rows(value.questionTypes),
    difficulties: rows(value.difficulties),
    chapters: rows(value.chapters)
  };
}

function validateRow(dimension: QualityDimension, row: QualityTargetRow, index: number): string[] {
  const errors: string[] = [];
  const label = `${dimension}.${row.key || index + 1}`;
  const key = row.key.normalize("NFKC").trim();
  if (!key) errors.push(`${label} 缺少项目名称`);
  if (dimension === "questionTypes" && !QUALITY_QUESTION_TYPES.includes(key.toUpperCase() as QualityQuestionType)) {
    errors.push(`${label} 不是支持的题型`);
  }
  if (dimension === "difficulties" && !QUALITY_DIFFICULTIES.includes(key as QualityDifficulty)) {
    errors.push(`${label} 不是支持的难度`);
  }
  if (dimension === "chapters" && !/^[a-z][a-z0-9-]{1,63}$/.test(key.toLowerCase())) {
    errors.push(`${label} 必须是合法章节 ID`);
  }
  if (row.min === null && row.max === null) errors.push(`${label} 至少需要填写最小值或最大值`);
  for (const [field, value] of [["min", row.min], ["max", row.max]] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100_000)) {
      errors.push(`${label}.${field} 必须是 0 到 100000 的整数`);
    }
  }
  if (row.min !== null && row.max !== null && row.min > row.max) errors.push(`${label} 的最小值不能大于最大值`);
  return errors;
}

export function validateQualityPolicyEditorState(state: QualityPolicyEditorState): QualityPolicyValidation {
  const errors: string[] = [];
  for (const dimension of ["questionTypes", "difficulties", "chapters"] as const) {
    const seen = new Set<string>();
    state[dimension].forEach((row, index) => {
      errors.push(...validateRow(dimension, row, index));
      const key = dimension === "questionTypes" ? row.key.toUpperCase() : row.key.normalize("NFKC").trim().toLowerCase();
      if (key && seen.has(key)) errors.push(`${dimension}.${row.key} 重复配置`);
      seen.add(key);
    });
  }
  return { valid: errors.length === 0, errors };
}

function target(row: QualityTargetRow): QualityCountTarget {
  return {
    ...(row.min !== null ? { min: row.min } : {}),
    ...(row.max !== null ? { max: row.max } : {})
  };
}

export function qualityPolicyStateToJson(state: QualityPolicyEditorState): SubjectQualityPolicy | null {
  const validation = validateQualityPolicyEditorState(state);
  if (!validation.valid) throw new TypeError(validation.errors.join("；"));
  const policy: SubjectQualityPolicy = {};
  if (state.questionTypes.length) {
    policy.questionTypes = Object.fromEntries(state.questionTypes.map((row) => [row.key.toUpperCase(), target(row)])) as SubjectQualityPolicy["questionTypes"];
  }
  if (state.difficulties.length) {
    policy.difficulties = Object.fromEntries(state.difficulties.map((row) => [row.key, target(row)])) as SubjectQualityPolicy["difficulties"];
  }
  if (state.chapters.length) {
    policy.chapters = Object.fromEntries(state.chapters.map((row) => [row.key.normalize("NFKC").trim().toLowerCase(), target(row)]));
  }
  return Object.keys(policy).length ? policy : null;
}

export function qualityPolicyStateFromJson(value: unknown): QualityPolicyEditorState {
  const state = createQualityPolicyEditorState(value);
  const validation = validateQualityPolicyEditorState(state);
  if (!validation.valid) throw new TypeError(validation.errors.join("；"));
  return createQualityPolicyEditorState(qualityPolicyStateToJson(state));
}

export function serializeAdvancedQualityPolicyJson(state: QualityPolicyEditorState): string {
  return JSON.stringify(qualityPolicyStateToJson(state), null, 2);
}

export function applyAdvancedQualityPolicyJson(text: string): AdvancedQualityPolicyApplyResult {
  const trimmed = text.trim();
  if (!trimmed) {
    const state = createQualityPolicyEditorState();
    return { ok: true, state, policy: null, errors: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, errors: [`JSON 格式错误：${error instanceof Error ? error.message : String(error)}`] };
  }
  if (parsed !== null && !isRecord(parsed)) return { ok: false, errors: ["质量策略 JSON 顶层必须是对象或 null"] };
  const allowed = new Set(["questionTypes", "difficulties", "chapters"]);
  const unknownKeys = parsed && isRecord(parsed) ? Object.keys(parsed).filter((key) => !allowed.has(key)) : [];
  if (unknownKeys.length) return { ok: false, errors: [`质量策略包含未知字段：${unknownKeys.join("、")}`] };
  if (parsed && isRecord(parsed)) {
    const shapeErrors: string[] = [];
    for (const dimension of ["questionTypes", "difficulties", "chapters"] as const) {
      const rawDimension = parsed[dimension];
      if (rawDimension === undefined) continue;
      if (!isRecord(rawDimension)) {
        shapeErrors.push(`${dimension} 必须是 JSON 对象`);
        continue;
      }
      for (const [key, rawTarget] of Object.entries(rawDimension)) {
        if (!isRecord(rawTarget)) {
          shapeErrors.push(`${dimension}.${key} 必须是 JSON 对象`);
          continue;
        }
        const unknownTargetKeys = Object.keys(rawTarget).filter((field) => !["min", "max"].includes(field));
        if (unknownTargetKeys.length) shapeErrors.push(`${dimension}.${key} 包含未知字段：${unknownTargetKeys.join("、")}`);
      }
    }
    if (shapeErrors.length) return { ok: false, errors: shapeErrors };
  }
  const state = createQualityPolicyEditorState(parsed);
  const validation = validateQualityPolicyEditorState(state);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  const policy = qualityPolicyStateToJson(state);
  return { ok: true, state: createQualityPolicyEditorState(policy), policy, errors: [] };
}

export function upsertQualityTarget(
  state: QualityPolicyEditorState,
  dimension: QualityDimension,
  key: string,
  values: { min?: number | null; max?: number | null }
): QualityPolicyEditorState {
  const normalizedKey = dimension === "questionTypes" ? key.toUpperCase() : key.normalize("NFKC").trim().toLowerCase();
  const existing = state[dimension].find((row) => {
    const rowKey = dimension === "questionTypes" ? row.key.toUpperCase() : row.key.normalize("NFKC").trim().toLowerCase();
    return rowKey === normalizedKey;
  });
  const next: QualityTargetRow = {
    key: normalizedKey,
    min: values.min === undefined ? existing?.min ?? null : values.min,
    max: values.max === undefined ? existing?.max ?? null : values.max
  };
  return {
    ...state,
    [dimension]: existing
      ? state[dimension].map((row) => row === existing ? next : row)
      : [...state[dimension], next]
  };
}

export function removeQualityTarget(
  state: QualityPolicyEditorState,
  dimension: QualityDimension,
  key: string
): QualityPolicyEditorState {
  const normalizedKey = dimension === "questionTypes" ? key.toUpperCase() : key.normalize("NFKC").trim().toLowerCase();
  return {
    ...state,
    [dimension]: state[dimension].filter((row) => {
      const rowKey = dimension === "questionTypes" ? row.key.toUpperCase() : row.key.normalize("NFKC").trim().toLowerCase();
      return rowKey !== normalizedKey;
    })
  };
}
