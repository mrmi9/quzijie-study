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

module.exports = { decorateGlobalPracticeResult, decorateSubjectPracticeResult };
