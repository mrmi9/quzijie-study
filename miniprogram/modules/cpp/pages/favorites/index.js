const createSubjectRepository = require('../../../../services/subjectRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: { subjectId: 'cpp', subjectName: 'C/C++', loading: true, error: '', questions: [] },

  onLoad(options) {
    const subject = registry.getSubject(options.subjectId) || registry.getSubject('cpp');
    this.repository = createSubjectRepository(subject.id);
    this.setData({ subjectId: subject.id, subjectName: subject.name });
    wx.setNavigationBarTitle({ title: `${subject.name} 收藏` });
  },

  onShow() { this.loadQuestions(); },
  onPullDownRefresh() { this.loadQuestions().finally(() => wx.stopPullDownRefresh()); },

  loadQuestions() {
    this.setData({ loading: true, error: '' });
    return this.repository.getFavorites()
      .then((questions) => this.setData({ questions: questions.map((question) => this.decorateQuestion(question)), loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '收藏加载失败' }));
  },

  decorateQuestion(question) {
    const correctText = question.correctOptionIds.map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => `${option.label}. ${option.text}`).join('；');
    return Object.assign({}, question, { correctText });
  },

  removeFavorite(event) {
    const questionId = event.currentTarget.dataset.id;
    this.repository.setFavorite(questionId, false)
      .then(() => {
        this.setData({ questions: this.data.questions.filter((question) => question.id !== questionId) });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      })
      .catch((error) => wx.showToast({ title: error.message || '操作失败', icon: 'none' }));
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: [src] });
  },

  startReview() {
    if (!this.data.questions.length) return;
    wx.navigateTo({ url: `/modules/cpp/pages/setup/index?mode=favorite&subjectId=${this.data.subjectId}` });
  }
});
