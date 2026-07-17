const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BATCH_DIR = path.join(ROOT, "content", "imports", "2026-07-17-open-sources");
const SUBJECTS = ["cpp", "linux", "os", "ds", "network", "stl", "co"];
const SUBJECT_CODES = { cpp: "CPP", linux: "LINUX", os: "OS", ds: "DS", network: "NET", stl: "STL", co: "CO" };
const EXPECTED_PER_SUBJECT = 50;
const TYPES = new Set(["single", "multiple", "judge", "fill_blank", "short_answer"]);
const STRUCTURE_ONLY = process.argv.includes("--structure-only");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function normalizedOptionText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("zh-CN").trim().replace(/\s+/g, " ");
}

function normalizedFillAnswer(value, config = {}) {
  let normalized = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!config.caseSensitive) normalized = normalized.toLocaleLowerCase("zh-CN");
  if (!config.punctuationSensitive) normalized = normalized.replace(/[\p{P}\p{S}]/gu, "");
  return normalized;
}

function normalizedIdentity(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function bigrams(value) {
  const text = normalizedText(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_item, index) => text.slice(index, index + 2)));
}

function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function fail(errors, message) {
  errors.push(message);
}

function validateQuestion(question, subjectId, sourceById, chapters, errors, warnings) {
  const prefix = question.externalCode || `${subjectId}:未命名题目`;
  if (question.subjectId !== subjectId) fail(errors, `${prefix}: subjectId 与文件不一致`);
  if (!new RegExp(`^WEB-20260717-${SUBJECT_CODES[subjectId]}-\\d{3}$`).test(question.externalCode || "")) fail(errors, `${prefix}: externalCode 与学科前缀不一致`);
  if (!chapters.has(question.chapterId)) fail(errors, `${prefix}: 章节 ${question.chapterId} 不存在`);
  else if (chapters.get(question.chapterId) !== subjectId) fail(errors, `${prefix}: 章节 ${question.chapterId} 不属于学科 ${subjectId}`);
  if (!TYPES.has(question.type)) fail(errors, `${prefix}: 题型 ${question.type} 无效`);
  if (String(question.stem || "").trim().length < 8) fail(errors, `${prefix}: 题干过短`);
  if (String(question.explanation || "").trim().length < 24) fail(errors, `${prefix}: 解析少于 24 个字符`);
  if (![1, 2, 3].includes(question.difficulty)) fail(errors, `${prefix}: 难度必须为 1、2、3`);
  if (!Array.isArray(question.tags) || question.tags.length < 2 || question.tags.some((tag) => typeof tag !== "string" || !tag.trim())) fail(errors, `${prefix}: 至少需要两个有效标签`);
  if (!Array.isArray(question.sourceIds) || !question.sourceIds.length) fail(errors, `${prefix}: 缺少来源引用`);
  for (const id of question.sourceIds || []) {
    const source = sourceById.get(id);
    if (!source) fail(errors, `${prefix}: 来源 ${id} 未登记`);
    else if (!Array.isArray(source.subjects) || !source.subjects.includes(subjectId)) fail(errors, `${prefix}: 来源 ${id} 未声明适用于 ${subjectId}`);
  }
  if (!Array.isArray(question.sourceAnchors) || !question.sourceAnchors.length || question.sourceAnchors.some((anchor) => typeof anchor !== "string" || !anchor.trim())) fail(errors, `${prefix}: 缺少有效来源锚点`);
  if (!String(question.dialect || "").trim()) fail(errors, `${prefix}: 缺少标准版本或适用范围`);
  if (String(question.factSummary || "").trim().length < 8) fail(errors, `${prefix}: 原子事实摘要过短`);
  if (!String(question.authoredBy || "").trim()) fail(errors, `${prefix}: 缺少作者标识`);
  if (!Array.isArray(question.examScopes)) fail(errors, `${prefix}: examScopes 必须是数组`);
  else if (question.examScopes.length) fail(errors, `${prefix}: 首批新题禁止进入 408 题池`);
  if (!Array.isArray(question.correctOptionIds)) fail(errors, `${prefix}: correctOptionIds 必须是数组`);
  if (!Array.isArray(question.acceptedAnswers)) fail(errors, `${prefix}: acceptedAnswers 必须是数组`);
  if (!question.answerConfig || typeof question.answerConfig !== "object" || typeof question.answerConfig.caseSensitive !== "boolean" || typeof question.answerConfig.punctuationSensitive !== "boolean") {
    fail(errors, `${prefix}: answerConfig 必须完整配置两个布尔字段`);
  }

  const choice = ["single", "multiple", "judge"].includes(question.type);
  const options = Array.isArray(question.options) ? question.options : [];
  const correct = Array.isArray(question.correctOptionIds) ? question.correctOptionIds : [];
  if (choice) {
    if (options.length < 2 || options.length > 6) fail(errors, `${prefix}: 选择题选项数无效`);
    const optionIds = options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) fail(errors, `${prefix}: 选项 ID 重复`);
    if (options.some((option) => !option.id || !option.label || !String(option.text || "").trim())) fail(errors, `${prefix}: 选项字段不完整`);
    if (correct.some((id) => !optionIds.includes(id))) fail(errors, `${prefix}: 正确答案引用不存在的选项`);
    if (question.type === "multiple" && correct.length < 2) fail(errors, `${prefix}: 多选题至少两个正确项`);
    if (question.type !== "multiple" && correct.length !== 1) fail(errors, `${prefix}: 单选/判断题必须一个正确项`);
    if (["single", "multiple"].includes(question.type) && (options.length !== 4 || optionIds.join("|") !== "A|B|C|D")) {
      fail(errors, `${prefix}: 单选和多选必须按 A-D 配置四个选项`);
    }
    if (question.type === "judge") {
      if (options.length !== 2 || optionIds.join("|") !== "A|B") fail(errors, `${prefix}: 判断题必须按 A/B 配置两个选项`);
      if (options[0]?.label !== "A" || options[0]?.text !== "正确" || options[1]?.label !== "B" || options[1]?.text !== "错误") {
        fail(errors, `${prefix}: 判断题必须固定为 A=正确、B=错误`);
      }
    }
    const optionTexts = options.map((option) => normalizedOptionText(option.text));
    if (new Set(optionTexts).size !== optionTexts.length) fail(errors, `${prefix}: 选项文本重复`);
  } else if (options.length || correct.length) {
    fail(errors, `${prefix}: 非选择题不能带选择项`);
  }

  if (question.type === "fill_blank") {
    const accepted = question.acceptedAnswers;
    const flat = Array.isArray(accepted) && accepted.length && accepted.every((answer) => typeof answer === "string" && answer.trim());
    const nested = Array.isArray(accepted) && accepted.length && accepted.every((answers) => Array.isArray(answers) && answers.length && answers.every((answer) => typeof answer === "string" && answer.trim()));
    if (!flat && !nested) {
      fail(errors, `${prefix}: 填空题可接受答案无效`);
    } else {
      const groups = flat ? [accepted] : accepted;
      groups.forEach((answers, index) => {
        const normalized = answers.map((answer) => normalizedFillAnswer(answer, question.answerConfig));
        if (normalized.some((answer) => !answer)) fail(errors, `${prefix}: 第 ${index + 1} 空存在规范化后为空的答案`);
        if (new Set(normalized).size !== normalized.length) fail(errors, `${prefix}: 第 ${index + 1} 空存在规范化后重复的答案`);
      });
    }
  } else if (Array.isArray(question.acceptedAnswers) && question.acceptedAnswers.length) {
    fail(errors, `${prefix}: 非填空题不能配置可接受答案`);
  }
  if (question.type === "short_answer" && String(question.referenceAnswer || "").trim().length < 12) fail(errors, `${prefix}: 简答题参考答案过短`);
  if (question.type !== "short_answer" && question.referenceAnswer) warnings.push(`${prefix}: 非简答题设置了 referenceAnswer`);

  if (!STRUCTURE_ONLY) {
    const review = question.review || {};
    for (const field of ["factChecked", "answerChecked", "copyrightChecked", "duplicateChecked"]) {
      if (review[field] !== true) fail(errors, `${prefix}: 复核字段 ${field} 尚未通过`);
    }
    const author = normalizedIdentity(question.authoredBy);
    const reviewer = normalizedIdentity(review.reviewedBy);
    if (!author) fail(errors, `${prefix}: 缺少作者标识`);
    if (!reviewer) fail(errors, `${prefix}: 缺少独立复核人标识`);
    if (author && reviewer && author === reviewer) fail(errors, `${prefix}: 作者不能复核自己的题目`);
  }
}

