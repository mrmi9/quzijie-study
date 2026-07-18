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
    questions: [],
    unmasteredCount: 0
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
    const subjectId = this.data.subjectId || undefined;
    this.setData({ loading: true, error: '' });
    return Promise.all([
      repository.getWrongQuestions(subjectId, mastered),
      repository.getWrongQuestions(subjectId, false)
    ])
      .then(([questions, unmastered]) => this.setData({
        questions: questions.map((item) => this.decorate(item)),
        unmasteredCount: unmastered.length,
        loading: false
      }))
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
    if (this.data.loading || this.data.error) return;
    if (!this.data.unmasteredCount) {
      wx.showToast({ title: '没有待掌握的错题', icon: 'none' });
      return;
    }
    const url = this.data.subjectId
      ? `/modules/cpp/pages/setup/index?subjectId=${this.data.subjectId}&mode=wrong`
      : '/modules/cpp/pages/setup/index?scope=all&mode=wrong';
    wx.navigateTo({ url });
  }
});
