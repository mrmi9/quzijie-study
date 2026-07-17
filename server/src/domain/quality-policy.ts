const QUESTION_TYPES = ["SINGLE", "MULTIPLE", "JUDGE", "FILL_BLANK", "SHORT_ANSWER"] as const;
const DIFFICULTIES = ["1", "2", "3"] as const;

export type QualityQuestionType = typeof QUESTION_TYPES[number];
export type QualityDifficulty = typeof DIFFICULTIES[number];
export type QualityDimension = "questionTypes" | "difficulties" | "chapters";

export interface QualityCountTarget {
  min?: number;
  max?: number;
}

export interface SubjectQualityPolicy {
  questionTypes?: Partial<Record<QualityQuestionType, QualityCountTarget>>;
  difficulties?: Partial<Record<QualityDifficulty, QualityCountTarget>>;
  chapters?: Record<string, QualityCountTarget>;
}

export interface QualityWarning {
  subjectId: string;
  dimension: QualityDimension;
  key: string;
  actual: number;
  min?: number;
  max?: number;
  message: string;
}

export interface QualityMetricSummary extends QualityCountTarget {
  actual: number;
  status: "PASS" | "BELOW_MIN" | "ABOVE_MAX";
}

export interface SubjectQualitySummary {
  subjectId: string;
  subjectName: string;
  questionCount: number;
  policy: SubjectQualityPolicy;
  metrics: {
    questionTypes: Record<string, QualityMetricSummary>;
    difficulties: Record<string, QualityMetricSummary>;
    chapters: Record<string, QualityMetricSummary>;
  };
  warningCount: number;
}

export interface ReleaseQualityReport {
  configuredSubjectCount: number;
  warningCount: number;
  subjects: SubjectQualitySummary[];
  warnings: QualityWarning[];
}

