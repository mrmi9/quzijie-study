const GLOBAL_PRACTICE_PRESENTATIONS = {
  favorite: {
    modeName: '全学科收藏重练',
    setupTitle: '全部学科收藏',
    setupTip: '系统将从所有学科的收藏题中随机混排；固定题量不足时使用全部收藏。',
    allCountLabel: '全部收藏',
    resultTitle: '全学科收藏结果',
    setupUrl: '/modules/cpp/pages/setup/index?scope=all&mode=favorite'
  },
  wrong: {
    modeName: '全学科错题重做',
    setupTitle: '全部学科未掌握错题',
    setupTip: '系统将从所有学科的未掌握错题中随机混排；固定题量不足时使用全部未掌握错题。',
    allCountLabel: '全部未掌握错题',
    resultTitle: '全学科错题结果',
    setupUrl: '/modules/cpp/pages/setup/index?scope=all&mode=wrong'
  }
};

function getGlobalPracticePresentation(mode) {
  return GLOBAL_PRACTICE_PRESENTATIONS[mode] || null;
}

function decorateGlobalPracticeResult(result, subjects) {
  const subjectList = Array.isArray(subjects) ? subjects : [];
  const subjectById = {};
  const orderById = {};
  subjectList.forEach((subject, index) => {
    subjectById[subject.id] = subject;
    orderById[subject.id] = index;
  });

  const subjectStats = (result.subjects || []).map((item) => {
    const subject = subjectById[item.subjectId];
    return Object.assign({}, item, {
      subjectName: subject ? subject.name : item.subjectId,
      wrongCount: item.wrongCount === undefined ? item.totalCount - item.correctCount : item.wrongCount
    });
  }).sort((left, right) => {
    const leftOrder = orderById[left.subjectId] === undefined ? Number.MAX_SAFE_INTEGER : orderById[left.subjectId];
    const rightOrder = orderById[right.subjectId] === undefined ? Number.MAX_SAFE_INTEGER : orderById[right.subjectId];
    return leftOrder - rightOrder;
  });

  const chapters = (result.chapters || []).map((item, index) => {
    const subject = subjectById[item.subjectId];
    return Object.assign({}, item, {
      subjectName: subject ? subject.shortName || subject.name : item.subjectId,
      displayName: `${subject ? subject.shortName || subject.name : item.subjectId} · ${item.chapterName}`,
      resultKey: `${item.subjectId || 'unknown'}_${item.chapterId || index}`,
      originalIndex: index
    });
  }).sort((left, right) => {
    const leftOrder = orderById[left.subjectId] === undefined ? Number.MAX_SAFE_INTEGER : orderById[left.subjectId];
    const rightOrder = orderById[right.subjectId] === undefined ? Number.MAX_SAFE_INTEGER : orderById[right.subjectId];
    return leftOrder === rightOrder ? left.originalIndex - right.originalIndex : leftOrder - rightOrder;
  }).map((item) => {
    const decorated = Object.assign({}, item);
    delete decorated.originalIndex;
    return decorated;
  });

  return Object.assign({}, result, { subjects: subjectStats, chapters });
}

function decorateSubjectPracticeResult(result, subjectName) {
  return Object.assign({}, result, {
    chapters: (result.chapters || []).map((item, index) => Object.assign({}, item, {
      displayName: item.chapterName,
      resultKey: item.chapterId || `${subjectName || 'subject'}_${index}`
    }))
  });
}

module.exports = { getGlobalPracticePresentation, decorateGlobalPracticeResult, decorateSubjectPracticeResult };
