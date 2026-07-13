const fs = require('fs');
const path = require('path');
const banks = require('./question-bank-facts');

const root = path.resolve(__dirname, '..');
const miniprogramRoot = path.join(root, 'miniprogram');
const errors = [];
const allQuestions = [];
const globalIds = new Set();
const globalStems = new Map();
const imageFiles = new Map();
const allowedTypes = new Set(['single', 'multiple', 'judge']);

const configurations = {
  cpp: {
    prefix: 'cpp', total: 100,
    chapterCounts: [12, 11, 11, 12, 11, 11, 11, 11, 10],
    types: { single: 62, multiple: 17, judge: 21 }, difficulties: { 1: 50, 2: 35, 3: 15 }, exam: false
  }
};

banks.forEach((bank) => {
  const total = bank.chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  configurations[bank.subjectId] = {
    prefix: bank.prefix,
    total,
    chapterCounts: bank.chapters.map((chapter) => chapter.count),
    chapterIds: bank.chapters.map((chapter) => chapter.id),
    chapterNames: bank.chapters.map((chapter) => chapter.name),
    types: { single: total * 0.6, multiple: total * 0.2, judge: total * 0.2 },
    difficulties: { 1: bank.difficultyCounts[0], 2: bank.difficultyCounts[1], 3: bank.difficultyCounts[2] },
    exam: bank.examScopes.includes('408')
  };
});

function fail(question, message) {
  errors.push(`${question && question.id ? question.id : '<missing-id>'}: ${message}`);
}

function summary(items, field) {
  return items.reduce((result, item) => {
    result[item[field]] = (result[item[field]] || 0) + 1;
    return result;
  }, {});
}

function compareSummary(subjectId, label, actual, expected) {
  Object.keys(expected).forEach((key) => {
    if ((actual[key] || 0) !== expected[key]) errors.push(`${subjectId} ${label} ${key} 应为 ${expected[key]}，当前为 ${actual[key] || 0}`);
  });
}

