function choiceAnswer(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  return (question.correctOptionIds || [])
    .map((id) => options.find((option) => option.id === id))
    .filter(Boolean)
    .map((option) => `${option.label}. ${option.text}`)
    .join('；');
}

function answerText(question) {
  if (question.type === 'fill_blank') {
    return (question.acceptedAnswers || [])
      .map((answers, index) => `第 ${index + 1} 空：${(answers || []).join(' / ')}`)
      .join('；');
  }
  if (question.type === 'short_answer') return question.referenceAnswer || '暂无参考答案';
  return choiceAnswer(question);
}

module.exports = { answerText };
