const assert = require('assert');
const questions = require('../content/cpp-questions.json');
const { CppMockCore, sameAnswer } = require('../miniprogram/services/mock/cppMockCore');

function createStorage() {
  const values = {};
  return {
    get(key) { return values[key] ? JSON.parse(JSON.stringify(values[key])) : undefined; },
    set(key, value) { values[key] = JSON.parse(JSON.stringify(value)); }
  };
}

let clock = 1000;
const core = new CppMockCore({
  questions,
  storage: createStorage(),
  random: () => 0.37,
  now: () => ++clock
});

assert.strictEqual(questions.length, 100);
assert.strictEqual(core.getChapters().length, 9);
assert.strictEqual(core.getOverview().totalQuestions, 100);
assert.strictEqual(sameAnswer(['A', 'B'], ['B', 'A']), true);

const session = core.createSession({ subject: 'cpp', mode: 'random', count: 5 });
assert.strictEqual(session.totalCount, 5);
assert.strictEqual(new Set(session.questions.map((question) => question.id)).size, 5);
assert.ok(session.questions.every((question) => question.correctOptionIds === undefined));
assert.ok(session.questions.every((question) => question.explanation === undefined));

const first = session.questions[0];
const sourceFirst = questions.find((question) => question.id === first.id);
const wrongOption = first.options.find((option) => !sourceFirst.correctOptionIds.includes(option.id));
const clientAnswerId = 'answer-once';
const wrongResult = core.submitAnswer(session.id, {
  questionId: first.id,
  selectedOptionIds: [wrongOption.id],
  clientAnswerId
});
assert.strictEqual(wrongResult.isCorrect, false);
assert.strictEqual(core.getWrongQuestions(false).length, 1);

const idempotentResult = core.submitAnswer(session.id, {
  questionId: first.id,
  selectedOptionIds: [wrongOption.id],
  clientAnswerId
});
assert.deepStrictEqual(idempotentResult, wrongResult);
assert.strictEqual(core.getOverview().totalAttempts, 1);

assert.throws(() => core.submitAnswer(session.id, {
  questionId: first.id,
  selectedOptionIds: sourceFirst.correctOptionIds,
  clientAnswerId: 'different-id'
}), (error) => error.code === 'ANSWER_ALREADY_SUBMITTED');

session.questions.slice(1).forEach((question, index) => {
  const source = questions.find((item) => item.id === question.id);
  core.submitAnswer(session.id, {
    questionId: question.id,
    selectedOptionIds: source.correctOptionIds,
    clientAnswerId: `complete-${index}`
  });
});
const result = core.finishSession(session.id);
assert.strictEqual(result.totalCount, 5);
assert.strictEqual(result.correctCount, 4);
assert.strictEqual(core.finishSession(session.id).status, 'completed');

const wrongSession = core.createSession({ subject: 'cpp', mode: 'wrong', count: 20 });
assert.strictEqual(wrongSession.totalCount, 1);
core.submitAnswer(wrongSession.id, {
  questionId: first.id,
  selectedOptionIds: sourceFirst.correctOptionIds,
  clientAnswerId: 'master-wrong'
});
core.finishSession(wrongSession.id);
assert.strictEqual(core.getWrongQuestions(true).length, 1);
assert.strictEqual(core.getWrongQuestions(false).length, 0);

core.setFavorite(first.id, true);
assert.strictEqual(core.getFavorites().length, 1);
const favoriteSession = core.createSession({ subject: 'cpp', mode: 'favorite', count: 20 });
assert.strictEqual(favoriteSession.totalCount, 1);
core.setFavorite(first.id, false);
assert.strictEqual(core.getFavorites().length, 0);

console.log('Mock core flows passed.');
