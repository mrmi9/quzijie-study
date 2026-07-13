const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: { loading: true, error: '', result: null, wrongReviews: [] },

  onLoad(options) {
    this.examId = options.examId || '';
    this.loadResult();
  },

  loadResult() {
    if (!this.examId) {
      this.setData({ loading: false, error: '缺少考试结果标识' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    return repository.getExamResult(this.examId).then((result) => {
      const subjects = result.subjects.map((item) => Object.assign({}, item, { subjectName: (registry.getSubject(item.subjectId) || {}).shortName || item.subjectId }));
      const wrongReviews = result.reviews.filter((item) => !item.isCorrect).map((item, index) => this.decorateReview(item, index));
      this.setData({ result: Object.assign({}, result, { subjects }), wrongReviews, loading: false });
    }).catch((error) => this.setData({ loading: false, error: error.message || '考试报告加载失败' }));
  },

  decorateReview(review, index) {
    const question = review.question;
    const optionText = (ids) => ids.map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => `${option.label}. ${option.text}`).join('；');
    return Object.assign({}, review, {
      reviewIndex: index + 1,
      subjectName: (registry.getSubject(question.subjectId) || {}).shortName || question.subjectId,
      selectedText: review.selectedOptionIds.length ? optionText(review.selectedOptionIds) : '未作答',
      correctText: optionText(question.correctOptionIds)
    });
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: [src] });
  },

  openWrong() { wx.switchTab({ url: '/pages/wrong/index' }); },
  goExamHome() { wx.redirectTo({ url: '/modules/cpp/pages/exam-home/index' }); }
});
