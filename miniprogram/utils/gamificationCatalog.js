const ACHIEVEMENTS = [
  { key: 'first-step', title: '初试锋芒', description: '完成首次作答', iconKey: 'first-step', rarity: 'common', metric: 'attempted', target: 1, priority: 1 },
  { key: 'study-star', title: '勤学新星', description: '作答 10 道不同题目', iconKey: 'study-star', rarity: 'common', metric: 'attempted', target: 10, priority: 2 },
  { key: 'hundred-walker', title: '百题行者', description: '作答 100 道不同题目', iconKey: 'hundred-walker', rarity: 'rare', metric: 'attempted', target: 100, priority: 3 },
  { key: 'question-pioneer', title: '题海先锋', description: '作答 300 道不同题目', iconKey: 'question-pioneer', rarity: 'epic', metric: 'attempted', target: 300, priority: 4 },
  { key: 'bank-conqueror', title: '题库征服者', description: '作答 500 道不同题目', iconKey: 'bank-conqueror', rarity: 'legendary', metric: 'attempted', target: 500, priority: 5 },
  { key: 'precision-hunter', title: '精准猎手', description: '答对 50 道不同题目', iconKey: 'precision-hunter', rarity: 'rare', metric: 'correct', target: 50, priority: 6 },
  { key: 'answer-master', title: '答题大师', description: '答对 300 道不同题目', iconKey: 'answer-master', rarity: 'epic', metric: 'correct', target: 300, priority: 7 },
  { key: 'seven-subjects', title: '七科探索者', description: '在七个学科中均有作答', iconKey: 'seven-subjects', rarity: 'epic', metric: 'subjects', target: 7, priority: 8 },
  { key: 'wrong-terminator', title: '错题终结者', description: '掌握 20 道错题', iconKey: 'wrong-terminator', rarity: 'epic', metric: 'masteredWrong', target: 20, priority: 9 },
  { key: 'knowledge-collector', title: '知识收藏家', description: '当前收藏达到 30 道题目', iconKey: 'knowledge-collector', rarity: 'rare', metric: 'favorites', target: 30, priority: 10 },
  { key: 'exam-challenger', title: '408 挑战者', description: '完成首次 408 模拟考试', iconKey: 'exam-challenger', rarity: 'rare', metric: 'completedExams', target: 1, priority: 11 },
  { key: 'perfect-legend', title: '满分传说', description: '408 模拟考试获得 80 分', iconKey: 'perfect-legend', rarity: 'legendary', metric: 'maxExamScore', target: 80, priority: 12 }
].map((item) => Object.assign(item, { iconPath: `/assets/achievements/${item.iconKey}.png` }));

const ACHIEVEMENT_BY_KEY = ACHIEVEMENTS.reduce((map, item) => {
  map[item.key] = item;
  return map;
}, {});

const RARITY_NAMES = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };

function publicAchievement(keyOrDefinition) {
  const item = typeof keyOrDefinition === 'string' ? ACHIEVEMENT_BY_KEY[keyOrDefinition] : keyOrDefinition;
  if (!item) return null;
  return {
    key: item.key,
    title: item.title,
    description: item.description,
    iconKey: item.iconKey,
    iconPath: item.iconPath,
    rarity: item.rarity,
    rarityName: RARITY_NAMES[item.rarity]
  };
}

module.exports = { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, RARITY_NAMES, publicAchievement };
