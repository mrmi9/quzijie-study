const auth = require('../../utils/auth');
const repository = require('../../services/practiceRepository');
const registry = require('../../config/subjectRegistry');

Page({
  data: {
    subjectFilters: [{ id: '', name: '全部' }].concat(registry.getSubjects()),
    subjectId: '',
    loading: true,
    error: '',
    questions: []
  },

  onShow() {
    if (!auth.requireLogin('/pages/favorites/index')) return;
    this.loadQuestions();
  },

  onPullDownRefresh() {
    this.loadQuestions().finally(() => wx.stopPullDownRefresh());
  },

  loadQuestions() {
    this.setData({ loading: true, error: '' });
    return repository.getFavorites(this.data.subjectId || undefined)
      .then((questions) => this.setData({ questions: questions.map((item) => this.decorate(item)), loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '收藏加载失败' }));
  },

  decorate(question) {
    const subject = registry.getSubject(question.subjectId);
    return Object.assign({}, question, {
      subjectName: subject ? subject.shortName : question.subjectId,
      answerText: question.correctOptionIds.map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => option.label).join('、')
    });
  },

  changeSubject(event) {
    this.setData({ subjectId: event.currentTarget.dataset.id || '' });
    this.loadQuestions();
  },

  removeFavorite(event) {
    const { subject, id } = event.currentTarget.dataset;
    repository.setFavorite(subject, id, false).then(() => this.loadQuestions());
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: [src] });
  },

  startReview() {
    if (this.data.loading || this.data.error || !this.data.questions.length) {
      wx.showToast({ title: '当前没有可重练的收藏题', icon: 'none' });
      return;
    }
    const url = this.data.subjectId
      ? `/modules/cpp/pages/setup/index?subjectId=${this.data.subjectId}&mode=favorite`
      : '/modules/cpp/pages/setup/index?scope=all&mode=favorite';
    wx.navigateTo({ url });
  }
});