function main() {
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(BATCH_DIR)) throw new Error(`批次目录不存在：${BATCH_DIR}`);
  const sources = readJson(path.join(BATCH_DIR, "sources.json"));
  const sourceById = new Map();
  for (const source of sources.sources || []) {
    if (!source.id || sourceById.has(source.id)) fail(errors, `来源 ID 重复或为空：${source.id || "（空）"}`);
    sourceById.set(source.id, source);
    if (!/^https:\/\//.test(source.url || "")) fail(errors, `来源 ${source.id}: URL 必须使用 HTTPS`);
    if (!source.title || !source.version || !source.license || !source.usageNote) fail(errors, `来源 ${source.id}: 标题、版本、许可或使用说明缺失`);
    if (!Array.isArray(source.subjects) || !source.subjects.length || source.subjects.some((subjectId) => !SUBJECTS.includes(subjectId))) fail(errors, `来源 ${source.id}: 适用学科无效`);
  }

  const currentQuestions = SUBJECTS.flatMap((subjectId) => readJson(path.join(ROOT, "content", `${subjectId}-questions.json`)));
  const chapters = new Map(currentQuestions.map((question) => [question.chapterId, question.subjectId]));
  const existingStems = currentQuestions.map((question) => ({ id: question.id, stem: question.stem }));
  const all = [];
  const externalCodes = new Set();
  const exactStems = new Set(existingStems.map((question) => normalizedText(question.stem)));

  for (const subjectId of SUBJECTS) {
    const filePath = path.join(BATCH_DIR, `${subjectId}.json`);
    if (!fs.existsSync(filePath)) {
      fail(errors, `缺少学科文件：${subjectId}.json`);
      continue;
    }
    const payload = readJson(filePath);
    const questions = Array.isArray(payload) ? payload : payload.questions;
    if (!Array.isArray(questions)) {
      fail(errors, `${subjectId}.json 不是题目数组`);
      continue;
    }
    if (questions.length !== EXPECTED_PER_SUBJECT) fail(errors, `${subjectId}: 应为 ${EXPECTED_PER_SUBJECT} 道，实际 ${questions.length} 道`);
    const typeCounts = {};
    const difficultyCounts = {};
    const singleAnswerCounts = { A: 0, B: 0, C: 0, D: 0 };
    const expectedCodes = new Set(Array.from({ length: EXPECTED_PER_SUBJECT }, (_item, index) => `WEB-20260717-${SUBJECT_CODES[subjectId]}-${String(index + 1).padStart(3, "0")}`));
    for (const question of questions) {
      validateQuestion(question, subjectId, sourceById, chapters, errors, warnings);
      typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
      difficultyCounts[question.difficulty] = (difficultyCounts[question.difficulty] || 0) + 1;
      if (question.type === "single" && question.correctOptionIds?.length === 1 && Object.hasOwn(singleAnswerCounts, question.correctOptionIds[0])) {
        singleAnswerCounts[question.correctOptionIds[0]] += 1;
      }
      if (externalCodes.has(question.externalCode)) fail(errors, `${question.externalCode}: 外部题号重复`);
      externalCodes.add(question.externalCode);
      const normalizedStem = normalizedText(question.stem);
      if (exactStems.has(normalizedStem)) fail(errors, `${question.externalCode}: 题干与现有或本批次题目完全重复`);
      exactStems.add(normalizedStem);
      all.push(question);
    }
    const actualCodes = new Set(questions.map((question) => question.externalCode));
    for (const expectedCode of expectedCodes) if (!actualCodes.has(expectedCode)) fail(errors, `${subjectId}: 缺少外部题号 ${expectedCode}`);
    for (const actualCode of actualCodes) if (!expectedCodes.has(actualCode)) fail(errors, `${subjectId}: 存在计划外题号 ${actualCode}`);
    for (const requiredType of TYPES) if (!typeCounts[requiredType]) fail(errors, `${subjectId}: 缺少题型 ${requiredType}`);
    for (const level of [1, 2, 3]) if (!difficultyCounts[level]) fail(errors, `${subjectId}: 缺少难度 ${level}`);
    for (const [answer, count] of Object.entries(singleAnswerCounts)) {
      if (count < 5 || count > 10) fail(errors, `${subjectId}: 单选正确项 ${answer} 分布为 ${count}，应在 5 至 10 之间`);
    }
  }

  const comparisons = [...existingStems.map((item) => ({ code: item.id, stem: item.stem, existing: true })), ...all.map((item) => ({ code: item.externalCode, stem: item.stem, existing: false }))];
  for (let left = existingStems.length; left < comparisons.length; left += 1) {
    for (let right = 0; right < left; right += 1) {
      const score = similarity(comparisons[left].stem, comparisons[right].stem);
      if (score >= 0.88) fail(errors, `${comparisons[left].code}: 与 ${comparisons[right].code} 题干近似度 ${score.toFixed(3)}`);
      else if (score >= 0.8) warnings.push(`${comparisons[left].code}: 与 ${comparisons[right].code} 题干近似度 ${score.toFixed(3)}，建议人工复看`);
    }
  }

  if (all.length !== SUBJECTS.length * EXPECTED_PER_SUBJECT) fail(errors, `总题数应为 350，实际 ${all.length}`);
  console.log(JSON.stringify({ batch: path.relative(ROOT, BATCH_DIR), mode: STRUCTURE_ONLY ? "structure-only" : "release", questions: all.length, sources: sourceById.size, warnings: warnings.length, errors: errors.length }, null, 2));
  warnings.slice(0, 80).forEach((warning) => console.warn(`WARN ${warning}`));
  errors.slice(0, 200).forEach((error) => console.error(`ERROR ${error}`));
  if (errors.length > 200) console.error(`ERROR 另有 ${errors.length - 200} 条错误未逐条输出`);
  if (warnings.length > 80) console.warn(`WARN 另有 ${warnings.length - 80} 条警告未逐条输出`);
  if (errors.length) process.exitCode = 1;
}

main();
