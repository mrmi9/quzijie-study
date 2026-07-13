const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const questions = JSON.parse(fs.readFileSync(path.join(root, 'content', 'cpp-questions.json'), 'utf8'));
const allowedTypes = new Set(['single', 'multiple', 'judge']);
const allowedCounts = new Map([
  [1, 12], [2, 11], [3, 11], [4, 12], [5, 11],
  [6, 11], [7, 11], [8, 11], [9, 10]
]);
const forbiddenTopics = ['STL', '数据结构', '操作系统', '计算机网络', 'Linux'];
const errors = [];
const ids = new Set();
const chapterNames = new Map();
const chapterCounts = new Map();

function fail(question, message) {
  errors.push(`${question.id || '<missing-id>'}: ${message}`);
}

if (!Array.isArray(questions)) {
  throw new Error('题库根节点必须是数组');
}
if (questions.length !== 100) {
  errors.push(`题库必须包含 100 道题，当前为 ${questions.length} 道`);
}

questions.forEach((question, index) => {
  const expectedId = `cpp${String(index + 1).padStart(3, '0')}`;
  if (question.id !== expectedId) fail(question, `题号应为 ${expectedId}`);
  if (ids.has(question.id)) fail(question, '题目 ID 重复');
  ids.add(question.id);

  if (!question.chapterId || !question.chapterName) fail(question, '缺少章节信息');
  if (!Number.isInteger(question.chapterOrder) || question.chapterOrder < 1 || question.chapterOrder > 9) {
    fail(question, 'chapterOrder 必须为 1 至 9 的整数');
  }
  const knownChapterName = chapterNames.get(question.chapterOrder);
  if (knownChapterName && knownChapterName !== question.chapterName) fail(question, '同一章节序号的名称不一致');
  chapterNames.set(question.chapterOrder, question.chapterName);
  chapterCounts.set(question.chapterOrder, (chapterCounts.get(question.chapterOrder) || 0) + 1);

  if (!allowedTypes.has(question.type)) fail(question, '题型必须为 single、multiple 或 judge');
  if (typeof question.stem !== 'string' || question.stem.trim().length < 4) fail(question, '题干过短');
  if (!Array.isArray(question.options) || question.options.length < 2) fail(question, '选项数量不足');
  if (!Array.isArray(question.correctOptionIds) || !question.correctOptionIds.length) fail(question, '缺少正确答案');

  const optionIds = new Set();
  (question.options || []).forEach((option) => {
    if (!option.id || !option.label || !option.text) fail(question, '选项字段不完整');
    if (optionIds.has(option.id)) fail(question, `选项 ID ${option.id} 重复`);
    optionIds.add(option.id);
  });
  question.correctOptionIds.forEach((id) => {
    if (!optionIds.has(id)) fail(question, `正确答案 ${id} 不在选项中`);
  });
  if (new Set(question.correctOptionIds).size !== question.correctOptionIds.length) fail(question, '正确答案包含重复项');
  if (question.type === 'single' && question.correctOptionIds.length !== 1) fail(question, '单选题必须只有一个正确答案');
  if (question.type === 'multiple' && question.correctOptionIds.length < 2) fail(question, '多选题至少有两个正确答案');
  if (question.type === 'judge') {
    if (question.options.length !== 2 || question.correctOptionIds.length !== 1) fail(question, '判断题必须有两个选项和一个答案');
    if (question.options[0] && question.options[0].text !== '正确') fail(question, '判断题 A 选项必须为正确');
    if (question.options[1] && question.options[1].text !== '错误') fail(question, '判断题 B 选项必须为错误');
  }

  if (typeof question.explanation !== 'string' || question.explanation.trim().length < 8) fail(question, '解析过短');
  if (![1, 2, 3].includes(question.difficulty)) fail(question, '难度必须为 1、2 或 3');
  if (!Array.isArray(question.tags) || !question.tags.length) fail(question, '至少需要一个标签');
  if (question.status !== 'active') fail(question, '首版题目状态必须为 active');
  if (!Number.isInteger(question.version) || question.version < 1) fail(question, '版本号无效');

  const searchable = [question.stem, question.explanation].concat(question.tags || []).join(' ');
  forbiddenTopics.forEach((topic) => {
    if (searchable.includes(topic)) fail(question, `出现越界专题：${topic}`);
  });
});

allowedCounts.forEach((expected, order) => {
  const actual = chapterCounts.get(order) || 0;
  if (actual !== expected) errors.push(`第 ${order} 章应有 ${expected} 题，当前为 ${actual} 题`);
});

if (chapterNames.size !== 9) errors.push(`必须覆盖 9 个章节，当前为 ${chapterNames.size} 个`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const typeSummary = questions.reduce((summary, question) => {
  summary[question.type] = (summary[question.type] || 0) + 1;
  return summary;
}, {});
console.log(`Validated ${questions.length} questions across ${chapterNames.size} chapters.`);
console.log(`Types: ${JSON.stringify(typeSummary)}`);
