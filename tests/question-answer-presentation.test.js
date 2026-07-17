const assert = require('assert');
const { answerText } = require('../miniprogram/utils/questionAnswerPresentation');

assert.equal(answerText({ type: 'single', correctOptionIds: ['B'], options: [{ id: 'A', label: 'A', text: '错' }, { id: 'B', label: 'B', text: '对' }] }), 'B. 对');
assert.equal(answerText({ type: 'fill_blank', acceptedAnswers: [['80'], ['HTTP', 'http']] }), '第 1 空：80；第 2 空：HTTP / http');
assert.equal(answerText({ type: 'short_answer', referenceAnswer: '保留历史并恢复稳定版本。' }), '保留历史并恢复稳定版本。');
console.log('Question answer presentation tests passed.');
