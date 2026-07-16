const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  initialGamification,
  awardAnswers,
  evaluateAchievements,
  getAchievements,
  leaderboard,
  normalizeDisplayName,
  periodBounds,
  updateProfile,
  equipTitle
} = require('../miniprogram/services/mock/gamificationCore');
const { ACHIEVEMENTS } = require('../miniprogram/utils/gamificationCatalog');

function state() {
  return { subjects: {}, exams: {}, gamification: initialGamification() };
}

function subject(stateValue, id) {
  if (!stateValue.subjects[id]) stateValue.subjects[id] = { attemptedQuestions: {}, wrongQuestions: {}, favorites: {}, totals: { attempts: 0, correct: 0 } };
  return stateValue.subjects[id];
}

{
  const value = state();
  const first = awardAnswers(value, [{ questionId: 'q1', subjectId: 'cpp', isCorrect: true, occurredAt: Date.UTC(2026, 6, 16, 1) }]);
  assert.strictEqual(first.pointsAwarded, 10);
  assert.deepStrictEqual(first.unlockedAchievements.map((item) => item.key), ['first-step']);
  const duplicate = awardAnswers(value, [{ questionId: 'q1', subjectId: 'cpp', isCorrect: true, occurredAt: Date.UTC(2026, 6, 16, 2) }]);
  assert.strictEqual(duplicate.pointsAwarded, 1);
  const sameDay = awardAnswers(value, [{ questionId: 'q1', subjectId: 'cpp', isCorrect: true, occurredAt: Date.UTC(2026, 6, 16, 3) }]);
  assert.strictEqual(sameDay.pointsAwarded, 0);
}

{
  const value = state();
  const mastered = Array.from({ length: 21 }, (_, index) => ({ questionId: `q${index}`, subjectId: 'cpp', isCorrect: true, occurredAt: Date.UTC(2026, 6, 15, 1) }));
  awardAnswers(value, mastered);
  const reviews = mastered.map((item) => Object.assign({}, item, { occurredAt: Date.UTC(2026, 6, 16, 1) }));
  assert.strictEqual(awardAnswers(value, reviews).pointsAwarded, 20);
  assert.strictEqual(awardAnswers(value, reviews).pointsAwarded, 0);
}

{
  const value = state();
  const ids = ['cpp', 'java', 'ds', 'co', 'os', 'network', 'database'];
  const inputs = Array.from({ length: 500 }, (_, index) => ({
    questionId: `q${index}`,
    subjectId: ids[index % ids.length],
    isCorrect: index < 300,
    occurredAt: Date.UTC(2026, 0, 1) + index * 1000
  }));
  awardAnswers(value, inputs);
  ids.forEach((id) => subject(value, id));
  Array.from({ length: 20 }, (_, index) => { subject(value, 'cpp').wrongQuestions[`w${index}`] = { mastered: true }; });
  Array.from({ length: 30 }, (_, index) => { subject(value, 'cpp').favorites[`f${index}`] = Date.now(); });
  value.exams.exam1 = { status: 'completed', result: { score: 80 } };
  value.gamification.profile.equippedAchievementKey = '';
  evaluateAchievements(value, Date.UTC(2026, 6, 16), true);
  const achievements = getAchievements(value, Date.UTC(2026, 6, 16));
  assert.strictEqual(achievements.unlockedCount, 12);
  assert.strictEqual(value.gamification.profile.equippedAchievementKey, 'perfect-legend');
  assert.deepStrictEqual(equipTitle(value, 'first-step', Date.now()).equippedTitle.title, '初试锋芒');
  assert.strictEqual(equipTitle(value, null, Date.now()).equippedTitle, null);
}

{
  assert.strictEqual(normalizeDisplayName('  ＡＢ_12  '), 'AB_12');
  assert.throws(() => normalizeDisplayName('管理员小米'), (error) => error.code === 'RESERVED_DISPLAY_NAME');
  assert.throws(() => normalizeDisplayName('加我wx123'), (error) => error.code === 'UNSAFE_DISPLAY_NAME');
  const value = state();
  const now = Date.UTC(2026, 6, 16);
  updateProfile(value, '每日一练', now);
  assert.throws(() => updateProfile(value, '勤学小王', now + 1000), (error) => error.code === 'NICKNAME_COOLDOWN');
}

{
  const mondayShanghai = Date.UTC(2026, 6, 12, 16);
  const bounds = periodBounds('weekly', Date.UTC(2026, 6, 15));
  assert.strictEqual(bounds.start, mondayShanghai);
  const value = state();
  awardAnswers(value, [{ questionId: 'q1', subjectId: 'cpp', isCorrect: true, occurredAt: Date.UTC(2026, 6, 15) }]);
  const board = leaderboard(value, 'all', 100, Date.UTC(2026, 6, 16));
  assert.strictEqual(board.podium.length, 3);
  assert.strictEqual(board.rankings[0].rank, 4);
  assert.strictEqual(board.currentUser.publicCode, 'A7K9');
  assert(!Object.prototype.hasOwnProperty.call(board.items[0], 'userId'));
}

{
  const files = ACHIEVEMENTS.map((item) => path.join(__dirname, '..', 'miniprogram', 'assets', 'achievements', `${item.iconKey}.png`));
  assert.strictEqual(new Set(files).size, 12);
  let totalBytes = 0;
  files.forEach((file) => {
    const data = fs.readFileSync(file);
    assert.deepStrictEqual(Array.from(data.subarray(1, 4)), [80, 78, 71]);
    assert.strictEqual(data.readUInt32BE(16), 128);
    assert.strictEqual(data.readUInt32BE(20), 128);
    assert(data.includes(Buffer.from('tRNS')) || data[25] === 4 || data[25] === 6);
    assert(data.length < 25 * 1024);
    totalBytes += data.length;
  });
  assert(totalBytes <= 350 * 1024);
}

console.log('Gamification tests passed: points, daily cap, achievements, nickname, periods and privacy-safe ranking.');
