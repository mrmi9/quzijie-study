function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}

function percentage(value) {
  return Math.min(100, nonNegativeInteger(value));
}

function buildMinePresentation(overview = {}) {
  const wrongCount = nonNegativeInteger(overview.unmasteredWrongCount);
  const favoriteCount = nonNegativeInteger(overview.favoriteCount);

  return {
    stats: [
      { id: 'today', label: '今日答题', displayValue: String(nonNegativeInteger(overview.todayAttempts)) },
      { id: 'total', label: '累计答题', displayValue: String(nonNegativeInteger(overview.totalAttempts)) },
      { id: 'accuracy', label: '累计正确率', displayValue: `${percentage(overview.accuracy)}%` },
      { id: 'progress', label: '全题库进度', displayValue: `${percentage(overview.progressPercent)}%` }
    ],
    shortcuts: [
      { id: 'wrong', title: '错题本', subtitle: '集中重做未掌握题目', metaText: `${wrongCount} 道`, url: '/pages/wrong/index', navigation: 'tab' },
      { id: 'favorite', title: '我的收藏', subtitle: '按学科或跨学科重练', metaText: `${favoriteCount} 道`, url: '/pages/favorites/index', navigation: 'tab' },
      { id: 'exam-history', title: '408 考试记录', subtitle: '查看历史成绩与解析', metaText: '查看历史', url: '/modules/cpp/pages/exam-history/index', navigation: 'page' },
      { id: 'privacy', title: '隐私说明', subtitle: '数据使用、保存与删除', metaText: '查看说明', url: '/pages/privacy/index', navigation: 'page' }
    ]
  };
}

module.exports = { buildMinePresentation };
