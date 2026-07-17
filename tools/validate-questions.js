const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contentRoot = path.join(root, 'content');
const miniprogramRoot = path.join(root, 'miniprogram');
const errors = [];
const warnings = [];
const allQuestions = [];
const globalIds = new Set();
const globalExternalCodes = new Set();
const globalStems = new Map();
const imageFiles = new Map();
const allowedTypes = new Set(['single', 'multiple', 'judge', 'fill_blank', 'short_answer']);
const questionFiles = fs.readdirSync(contentRoot)
  .filter((name) => name.endsWith('-questions.json'))
  .sort();

function fail(question, message) {
  errors.push(`${question && question.id ? question.id : '<missing-id>'}: ${message}`);
}

function uniqueStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())
    && new Set(value).size === value.length;
}

if (!questionFiles.length) errors.push('content 目录下没有可用的 *-questions.json 开发快照');

questionFiles.forEach((fileName) => {
  const subjectId = fileName.slice(0, -'-questions.json'.length);
  const file = path.join(contentRoot, fileName);
  let questions;
  try { questions = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    errors.push(`${fileName} 无法解析：${error.message}`);
    return;
  }
  if (!Array.isArray(questions)) {
    errors.push(`${fileName} 根节点必须是数组`);
    return;
  }

  questions.forEach((question) => {
    allQuestions.push(question);
    if (!question.id || typeof question.id !== 'string') fail(question, '缺少稳定题目 ID');
    else if (globalIds.has(question.id)) fail(question, '全局题目 ID 重复');
    else globalIds.add(question.id);
    if (question.externalCode) {
      if (globalExternalCodes.has(question.externalCode)) fail(question, `外部题号 ${question.externalCode} 重复`);
      globalExternalCodes.add(question.externalCode);
    }
    if (question.subjectId !== subjectId) fail(question, `subjectId 应与文件名一致：${subjectId}`);
    if (!question.chapterId || !question.chapterName) fail(question, '缺少章节信息');
    if (!Number.isInteger(question.chapterOrder) || question.chapterOrder < 1) fail(question, '章节序号必须为正整数');
    if (!allowedTypes.has(question.type)) fail(question, '题型必须为 single、multiple、judge、fill_blank 或 short_answer');
    if (typeof question.stem !== 'string' || question.stem.trim().length < 4) fail(question, '题干过短');
    const normalizedStem = (question.stem || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (globalStems.has(normalizedStem)) fail(question, `题干与 ${globalStems.get(normalizedStem)} 完全重复`);
    else globalStems.set(normalizedStem, question.id);

    const choice = ['single', 'multiple', 'judge'].includes(question.type);
    const options = Array.isArray(question.options) ? question.options : [];
    const correctOptionIds = Array.isArray(question.correctOptionIds) ? question.correctOptionIds : [];
    if (choice) {
      if (options.length < 2 || options.length > 6) fail(question, '选择题选项数量必须为 2 至 6');
      const optionIds = new Set();
      options.forEach((option) => {
        if (!option.id || !option.label || typeof option.text !== 'string' || !option.text.trim()) fail(question, '选项字段不完整');
        if (optionIds.has(option.id)) fail(question, `选项 ID ${option.id} 重复`);
        optionIds.add(option.id);
      });
      if (!uniqueStrings(correctOptionIds)) fail(question, '正确答案不能为空、重复或格式无效');
      correctOptionIds.forEach((id) => { if (!optionIds.has(id)) fail(question, `正确答案 ${id} 不在选项中`); });
      if (question.type === 'multiple' && correctOptionIds.length < 2) fail(question, '多选题至少有两个正确答案');
      if (question.type !== 'multiple' && correctOptionIds.length !== 1) fail(question, '单选和判断题必须只有一个正确答案');
      if (question.type === 'judge' && options.length !== 2) fail(question, '判断题必须有两个选项');
    } else if (options.length || correctOptionIds.length) {
      fail(question, '填空题和简答题不能配置选择项答案');
    }

    if (question.type === 'fill_blank') {
      if (!Array.isArray(question.acceptedAnswers) || !question.acceptedAnswers.length
        || question.acceptedAnswers.some((answers) => !uniqueStrings(answers))) fail(question, '填空题每个空都必须配置至少一个可接受答案');
    }
    if (question.type === 'short_answer' && (typeof question.referenceAnswer !== 'string' || question.referenceAnswer.trim().length < 4)) {
      fail(question, '简答题必须配置参考答案');
    }
    if (typeof question.explanation !== 'string' || question.explanation.trim().length < 8) fail(question, '解析不得为空且至少 8 个字符');
    if (![1, 2, 3].includes(question.difficulty)) fail(question, '难度必须为 1、2 或 3');
    if (!Array.isArray(question.tags) || !question.tags.length) warnings.push(`${question.id}: 建议至少设置一个标签`);

    if (!Array.isArray(question.images) || question.images.length > 2) fail(question, 'images 必须为数组且最多两张');
    (question.images || []).forEach((image) => {
      if (!image.src || !image.alt || !String(image.alt).trim()) fail(question, '题图必须包含 src 和替代说明 alt');
      if (/^https:\/\//i.test(String(image.src || ''))) return;
      const extension = path.extname(String(image.src)).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) fail(question, '题图只支持 PNG、JPEG 和 WebP');
      const relative = String(image.src || '').replace(/^\//, '');
      const imageFile = path.resolve(miniprogramRoot, relative);
      if (!imageFile.startsWith(miniprogramRoot) || !fs.existsSync(imageFile)) fail(question, `题图不存在：${image.src}`);
      else {
        const size = fs.statSync(imageFile).size;
        if (size > 1024 * 1024) fail(question, `单图超过 1MB：${image.src}`);
        imageFiles.set(imageFile, size);
      }
    });
    if (!Array.isArray(question.examScopes) || question.examScopes.some((scope) => scope !== '408')) fail(question, 'examScopes 目前仅允许 408');
    if (question.status !== 'active') warnings.push(`${question.id}: 开发 Mock 快照中的停用题不会进入正式题库`);
    if (!Number.isInteger(question.version) || question.version < 1) fail(question, '版本号无效');
  });
});

if (!allQuestions.length) errors.push('开发 Mock 题库不能为空');
if (allQuestions.length > 100_000) errors.push(`题库容量不能超过 10 万题，当前为 ${allQuestions.length}`);
const requirements = { ds: 12, co: 12, os: 9, network: 7 };
Object.entries(requirements).forEach(([subjectId, required]) => {
  const available = allQuestions.filter((question) => question.subjectId === subjectId && question.type === 'single' && (question.examScopes || []).includes('408')).length;
  if (available < required) errors.push(`${subjectId} 408 单选题池至少需要 ${required} 题，当前为 ${available}`);
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const imageBytes = Array.from(imageFiles.values()).reduce((sum, size) => sum + size, 0);
console.log(`Validated ${allQuestions.length} globally unique questions across ${questionFiles.length} dynamic subject files.`);
console.log(`Images: ${imageFiles.size} files, ${imageBytes} bytes. 408 pool and structural rules passed.`);
if (warnings.length) console.warn(`Quality warnings (${warnings.length}):\n${warnings.join('\n')}`);
