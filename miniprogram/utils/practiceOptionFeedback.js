const STATE_CLASSES = {
  neutral: '',
  selected: 'option-selected',
  correct: 'option-correct',
  wrong: 'option-wrong',
  missed: 'option-missed'
};

function asIdSet(optionIds) {
  return new Set(Array.isArray(optionIds) ? optionIds : []);
}

function buildPracticeOptionFeedback({
  options = [],
  questionType = '',
  selectedOptionIds = [],
  correctOptionIds = [],
  reviewed = false
}) {
  const selectedIds = asIdSet(selectedOptionIds);
  const correctIds = reviewed ? asIdSet(correctOptionIds) : new Set();

  const decoratedOptions = options.map((option) => {
    const selected = selectedIds.has(option.id);
    const correct = correctIds.has(option.id);
    let feedbackState = selected ? 'selected' : 'neutral';

    if (reviewed) {
      if (selected && correct) feedbackState = 'correct';
      else if (selected) feedbackState = 'wrong';
      else if (correct && questionType === 'multiple') feedbackState = 'missed';
      else if (correct) feedbackState = 'correct';
      else feedbackState = 'neutral';
    }

    return Object.assign({}, option, {
      selected,
      correct,
      missed: feedbackState === 'missed',
      feedbackState,
      stateClass: STATE_CLASSES[feedbackState]
    });
  });

  const missedAnswerText = decoratedOptions
    .filter((option) => option.missed)
    .map((option) => option.label)
    .filter(Boolean)
    .join('、');

  return { options: decoratedOptions, missedAnswerText };
}

module.exports = { buildPracticeOptionFeedback };
