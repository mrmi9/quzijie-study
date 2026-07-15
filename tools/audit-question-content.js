const fs = require('fs');
const path = require('path');
const hardOverrides = require('./question-bank-hard-overrides');
const advancedOverrides = require('./question-bank-advanced-overrides');

const root = path.resolve(__dirname, '..');
const subjectOrder = ['cpp', 'linux', 'os', 'ds', 'network', 'stl', 'co'];
const subjectNames = {
  cpp: 'C/C++', linux: 'Linux', os: '操作系统', ds: '数据结构',
  network: '计算机网络', stl: 'STL', co: '计算机组成原理'
};
const generatedSubjects = new Set(subjectOrder.filter((subjectId) => subjectId !== 'cpp'));
const generatedHardIds = new Set(Object.keys(hardOverrides));
const generatedAdvancedIds = new Set(Object.keys(advancedOverrides));
const reviewedCppHard = new Set([
  'cpp043', 'cpp044', 'cpp054', 'cpp059', 'cpp063', 'cpp064', 'cpp065', 'cpp068',
  'cpp074', 'cpp077', 'cpp081', 'cpp082', 'cpp086', 'cpp098', 'cpp100'
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s`'"“”‘’《》〈〉（）()，。；：、！？!?,.:;\[\]{}]/g, '');
}

function normalizeOption(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function bigrams(value) {
  const normalized = normalize(value);
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((item) => { if (right.has(item)) intersection += 1; });
  return intersection / (left.size + right.size - intersection);
}

function countBy(items, field) {
  return items.reduce((summary, item) => {
    const key = String(item[field]);
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function loadQuestions() {
  return subjectOrder.flatMap((subjectId) => {
    const file = path.join(root, 'content', `${subjectId}-questions.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
}

function audit() {
  const questions = loadQuestions();
  const findings = [];
  const add = (severity, question, message) => findings.push({ severity, questionId: question.id, subjectId: question.subjectId, message });

  questions.forEach((question) => {
    const optionTexts = question.options.map((option) => normalizeOption(option.text));
    if (new Set(optionTexts).size !== optionTexts.length) add('high', question, '选项文本经规范化后重复');
    if (/再次(?:辨析|围绕|判断)/.test(question.stem)) add('medium', question, '题干含机械重复措辞“再次”');
    if (question.explanation.trim().length < { 1: 12, 2: 18, 3: 28 }[question.difficulty]) {
      add('medium', question, `难度 ${question.difficulty} 的解析过短`);
    }
    if (question.difficulty === 3 && generatedSubjects.has(question.subjectId)) {
      if (question.version < 2) add('high', question, '非 C/C++ 难题未使用人工重写版本');
      if (!generatedHardIds.has(question.id)) add('high', question, '非 C/C++ 难题未进入人工重写清单');
      if (/哪个术语|哪项正确|术语—说明|是指“/.test(question.stem)) add('high', question, '难题仍停留在定义辨析模板');
      if (question.stem.length < 20) add('medium', question, '难题题干缺少足够的条件或场景');
    }
    if (question.difficulty === 3 && question.subjectId === 'cpp' && !reviewedCppHard.has(question.id)) {
      add('high', question, 'C/C++ 难题未进入重点人工复核清单');
    }
    if (question.difficulty === 2 && question.type === 'single' && generatedSubjects.has(question.subjectId) && !generatedAdvancedIds.has(question.id)) {
      add('high', question, '非 C/C++ 进阶单选仍为定义反选模板，尚未人工重写');
    }
    if (question.code !== undefined && (typeof question.code !== 'string' || !question.code.trim())) {
      add('high', question, '代码字段存在但为空');
    }
  });

  const nearDuplicatePairs = [];
  subjectOrder.forEach((subjectId) => {
    const items = questions.filter((question) => question.subjectId === subjectId);
    const grams = items.map((question) => bigrams(question.stem));
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        const score = jaccard(grams[left], grams[right]);
        if (score >= 0.9) nearDuplicatePairs.push({ left: items[left].id, right: items[right].id, score: Number(score.toFixed(3)) });
      }
    }
  });

  const subjects = subjectOrder.map((subjectId) => {
    const items = questions.filter((question) => question.subjectId === subjectId);
    const hard = items.filter((question) => question.difficulty === 3);
    const advancedSingles = items.filter((question) => question.difficulty === 2 && question.type === 'single');
    const explanationCharacters = items.reduce((sum, question) => sum + question.explanation.trim().length, 0);
    return {
      subjectId,
      subjectName: subjectNames[subjectId],
      total: items.length,
      chapters: new Set(items.map((question) => question.chapterId)).size,
      types: countBy(items, 'type'),
      difficulties: countBy(items, 'difficulty'),
      hardCurated: hard.filter((question) => generatedHardIds.has(question.id) || reviewedCppHard.has(question.id)).length,
      hardTotal: hard.length,
      advancedSingleCurated: advancedSingles.filter((question) => generatedAdvancedIds.has(question.id) || question.subjectId === 'cpp').length,
      advancedSingleTotal: advancedSingles.length,
      codeQuestions: items.filter((question) => typeof question.code === 'string' && question.code.trim()).length,
      averageExplanationCharacters: Number((explanationCharacters / items.length).toFixed(1))
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    grain: '每行一题，主键为全局唯一 question.id',
    totalQuestions: questions.length,
    totalSubjects: subjectOrder.length,
    totalChapters: new Set(questions.map((question) => `${question.subjectId}/${question.chapterId}`)).size,
    findings,
    findingsBySeverity: ['critical', 'high', 'medium', 'low'].reduce((summary, severity) => {
      summary[severity] = findings.filter((finding) => finding.severity === severity).length;
      return summary;
    }, {}),
    nearDuplicatePairCount: nearDuplicatePairs.length,
    nearDuplicateSamples: nearDuplicatePairs.slice(0, 20),
    subjects
  };
  return result;
}

function main() {
  const result = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Audited ${result.totalQuestions} questions across ${result.totalSubjects} subjects and ${result.totalChapters} chapters.`);
    result.subjects.forEach((subject) => {
      console.log(`${subject.subjectId}: total=${subject.total}, hard=${subject.hardCurated}/${subject.hardTotal} curated, advancedSingles=${subject.advancedSingleCurated}/${subject.advancedSingleTotal} curated, code=${subject.codeQuestions}, avgExplanation=${subject.averageExplanationCharacters}`);
    });
    console.log(`Findings: ${Object.entries(result.findingsBySeverity).map(([severity, count]) => `${severity}=${count}`).join(', ')}; nearDuplicatePairs=${result.nearDuplicatePairCount}.`);
    result.findings.forEach((finding) => console.error(`${finding.severity.toUpperCase()} ${finding.questionId}: ${finding.message}`));
  }
  if (result.findings.some((finding) => ['critical', 'high', 'medium'].includes(finding.severity))) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { audit };
