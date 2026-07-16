const assert = require('assert');
const { buildPracticeOptionFeedback } = require('../miniprogram/utils/practiceOptionFeedback');

const options = [
  { id: 'A', label: 'A', text: '选项 A' },
  { id: 'B', label: 'B', text: '选项 B' },
  { id: 'C', label: 'C', text: '选项 C' }
];

function feedbackStates(result) {
  return Object.fromEntries(result.options.map((option) => [option.id, option.feedbackState]));
}

function stateClasses(result) {
  return Object.fromEntries(result.options.map((option) => [option.id, option.stateClass]));
}

const beforeSubmit = buildPracticeOptionFeedback({
  options,
  questionType: 'multiple',
  selectedOptionIds: ['A'],
  correctOptionIds: ['A', 'C'],
  reviewed: false
});
assert.deepEqual(feedbackStates(beforeSubmit), { A: 'selected', B: 'neutral', C: 'neutral' });
assert.deepEqual(stateClasses(beforeSubmit), { A: 'option-selected', B: '', C: '' });
assert(beforeSubmit.options.every((option) => !option.correct && !option.missed));
assert.equal(beforeSubmit.missedAnswerText, '');

const partial = buildPracticeOptionFeedback({
  options,
  questionType: 'multiple',
  selectedOptionIds: ['A'],
  correctOptionIds: ['A', 'C'],
  reviewed: true
});
assert.deepEqual(feedbackStates(partial), { A: 'correct', B: 'neutral', C: 'missed' });
assert.deepEqual(stateClasses(partial), { A: 'option-correct', B: '', C: 'option-missed' });
assert.equal(partial.missedAnswerText, 'C');

const partialWithWrong = buildPracticeOptionFeedback({
  options,
  questionType: 'multiple',
  selectedOptionIds: ['A', 'B'],
  correctOptionIds: ['A', 'C'],
  reviewed: true
});
assert.deepEqual(feedbackStates(partialWithWrong), { A: 'correct', B: 'wrong', C: 'missed' });
assert.deepEqual(stateClasses(partialWithWrong), { A: 'option-correct', B: 'option-wrong', C: 'option-missed' });
assert.equal(partialWithWrong.missedAnswerText, 'C');

const exact = buildPracticeOptionFeedback({
  options,
  questionType: 'multiple',
  selectedOptionIds: ['A', 'C'],
  correctOptionIds: ['A', 'C'],
  reviewed: true
});
assert.deepEqual(feedbackStates(exact), { A: 'correct', B: 'neutral', C: 'correct' });
assert.deepEqual(stateClasses(exact), { A: 'option-correct', B: '', C: 'option-correct' });
assert.equal(exact.missedAnswerText, '');

const singleWrong = buildPracticeOptionFeedback({
  options,
  questionType: 'single',
  selectedOptionIds: ['B'],
  correctOptionIds: ['A'],
  reviewed: true
});
assert.deepEqual(feedbackStates(singleWrong), { A: 'correct', B: 'wrong', C: 'neutral' });
assert.deepEqual(stateClasses(singleWrong), { A: 'option-correct', B: 'option-wrong', C: '' });
assert.equal(singleWrong.missedAnswerText, '');

const judgeWrong = buildPracticeOptionFeedback({
  options: options.slice(0, 2),
  questionType: 'judge',
  selectedOptionIds: ['B'],
  correctOptionIds: ['A'],
  reviewed: true
});
assert.deepEqual(feedbackStates(judgeWrong), { A: 'correct', B: 'wrong' });
assert.deepEqual(stateClasses(judgeWrong), { A: 'option-correct', B: 'option-wrong' });
assert.equal(judgeWrong.missedAnswerText, '');

assert.deepEqual(
  buildPracticeOptionFeedback({
    options,
    questionType: 'multiple',
    selectedOptionIds: ['A'],
    correctOptionIds: ['A', 'C'],
    reviewed: true
  }),
  partial
);

console.log('Practice option feedback tests passed: selected, correct, wrong and missed states are distinct.');
