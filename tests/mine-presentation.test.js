const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildMinePresentation } = require('../miniprogram/utils/minePresentation');

const populated = buildMinePresentation({
  todayAttempts: 7,
  totalAttempts: 128,
  accuracy: 86,
  progressPercent: 42,
  unmasteredWrongCount: 9,
  favoriteCount: 12
});

assert.deepStrictEqual(populated.stats.map((item) => item.displayValue), ['7', '128', '86%', '42%']);
assert.deepStrictEqual(populated.shortcuts.map((item) => item.metaText), ['9 道', '12 道', '查看历史', '查看说明']);
assert.deepStrictEqual(populated.shortcuts.map((item) => item.navigation), ['tab', 'tab', 'page', 'page']);
assert.deepStrictEqual(populated.shortcuts.map((item) => item.url), [
  '/pages/wrong/index',
  '/pages/favorites/index',
  '/modules/cpp/pages/exam-history/index',
  '/pages/privacy/index'
]);

const empty = buildMinePresentation();
assert.deepStrictEqual(empty.stats.map((item) => item.displayValue), ['0', '0', '0%', '0%']);
assert.deepStrictEqual(empty.shortcuts.slice(0, 2).map((item) => item.metaText), ['0 道', '0 道']);

const normalized = buildMinePresentation({
  todayAttempts: -3,
  totalAttempts: 'invalid',
  accuracy: 105,
  progressPercent: 33.6,
  unmasteredWrongCount: null,
  favoriteCount: undefined
});
assert.deepStrictEqual(normalized.stats.map((item) => item.displayValue), ['0', '0', '100%', '34%']);

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
assert.deepStrictEqual(app.tabBar.list.map((item) => [item.pagePath, item.text]), [
  ['pages/index/index', '首页'],
  ['pages/wrong/index', '错题'],
  ['pages/favorites/index', '收藏'],
  ['pages/account/index', '我的']
]);
assert(app.pages.includes('pages/account/index'));

const accountConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/pages/account/index.json'), 'utf8'));
assert.strictEqual(accountConfig.navigationBarTitleText, '我的');
assert.strictEqual(accountConfig.enablePullDownRefresh, true);

const homeJs = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.js'), 'utf8');
const homeWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
assert(!homeJs.includes('openAccount'));
assert(!homeWxml.includes('account-entry'));

const privacyWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/privacy/index.wxml'), 'utf8');
assert(privacyWxml.includes('底部“我的”'));
assert(!privacyWxml.includes('首页 → 账户与数据'));

console.log('Mine presentation tests passed: stats, shortcuts, tab order and account entry are stable.');
