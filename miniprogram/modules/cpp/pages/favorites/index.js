const repository = require('../../../../services/cppRepository');

Page({
  data: { loading: true, error: '', questions: [] },

  onShow() {
    this.loadQuestions();
  },

  onPullDownRefresh() {
    this.loadQuestions().finally(() => wx.stopPullDownRefresh());
  },

  loadQuestions() {
    this.setData({ loading: true, error: '' });
    return repository.getFavorites()
      .then((questions) => this.setData({
        questions: questions.map((question) => this.decorateQuestion(question)),
        loading: false
      }))
      .catch((error) => this.setData({ loading: false, error: error.message || '收藏加载失败' }));
  },

  decorateQuestion(question) {
    const correctText = question.correctOptionIds
      .map((id) => question.options.find((option) => option.id === id))
      .filter(Boolean)
      .map((option) => `${option.label}. ${option.text}`)
      .join('；');
    return Object.assign({}, question, { correctText, removing: false });
  },

  removeFavorite(event) {
    const questionId = event.currentTarget.dataset.id;
    repository.setFavorite(questionId, false)
      .then(() => {
        this.setData({ questions: this.data.questions.filter((question) => question.id !== questionId) });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      })
      .catch((error) => wx.showToast({ title: error.message || '操作失败', icon: 'none' }));
  },

  startReview() {
    if (!this.data.questions.length) return;
    wx.navigateTo({ url: '/modules/cpp/pages/setup/index?mode=favorite' });
  }
});
