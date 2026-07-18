const assert = require('assert');
const {
  getGlobalPracticePresentation,
  decorateGlobalPracticeResult,
  decorateSubjectPracticeResult
} = require('../miniprogram/utils/globalPracticePresentation');

const favoritePresentation = getGlobalPracticePresentation('favorite');
assert.strictEqual(favoritePresentation.modeName, '全学科收藏重练');
assert.strictEqual(favoritePresentation.setupTitle, '全部学科收藏');
assert.strictEqual(favoritePresentation.allCountLabel, '全部收藏');
assert.strictEqual(favoritePresentation.resultTitle, '全学科收藏结果');
assert.strictEqual(favoritePresentation.setupUrl, '/modules/cpp/pages/setup/index?scope=all&mode=favorite');

const wrongPresentation = getGlobalPracticePresentation('wrong');
assert.strictEqual(wrongPresentation.modeName, '全学科错题重做');
assert.strictEqual(wrongPresentation.setupTitle, '全部学科未掌握错题');
assert.strictEqual(wrongPresentation.allCountLabel, '全部未掌握错题');
assert.strictEqual(wrongPresentation.resultTitle, '全学科错题结果');
assert.strictEqual(wrongPresentation.setupUrl, '/modules/cpp/pages/setup/index?scope=all&mode=wrong');
assert.strictEqual(getGlobalPracticePresentation('random'), null);

const subjects = [
  { id: 'cpp', name: 'C/C++', shortName: 'C/C++' },
  { id: 'ds', name: '数据结构', shortName: '数据结构' },
  { id: 'os', name: '操作系统', shortName: '操作系统' }
];

const result = decorateGlobalPracticeResult({
  subjects: [
    { subjectId: 'os', totalCount: 2, correctCount: 1, accuracy: 50 },
    { subjectId: 'cpp', totalCount: 1, correctCount: 1, wrongCount: 0, accuracy: 100 }
  ],
  chapters: [
    { subjectId: 'os', chapterId: 'process', chapterName: '进程', totalCount: 2, correctCount: 1, accuracy: 50 },
    { subjectId: 'cpp', chapterId: 'basic', chapterName: '基础', totalCount: 1, correctCount: 1, accuracy: 100 }
  ]
}, subjects);

assert.deepStrictEqual(result.subjects.map((item) => item.subjectId), ['cpp', 'os']);
assert.deepStrictEqual(result.subjects.map((item) => item.subjectName), ['C/C++', '操作系统']);
assert.deepStrictEqual(result.subjects.map((item) => item.wrongCount), [0, 1]);
assert.deepStrictEqual(result.chapters.map((item) => item.resultKey), ['cpp_basic', 'os_process']);
assert.deepStrictEqual(result.chapters.map((item) => item.subjectName), ['C/C++', '操作系统']);
assert.deepStrictEqual(result.chapters.map((item) => item.displayName), ['C/C++ · 基础', '操作系统 · 进程']);
assert.strictEqual(result.chapters.some((item) => Object.prototype.hasOwnProperty.call(item, 'originalIndex')), false);

const subjectResult = decorateSubjectPracticeResult({
  chapters: [{ chapterId: 'basic', chapterName: '基础', totalCount: 1, correctCount: 1, accuracy: 100 }]
}, 'C/C++');
assert.strictEqual(subjectResult.chapters[0].resultKey, 'basic');
assert.strictEqual(subjectResult.chapters[0].displayName, '基础');

console.log('Global practice presentation tests passed.');