export class QualityPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityPolicyValidationError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QualityPolicyValidationError(`${label}必须是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new QualityPolicyValidationError(`${label}包含未知字段：${unknown.join("、")}`);
}

function normalizeTarget(value: unknown, label: string): QualityCountTarget {
  const input = record(value, label);
  assertKnownKeys(input, ["min", "max"], label);
  if (input.min === undefined && input.max === undefined) {
    throw new QualityPolicyValidationError(`${label}至少需要 min 或 max`);
  }
  const result: QualityCountTarget = {};
  for (const key of ["min", "max"] as const) {
    if (input[key] === undefined) continue;
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 100_000) {
      throw new QualityPolicyValidationError(`${label}.${key}必须是 0 到 100000 的整数`);
    }
    result[key] = Number(input[key]);
  }
  if (result.min !== undefined && result.max !== undefined && result.min > result.max) {
    throw new QualityPolicyValidationError(`${label}.min 不能大于 max`);
  }
  return result;
}

function normalizeQuestionTypes(value: unknown): SubjectQualityPolicy["questionTypes"] {
  const input = record(value, "questionTypes");
  const output: NonNullable<SubjectQualityPolicy["questionTypes"]> = {};
  for (const [rawKey, target] of Object.entries(input)) {
    const key = rawKey.toUpperCase();
    if (!QUESTION_TYPES.includes(key as QualityQuestionType)) {
      throw new QualityPolicyValidationError(`questionTypes 包含未知题型：${rawKey}`);
    }
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new QualityPolicyValidationError(`questionTypes 题型重复：${rawKey}`);
    }
    output[key as QualityQuestionType] = normalizeTarget(target, `questionTypes.${key}`);
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeDifficulties(value: unknown): SubjectQualityPolicy["difficulties"] {
  const input = record(value, "difficulties");
  const output: NonNullable<SubjectQualityPolicy["difficulties"]> = {};
  for (const [key, target] of Object.entries(input)) {
    if (!DIFFICULTIES.includes(key as QualityDifficulty)) {
      throw new QualityPolicyValidationError(`difficulties 包含未知难度：${key}`);
    }
    output[key as QualityDifficulty] = normalizeTarget(target, `difficulties.${key}`);
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeChapters(value: unknown): SubjectQualityPolicy["chapters"] {
  const input = record(value, "chapters");
  const output: Record<string, QualityCountTarget> = {};
  for (const [rawKey, target] of Object.entries(input)) {
    const key = rawKey.normalize("NFKC").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(key)) {
      throw new QualityPolicyValidationError(`chapters 包含非法章节 ID：${rawKey}`);
    }
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new QualityPolicyValidationError(`chapters 章节重复：${rawKey}`);
    }
    output[key] = normalizeTarget(target, `chapters.${key}`);
  }
  return Object.keys(output).length ? output : undefined;
}

export function normalizeSubjectQualityPolicy(value: unknown): SubjectQualityPolicy | null {
  if (value === null || value === undefined || value === "") return null;
  const input = record(value, "质量策略");
  assertKnownKeys(input, ["questionTypes", "difficulties", "chapters"], "质量策略");
  const output: SubjectQualityPolicy = {};
  if (input.questionTypes !== undefined) output.questionTypes = normalizeQuestionTypes(input.questionTypes);
  if (input.difficulties !== undefined) output.difficulties = normalizeDifficulties(input.difficulties);
  if (input.chapters !== undefined) output.chapters = normalizeChapters(input.chapters);
  if (!output.questionTypes) delete output.questionTypes;
  if (!output.difficulties) delete output.difficulties;
  if (!output.chapters) delete output.chapters;
  return Object.keys(output).length ? output : null;
}

function metricStatus(actual: number, target: QualityCountTarget): QualityMetricSummary["status"] {
  if (target.min !== undefined && actual < target.min) return "BELOW_MIN";
  if (target.max !== undefined && actual > target.max) return "ABOVE_MAX";
  return "PASS";
}

function dimensionLabel(dimension: QualityDimension): string {
  if (dimension === "questionTypes") return "题型";
  if (dimension === "difficulties") return "难度";
  return "章节";
}

export function evaluateSubjectQualityPolicies(
  subjects: Array<{ id: string; name?: string | null; qualityPolicy?: unknown }>,
  questions: Array<{ subjectId: string; type: string; difficulty: number; chapterId: string }>
): ReleaseQualityReport {
  const warnings: QualityWarning[] = [];
  const summaries: SubjectQualitySummary[] = [];
  const questionsBySubject = new Map<string, typeof questions>();
  for (const question of questions) {
    const bucket = questionsBySubject.get(question.subjectId) || [];
    bucket.push(question);
    questionsBySubject.set(question.subjectId, bucket);
  }
  for (const subject of subjects) {
    const policy = normalizeSubjectQualityPolicy(subject.qualityPolicy);
    if (!policy) continue;
    const subjectQuestions = questionsBySubject.get(subject.id) || [];
    const metrics: SubjectQualitySummary["metrics"] = { questionTypes: {}, difficulties: {}, chapters: {} };
    const dimensions: Array<[QualityDimension, Record<string, QualityCountTarget> | undefined, (question: typeof subjectQuestions[number], key: string) => boolean]> = [
      ["questionTypes", policy.questionTypes as Record<string, QualityCountTarget> | undefined, (question, key) => question.type === key],
      ["difficulties", policy.difficulties as Record<string, QualityCountTarget> | undefined, (question, key) => String(question.difficulty) === key],
      ["chapters", policy.chapters, (question, key) => question.chapterId === key]
    ];
    const warningStart = warnings.length;
    for (const [dimension, targets, matches] of dimensions) {
      for (const [key, target] of Object.entries(targets || {})) {
        const actual = subjectQuestions.filter((question) => matches(question, key)).length;
        const status = metricStatus(actual, target);
        metrics[dimension][key] = { ...target, actual, status };
        if (status === "PASS") continue;
        const expectation = status === "BELOW_MIN" ? `至少 ${target.min}` : `至多 ${target.max}`;
        warnings.push({
          subjectId: subject.id,
          dimension,
          key,
          actual,
          ...target,
          message: `${subject.name || subject.id}的${dimensionLabel(dimension)}“${key}”目标为${expectation}题，候选题库为 ${actual} 题`
        });
      }
    }
    summaries.push({
      subjectId: subject.id,
      subjectName: subject.name || subject.id,
      questionCount: subjectQuestions.length,
      policy,
      metrics,
      warningCount: warnings.length - warningStart
    });
  }
  return { configuredSubjectCount: summaries.length, warningCount: warnings.length, subjects: summaries, warnings };
}
