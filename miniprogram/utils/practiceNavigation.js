function buildPracticeNavigationState({ currentIndex = 0, totalCount = 0 } = {}) {
  const total = Number.isInteger(totalCount) && totalCount > 0 ? totalCount : 0;
  const maxIndex = Math.max(0, total - 1);
  const requestedIndex = Number.isInteger(currentIndex) ? currentIndex : 0;
  const index = Math.min(Math.max(0, requestedIndex), maxIndex);

  return {
    currentIndex: index,
    isFirst: index === 0,
    isLast: total > 0 && index === maxIndex,
    previousIndex: Math.max(0, index - 1),
    nextIndex: Math.min(maxIndex, index + 1)
  };
}

module.exports = { buildPracticeNavigationState };
