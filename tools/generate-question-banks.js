const fs = require('fs');
const path = require('path');
const banks = require('./question-bank-facts');
const hardOverrides = require('./question-bank-hard-overrides');
const advancedOverrides = require('./question-bank-advanced-overrides');

const root = path.resolve(__dirname, '..');
const optionLabels = ['A', 'B', 'C', 'D'];

function rotate(items, shift) {
  const amount = shift % items.length;
  return items.slice(amount).concat(items.slice(0, amount));
}

function makeOptions(entries, shift) {
  return rotate(entries, shift).map((entry, index) => ({
    id: optionLabels[index],
    label: optionLabels[index],
    text: entry.text,
    correct: entry.correct
  }));
}

function generateBank(bank) {
  const allFacts = bank.chapters.flatMap((chapter) => chapter.facts.map((fact) => ({
    chapter,
    term: fact[0],
    definition: fact[1]
  })));
  const total = bank.chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const questions = [];
  let globalIndex = 0;

  bank.chapters.forEach((chapter, chapterIndex) => {
    for (let localIndex = 0; localIndex < chapter.count; localIndex += 1) {
      const fact = chapter.facts[localIndex % chapter.facts.length];
      const occurrence = Math.floor(localIndex / chapter.facts.length);
      const current = { term: fact[0], definition: fact[1] };
      const factIndex = allFacts.findIndex((item) => item.term === current.term && item.definition === current.definition);
      const other = [1, 2, 3].map((offset) => allFacts[(factIndex + offset) % allFacts.length]);
      const slot = globalIndex % 5;
      const type = slot < 3 ? 'single' : slot === 3 ? 'multiple' : 'judge';
      let stem;
      let entries;
      let explanation;

      if (type === 'single') {
        const inverse = (localIndex + chapterIndex) % 2 === 1;
        const prefix = occurrence ? '结合“' + chapter.name + '”中的相关概念，' : '在“' + chapter.name + '”主题中，';
        stem = inverse
          ? prefix + '下列哪个术语与“' + current.definition + '”相符？'
          : prefix + '关于“' + current.term + '”，下列描述哪项正确？';
        entries = inverse
          ? [{ text: current.term, correct: true }].concat(other.map((item) => ({ text: item.term, correct: false })))
          : [{ text: current.definition, correct: true }].concat(other.map((item) => ({ text: item.definition, correct: false })));
        explanation = current.term + '：' + current.definition + '。';
      } else if (type === 'multiple') {
        stem = occurrence
          ? '从“' + chapter.name + '”的适用条件角度辨析“' + current.term + '”，下列“术语—说明”配对中哪些正确？'
          : '在“' + chapter.name + '”中围绕“' + current.term + '”及相关概念，下列“术语—说明”配对中哪些正确？';
        entries = [
          { text: current.term + '：' + current.definition, correct: true },
          { text: other[0].term + '：' + other[0].definition, correct: true },
          { text: other[1].term + '：' + other[2].definition, correct: false },
          { text: other[2].term + '：' + other[1].definition, correct: false }
        ];
        explanation = '正确配对是“' + current.term + '—' + current.definition + '”和“' + other[0].term + '—' + other[0].definition + '”。';
      } else {
        const correctStatement = globalIndex % 2 === 0;
        const shownDefinition = correctStatement ? current.definition : other[0].definition;
        stem = (occurrence ? '辨析判断：' : '判断：') + current.term + '是指“' + shownDefinition + '”。';
        entries = [
          { text: '正确', correct: correctStatement },
          { text: '错误', correct: !correctStatement }
        ];
        explanation = current.term + '的准确含义是：' + current.definition + '。';
      }

      const optionsWithFlags = type === 'judge'
        ? entries.map((entry, index) => ({ id: optionLabels[index], label: optionLabels[index], text: entry.text, correct: entry.correct }))
        : makeOptions(entries, globalIndex % entries.length);
      const questionId = bank.prefix + String(globalIndex + 1).padStart(3, '0');
      const question = {
        id: questionId,
        subjectId: bank.subjectId,
        chapterId: chapter.id,
        chapterName: chapter.name,
        chapterOrder: chapterIndex + 1,
        type,
        stem,
        options: optionsWithFlags.map(({ id, label, text }) => ({ id, label, text })),
        correctOptionIds: optionsWithFlags.filter((option) => option.correct).map((option) => option.id),
        explanation,
        difficulty: 1,
        tags: [chapter.name, current.term],
        images: [],
        examScopes: bank.examScopes,
        status: 'active',
        version: 2
      };
      const override = hardOverrides[questionId];
      if (override) {
        if (question.type !== override.type) throw new Error(`${questionId} 覆盖题型必须保持为 ${question.type}`);
        question.stem = override.stem;
        question.options = override.options;
        question.correctOptionIds = override.correctOptionIds;
        question.explanation = override.explanation;
        question.tags = [chapter.name].concat(override.tags);
        question.difficulty = 3;
        question.version = 2;
      } else if (advancedOverrides[questionId]) {
        const advancedOverride = advancedOverrides[questionId];
        if (question.type !== advancedOverride.type) throw new Error(`${questionId} 进阶覆盖题型必须保持为 ${question.type}`);
        question.stem = advancedOverride.stem;
        question.options = advancedOverride.options;
        question.correctOptionIds = advancedOverride.correctOptionIds;
        question.explanation = advancedOverride.explanation;
        question.tags = [chapter.name].concat(advancedOverride.tags);
        question.difficulty = 2;
        question.version = 2;
      } else {
        question.difficultyRank = question.type === 'multiple'
          ? 0
          : question.type === 'judge' && question.correctOptionIds.includes('B')
            ? 1
            : occurrence
              ? 2
              : question.type === 'judge' ? 3 : 4;
      }
      questions.push(question);
      globalIndex += 1;
    }
  });
  const hardQuestions = questions.filter((question) => question.difficulty === 3);
  if (hardQuestions.length !== bank.difficultyCounts[2]) {
    throw new Error(`${bank.subjectId} 难题覆盖应为 ${bank.difficultyCounts[2]}，当前为 ${hardQuestions.length}`);
  }
  const curatedAdvanced = questions.filter((question) => question.difficulty === 2).length;
  const remainingAdvanced = bank.difficultyCounts[1] - curatedAdvanced;
  if (remainingAdvanced < 0) {
    throw new Error(`${bank.subjectId} 人工进阶题数量 ${curatedAdvanced} 超过配额 ${bank.difficultyCounts[1]}`);
  }
  const advancedCandidates = questions
    .filter((question) => question.difficulty === 1)
    .sort((left, right) => left.difficultyRank - right.difficultyRank || left.id.localeCompare(right.id));
  advancedCandidates.slice(0, remainingAdvanced).forEach((question) => { question.difficulty = 2; });
  const advancedQuestions = questions.filter((question) => question.difficulty === 2);
  if (advancedQuestions.length !== bank.difficultyCounts[1]) {
    throw new Error(`${bank.subjectId} 进阶题应为 ${bank.difficultyCounts[1]}，当前为 ${advancedQuestions.length}`);
  }
  questions.forEach((question) => { delete question.difficultyRank; });
  return questions;
}

