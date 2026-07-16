const { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, publicAchievement } = require('../../utils/gamificationCatalog');

const DAY_MS = 24 * 60 * 60 * 1000;
const RENAME_COOLDOWN_MS = 30 * DAY_MS;

function initialGamification() {
  return {
    profile: {
      publicCode: 'A7K9',
      displayName: '',
      nicknameUpdatedAt: null,
      totalPoints: 0,
      equippedAchievementKey: '',
      pointsUpdatedAt: null
    },
    events: {},
    achievements: {}
  };
}

function shanghaiDayKey(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function periodBounds(period, now) {
  if (period === 'all') return { start: null, end: null };
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  let startShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  if (period === 'weekly') {
    const day = shifted.getUTCDay();
    startShifted -= (day === 0 ? 6 : day - 1) * DAY_MS;
  }
  const start = startShifted - 8 * 60 * 60 * 1000;
  return { start, end: start + (period === 'daily' ? DAY_MS : 7 * DAY_MS) };
}

function metrics(state) {
  const attempted = new Set();
  const correct = new Set();
  const subjects = new Set();
  let masteredWrong = 0;
  let favorites = 0;
  Object.keys(state.subjects || {}).forEach((subjectId) => {
    const subject = state.subjects[subjectId];
    masteredWrong += Object.values(subject.wrongQuestions || {}).filter((record) => record.mastered).length;
    favorites += Object.keys(subject.favorites || {}).length;
  });
  Object.keys((state.gamification && state.gamification.events) || {}).forEach((key) => {
    const event = state.gamification.events[key];
    if (key.startsWith('attempt:')) {
      attempted.add(event.questionId);
      if (event.subjectId) subjects.add(event.subjectId);
    }
    if (key.startsWith('correct:')) correct.add(event.questionId);
  });
  const completedExams = Object.values(state.exams || {}).filter((exam) => exam.status === 'completed');
  return {
    attempted: attempted.size,
    correct: correct.size,
    subjects: subjects.size,
    masteredWrong,
    favorites,
    completedExams: completedExams.length,
    maxExamScore: completedExams.reduce((score, exam) => Math.max(score, (exam.result && exam.result.score) || 0), 0)
  };
}

function evaluateAchievements(state, timestamp, preferHighest) {
  const values = metrics(state);
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach((achievement) => {
    if (values[achievement.metric] >= achievement.target && !state.gamification.achievements[achievement.key]) {
      state.gamification.achievements[achievement.key] = timestamp;
      newlyUnlocked.push(achievement);
    }
  });
  const profile = state.gamification.profile;
  const unlocked = ACHIEVEMENTS.filter((item) => state.gamification.achievements[item.key]);
  if (!profile.equippedAchievementKey && unlocked.length) {
    profile.equippedAchievementKey = preferHighest
      ? unlocked.slice().sort((a, b) => b.priority - a.priority)[0].key
      : (newlyUnlocked[0] || unlocked[0]).key;
  }
  return newlyUnlocked.map(publicAchievement);
}

function ensureGamification(state, timestamp) {
  if (state.gamification) return false;
  state.gamification = initialGamification();
  Object.entries(state.subjects || {}).forEach(([subjectId, subject]) => {
    Object.values(subject.attemptedQuestions || {}).forEach((record) => {
      const occurredAt = record.lastAttemptAt || timestamp;
      state.gamification.events[`attempt:${record.questionId}`] = { points: 2, occurredAt, questionId: record.questionId, subjectId };
      if (record.correct > 0) state.gamification.events[`correct:${record.questionId}`] = { points: 8, occurredAt, questionId: record.questionId, subjectId };
    });
  });
  const events = Object.values(state.gamification.events);
  state.gamification.profile.totalPoints = events.reduce((sum, event) => sum + event.points, 0);
  state.gamification.profile.pointsUpdatedAt = events.reduce((latest, event) => Math.max(latest || 0, event.occurredAt), 0) || null;
  evaluateAchievements(state, timestamp, true);
  return true;
}

function awardAnswers(state, inputs) {
  ensureGamification(state, Date.now());
  const gamification = state.gamification;
  const dailyCounts = {};
  Object.keys(gamification.events).filter((key) => key.startsWith('review:')).forEach((key) => {
    const dayKey = key.split(':')[1];
    dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
  });
  let pointsAwarded = 0;
  inputs.slice().sort((a, b) => a.occurredAt - b.occurredAt).forEach((input) => {
    const attemptKey = `attempt:${input.questionId}`;
    const correctKey = `correct:${input.questionId}`;
    const hadCorrect = Boolean(gamification.events[correctKey]);
    const add = (key, points) => {
      if (gamification.events[key]) return;
      gamification.events[key] = { points, occurredAt: input.occurredAt, questionId: input.questionId, subjectId: input.subjectId };
      pointsAwarded += points;
    };
    add(attemptKey, 2);
    if (input.isCorrect && !hadCorrect) add(correctKey, 8);
    else if (input.isCorrect && hadCorrect) {
      const dayKey = shanghaiDayKey(input.occurredAt);
      const reviewKey = `review:${dayKey}:${input.questionId}`;
      if ((dailyCounts[dayKey] || 0) < 20 && !gamification.events[reviewKey]) {
        add(reviewKey, 1);
        dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
      }
    }
  });
  const profile = gamification.profile;
  profile.totalPoints += pointsAwarded;
  if (pointsAwarded) profile.pointsUpdatedAt = Math.max(profile.pointsUpdatedAt || 0, ...inputs.map((item) => item.occurredAt));
  return {
    pointsAwarded,
    totalPoints: profile.totalPoints,
    unlockedAchievements: evaluateAchievements(state, inputs.length ? Math.max(...inputs.map((item) => item.occurredAt)) : Date.now(), false)
  };
}

function identity(profile) {
  const displayName = profile.displayName || '刷题者';
  return { displayName, publicCode: profile.publicCode, displayLabel: `${displayName}#${profile.publicCode}` };
}

function titleView(key) {
  return key ? publicAchievement(key) : null;
}

function scoreForPeriod(state, period, now) {
  const bounds = periodBounds(period, now);
  return Object.values(state.gamification.events).filter((event) => !bounds.start || (event.occurredAt >= bounds.start && event.occurredAt < bounds.end)).reduce((sum, event) => sum + event.points, 0);
}

const DEMO_USERS = [
  { displayName: '代码小将', publicCode: 'K8M2', total: 1260, weekly: 188, daily: 42, title: 'answer-master' },
  { displayName: '408冲刺者', publicCode: 'P3Q7', total: 1188, weekly: 176, daily: 38, title: 'exam-challenger' },
  { displayName: '算法旅人', publicCode: 'D6W4', total: 1120, weekly: 162, daily: 35, title: 'seven-subjects' },
  { displayName: '刷题者', publicCode: 'J9R5', total: 968, weekly: 141, daily: 30, title: 'precision-hunter' },
  { displayName: '基础夯实中', publicCode: 'T2N8', total: 820, weekly: 120, daily: 24, title: 'hundred-walker' },
  { displayName: '每日一练', publicCode: 'V7C3', total: 760, weekly: 102, daily: 18, title: 'study-star' }
];

function leaderboard(state, period, limit, now) {
  ensureGamification(state, now);
  const profile = state.gamification.profile;
  const currentPoints = scoreForPeriod(state, period, now);
  const currentReachedAt = Object.values(state.gamification.events).reduce((value, event) => Math.max(value, event.occurredAt || 0), 0);
  const rows = DEMO_USERS.map((user, index) => ({
    points: user[period === 'all' ? 'total' : period],
    reachedAt: now - (DEMO_USERS.length - index) * 60000,
    displayName: user.displayName,
    publicCode: user.publicCode,
    displayLabel: `${user.displayName}#${user.publicCode}`,
    title: titleView(user.title),
    isCurrentUser: false
  }));
  if (currentPoints > 0) rows.push(Object.assign({ points: currentPoints, reachedAt: currentReachedAt, title: titleView(profile.equippedAchievementKey), isCurrentUser: true }, identity(profile)));
  rows.sort((a, b) => b.points - a.points || a.reachedAt - b.reachedAt || a.publicCode.localeCompare(b.publicCode));
  const ranked = rows.map((row, index) => Object.assign({}, row, { rank: index + 1 }));
  const currentUser = ranked.find((row) => row.isCurrentUser) || Object.assign({ rank: null, points: 0, title: titleView(profile.equippedAchievementKey), isCurrentUser: true }, identity(profile));
  const bounds = periodBounds(period, now);
  const items = ranked.slice(0, Math.min(100, Math.max(1, Number(limit) || 100)));
  return {
    period,
    startsAt: bounds.start ? new Date(bounds.start).toISOString() : null,
    endsAt: bounds.end ? new Date(bounds.end).toISOString() : null,
    items,
    podium: items.slice(0, 3),
    rankings: items.slice(3),
    currentUser
  };
}

function getGamificationMe(state, now) {
  ensureGamification(state, now);
  evaluateAchievements(state, now, false);
  const profile = state.gamification.profile;
  const daily = leaderboard(state, 'daily', 100, now);
  const weekly = leaderboard(state, 'weekly', 100, now);
  const total = leaderboard(state, 'all', 100, now);
  const values = metrics(state);
  return {
    identity: identity(profile),
    nicknameUpdatedAt: profile.nicknameUpdatedAt ? new Date(profile.nicknameUpdatedAt).toISOString() : null,
    nextRenameAt: profile.nicknameUpdatedAt ? new Date(profile.nicknameUpdatedAt + RENAME_COOLDOWN_MS).toISOString() : null,
    points: { total: profile.totalPoints, today: daily.currentUser.points, thisWeek: weekly.currentUser.points },
    ranks: { daily: daily.currentUser.rank, weekly: weekly.currentUser.rank, all: total.currentUser.rank },
    attemptedQuestionCount: values.attempted,
    correctQuestionCount: values.correct,
    equippedTitle: titleView(profile.equippedAchievementKey),
    unlockedCount: Object.keys(state.gamification.achievements).length,
    totalAchievements: ACHIEVEMENTS.length
  };
}

function normalizeDisplayName(rawName) {
  const value = String(rawName || '').normalize('NFKC').trim();
  if (Array.from(value).length < 2 || Array.from(value).length > 12 || !/^[\p{L}\p{N}][\p{L}\p{N}_]{1,11}$/u.test(value)) throw createError('昵称仅支持 2–12 位中文、字母、数字和下划线', 'INVALID_DISPLAY_NAME');
  const lower = value.toLowerCase();
  if (['管理员', '官方', '系统', '客服', '趣刷题喽', '趣字节'].some((word) => lower.includes(word))) throw createError('昵称包含系统保留词', 'RESERVED_DISPLAY_NAME');
  if (/(微信|wechat|\bwx\b|qq|vx|加我|联系我|\d{7,})/iu.test(lower)) throw createError('昵称包含不适合公开展示的内容', 'UNSAFE_DISPLAY_NAME');
  return value;
}

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function updateProfile(state, rawName, now) {
  ensureGamification(state, now);
  const profile = state.gamification.profile;
  if (profile.nicknameUpdatedAt && profile.nicknameUpdatedAt + RENAME_COOLDOWN_MS > now) {
    const error = createError('昵称每 30 天只能修改一次', 'NICKNAME_COOLDOWN');
    error.nextAllowedAt = new Date(profile.nicknameUpdatedAt + RENAME_COOLDOWN_MS).toISOString();
    throw error;
  }
  profile.displayName = normalizeDisplayName(rawName);
  profile.nicknameUpdatedAt = now;
  return Object.assign(identity(profile), { nicknameUpdatedAt: new Date(now).toISOString(), nextRenameAt: new Date(now + RENAME_COOLDOWN_MS).toISOString() });
}

function getAchievements(state, now) {
  ensureGamification(state, now);
  evaluateAchievements(state, now, false);
  const values = metrics(state);
  const profile = state.gamification.profile;
  return {
    unlockedCount: Object.keys(state.gamification.achievements).length,
    totalCount: ACHIEVEMENTS.length,
    equippedAchievementKey: profile.equippedAchievementKey || null,
    items: ACHIEVEMENTS.map((item) => {
      const progress = Math.min(item.target, values[item.metric] || 0);
      const unlockedAt = state.gamification.achievements[item.key];
      return Object.assign(publicAchievement(item), {
        target: item.target,
        progress,
        progressPercent: Math.round((progress / item.target) * 100),
        unlocked: Boolean(unlockedAt),
        unlockedAt: unlockedAt ? new Date(unlockedAt).toISOString() : null,
        equipped: profile.equippedAchievementKey === item.key
      });
    })
  };
}

function equipTitle(state, achievementKey, now) {
  ensureGamification(state, now);
  if (achievementKey && !ACHIEVEMENT_BY_KEY[achievementKey]) throw createError('称号不存在', 'ACHIEVEMENT_NOT_FOUND');
  if (achievementKey && !state.gamification.achievements[achievementKey]) throw createError('该称号尚未解锁', 'ACHIEVEMENT_LOCKED');
  state.gamification.profile.equippedAchievementKey = achievementKey || '';
  return { equippedTitle: titleView(achievementKey) };
}

module.exports = {
  initialGamification,
  ensureGamification,
  awardAnswers,
  evaluateAchievements,
  getGamificationMe,
  leaderboard,
  updateProfile,
  getAchievements,
  equipTitle,
  normalizeDisplayName,
  periodBounds,
  shanghaiDayKey
};
