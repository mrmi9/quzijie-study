const assert = require('assert');
const { buildPracticeNavigationState } = require('../miniprogram/utils/practiceNavigation');

assert.deepEqual(buildPracticeNavigationState({ currentIndex: 0, totalCount: 5 }), {
  currentIndex: 0,
  isFirst: true,
  isLast: false,
  previousIndex: 0,
  nextIndex: 1
});

assert.deepEqual(buildPracticeNavigationState({ currentIndex: 2, totalCount: 5 }), {
  currentIndex: 2,
  isFirst: false,
  isLast: false,
  previousIndex: 1,
  nextIndex: 3
});

assert.deepEqual(buildPracticeNavigationState({ currentIndex: 4, totalCount: 5 }), {
  currentIndex: 4,
  isFirst: false,
  isLast: true,
  previousIndex: 3,
  nextIndex: 4
});

assert.deepEqual(buildPracticeNavigationState({ currentIndex: -2, totalCount: 5 }), {
  currentIndex: 0,
  isFirst: true,
  isLast: false,
  previousIndex: 0,
  nextIndex: 1
});

assert.deepEqual(buildPracticeNavigationState({ currentIndex: 8, totalCount: 5 }), {
  currentIndex: 4,
  isFirst: false,
  isLast: true,
  previousIndex: 3,
  nextIndex: 4
});

assert.deepEqual(buildPracticeNavigationState(), {
  currentIndex: 0,
  isFirst: true,
  isLast: false,
  previousIndex: 0,
  nextIndex: 0
});

console.log('Practice navigation tests passed: previous and next indexes stay within session boundaries.');