function normalizeCpp() {
  const file = path.join(root, 'content', 'cpp-questions.json');
  const questions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hard = new Set(['cpp043','cpp044','cpp054','cpp059','cpp063','cpp064','cpp065','cpp068','cpp074','cpp077','cpp081','cpp082','cpp086','cpp098','cpp100']);
  const advanced = new Set(['cpp009','cpp010','cpp012','cpp015','cpp016','cpp020','cpp025','cpp029','cpp030','cpp032','cpp033','cpp037','cpp039','cpp042','cpp045','cpp049','cpp052','cpp053','cpp055','cpp060','cpp061','cpp062','cpp066','cpp067','cpp069','cpp073','cpp075','cpp076','cpp079','cpp083','cpp085','cpp089','cpp093','cpp096','cpp099']);
  if (hard.size !== 15 || advanced.size !== 35) throw new Error('C/C++ 难度集合数量错误');
  questions.forEach((question) => {
    question.subjectId = 'cpp';
    question.images = question.images || [];
    question.examScopes = [];
    question.difficulty = hard.has(question.id) ? 3 : advanced.has(question.id) ? 2 : 1;
  });
  fs.writeFileSync(file, JSON.stringify(questions, null, 2) + '\n', 'utf8');
}

normalizeCpp();
banks.forEach((bank) => {
  const questions = generateBank(bank);
  fs.writeFileSync(path.join(root, 'content', bank.subjectId + '-questions.json'), JSON.stringify(questions, null, 2) + '\n', 'utf8');
  console.log('Generated ' + bank.subjectId + ': ' + questions.length + ' questions.');
});
