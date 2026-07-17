const auth = require('../../utils/auth');
const repository = require('../../services/practiceRepository');
const registry = require('../../config/subjectRegistry');
const { answerText } = require('../../utils/questionAnswerPresentation');

Page({
  data: {
    subjectFilters: [{ id: '', name: '全部' }].concat(registry.getSubjects()),
    subjectId: '',
    mastery: 'all',
    loading: true,
    error: '',
    questions: []
  },

  onShow() {
    if (!auth.requireLogin('/pages/wrong/index')) return;
    repository.getCatalog().then((catalog) => {
      registry.applyCatalog(catalog);
      this.setData({ subjectFilters: [{ id: '', name: '全部' }].concat(registry.getSubjects()) });
    }).catch(() => null).then(() => this.loadQuestions());
  },

  onPullDownRefresh() {
    this.loadQuestions().finally(() => wx.stopPullDownRefresh());
  },

  loadQuestions() {
    const mastered = this.data.mastery === 'all' ? undefined : this.data.mastery === 'mastered';
    this.setData({ loading: true, error: '' });
    return repository.getWrongQuestions(this.data.subjectId || undefined, mastered)
      .then((questions) => this.setData({ questions: questions.map((item) => this.decorate(item)), loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '错题加载失败' }));
  },

  decorate(question) {
    const subject = registry.getSubject(question.subjectId);
    return Object.assign({}, question, {
      subjectName: subject ? subject.shortName : question.subjectId,
      answerText: answerText(question)
    });
  },

  changeSubject(event) {
    this.setData({ subjectId: event.currentTarget.dataset.id || '' });
    this.loadQuestions();
  },

  changeMastery(event) {
    this.setData({ mastery: event.currentTarget.dataset.value });
    this.loadQuestions();
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: [src] });
  },

  startReview() {
    if (!this.data.subjectId) {
      wx.showToast({ title: '请先选择一个学科', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/modules/cpp/pages/setup/index?subjectId=${this.data.subjectId}&mode=wrong` });
  }
});