Object.keys(configurations).forEach((subjectId) => {
  const config = configurations[subjectId];
  const file = path.join(root, 'content', `${subjectId}-questions.json`);
  if (!fs.existsSync(file)) {
    errors.push(`缺少题库文件 content/${subjectId}-questions.json`);
    return;
  }
  let questions;
  try { questions = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    errors.push(`content/${subjectId}-questions.json 无法解析：${error.message}`);
    return;
  }
  if (!Array.isArray(questions)) {
    errors.push(`${subjectId} 题库根节点必须是数组`);
    return;
  }
  if (questions.length !== config.total) errors.push(`${subjectId} 应有 ${config.total} 题，当前为 ${questions.length}`);
  const chapterCounts = {};

  questions.forEach((question, index) => {
    allQuestions.push(question);
    const expectedId = `${config.prefix}${String(index + 1).padStart(3, '0')}`;
    if (question.id !== expectedId) fail(question, `题号应为 ${expectedId}`);
    if (globalIds.has(question.id)) fail(question, '全局题目 ID 重复');
    globalIds.add(question.id);
    if (question.subjectId !== subjectId) fail(question, `subjectId 应为 ${subjectId}`);
    if (!question.chapterId || !question.chapterName) fail(question, '缺少章节信息');
    if (!Number.isInteger(question.chapterOrder) || question.chapterOrder < 1 || question.chapterOrder > config.chapterCounts.length) fail(question, '章节序号越界');
    chapterCounts[question.chapterOrder] = (chapterCounts[question.chapterOrder] || 0) + 1;
    if (config.chapterIds && config.chapterIds[question.chapterOrder - 1] !== question.chapterId) fail(question, 'chapterId 与配置不一致');
    if (config.chapterNames && config.chapterNames[question.chapterOrder - 1] !== question.chapterName) fail(question, 'chapterName 与配置不一致');

    if (!allowedTypes.has(question.type)) fail(question, '题型必须为 single、multiple 或 judge');
    if (typeof question.stem !== 'string' || question.stem.trim().length < 4) fail(question, '题干过短');
    const normalizedStem = (question.stem || '').replace(/\s+/g, ' ').trim();
    if (globalStems.has(normalizedStem)) fail(question, `题干与 ${globalStems.get(normalizedStem)} 重复`);
    else globalStems.set(normalizedStem, question.id);

    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) fail(question, '选项数量必须为 2 至 6');
    if (!Array.isArray(question.correctOptionIds) || !question.correctOptionIds.length) fail(question, '缺少正确答案');
    const optionIds = new Set();
    (question.options || []).forEach((option) => {
      if (!option.id || !option.label || typeof option.text !== 'string' || !option.text.trim()) fail(question, '选项字段不完整');
      if (optionIds.has(option.id)) fail(question, `选项 ID ${option.id} 重复`);
      optionIds.add(option.id);
    });
    (question.correctOptionIds || []).forEach((id) => { if (!optionIds.has(id)) fail(question, `正确答案 ${id} 不在选项中`); });
    if (new Set(question.correctOptionIds || []).size !== (question.correctOptionIds || []).length) fail(question, '正确答案包含重复项');
    if (question.type === 'single' && question.correctOptionIds.length !== 1) fail(question, '单选题必须只有一个正确答案');
    if (question.type === 'multiple' && question.correctOptionIds.length < 2) fail(question, '多选题至少有两个正确答案');
    if (question.type === 'judge') {
      if (question.options.length !== 2 || question.correctOptionIds.length !== 1) fail(question, '判断题必须有两个选项和一个答案');
      if (question.options[0] && question.options[0].text !== '正确') fail(question, '判断题 A 选项必须为正确');
      if (question.options[1] && question.options[1].text !== '错误') fail(question, '判断题 B 选项必须为错误');
    }

    if (typeof question.explanation !== 'string' || question.explanation.trim().length < 8) fail(question, '解析不得为空且至少 8 个字符');
    if (![1, 2, 3].includes(question.difficulty)) fail(question, '难度必须为 1、2 或 3');
    if (!Array.isArray(question.tags) || !question.tags.length || question.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) fail(question, '至少需要一个有效标签');
    if (!Array.isArray(question.images) || question.images.length > 2) fail(question, 'images 必须为数组且最多两张');
    (question.images || []).forEach((image) => {
      if (!image.src || !image.alt || !String(image.alt).trim()) fail(question, '题图必须包含 src 和替代说明 alt');
      if (image.src && path.extname(String(image.src)).toLowerCase() !== '.png') fail(question, '首版题图必须使用 PNG');
      const relative = String(image.src || '').replace(/^\//, '');
      const imageFile = path.resolve(miniprogramRoot, relative);
      if (!imageFile.startsWith(miniprogramRoot) || !fs.existsSync(imageFile)) fail(question, `题图不存在：${image.src}`);
      else {
        const size = fs.statSync(imageFile).size;
        if (size > 100 * 1024) fail(question, `单图超过 100KB：${image.src}`);
        imageFiles.set(imageFile, size);
      }
    });
    if (!Array.isArray(question.examScopes) || question.examScopes.some((scope) => scope !== '408')) fail(question, 'examScopes 仅允许 408');
    if (config.exam && !question.examScopes.includes('408')) fail(question, '408 基础学科题必须加入 408 题池');
    if (!config.exam && question.examScopes.length) fail(question, '非 408 基础学科不得加入 408 题池');
    if (question.status !== 'active') fail(question, '首版题目状态必须为 active');
    if (!Number.isInteger(question.version) || question.version < 1) fail(question, '版本号无效');
  });

  config.chapterCounts.forEach((expected, index) => {
    if ((chapterCounts[index + 1] || 0) !== expected) errors.push(`${subjectId} 第 ${index + 1} 章应有 ${expected} 题，当前为 ${chapterCounts[index + 1] || 0}`);
  });
  compareSummary(subjectId, '题型', summary(questions, 'type'), config.types);
  compareSummary(subjectId, '难度', summary(questions, 'difficulty'), config.difficulties);
});

if (allQuestions.length !== 500) errors.push(`全题库必须恰好 500 题，当前为 ${allQuestions.length}`);
const imageBytes = Array.from(imageFiles.values()).reduce((sum, size) => sum + size, 0);
if (imageBytes > 600 * 1024) errors.push(`题图总资源超过 600KB，当前为 ${imageBytes} bytes`);
['ds', 'co', 'os', 'network'].forEach((subjectId) => {
  const required = { ds: 12, co: 12, os: 9, network: 7 }[subjectId];
  const available = allQuestions.filter((question) => question.subjectId === subjectId && question.type === 'single' && question.examScopes.includes('408')).length;
  if (available < required) errors.push(`${subjectId} 408 单选题池至少需要 ${required} 题，当前为 ${available}`);
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${allQuestions.length} globally unique questions across ${Object.keys(configurations).length} subjects.`);
console.log(`Images: ${imageFiles.size} files, ${imageBytes} bytes. 408 pool and all chapter/type/difficulty quotas passed.`);
