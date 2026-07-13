const auth = require('../../../../utils/auth');
const repository = require('../../../../services/cppRepository');

Page({
  data: {
    loading: true,
    error: '',
    overview: null
  },

  onShow() {
    if (!auth.requireLogin('/modules/cpp/pages/home/index')) return;
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  loadOverview() {
    this.setData({ loading: true, error: '' });
    return repository.getOverview()
      .then((overview) => this.setData({ overview, loading: false }))
      .catch((error) => this.handleError(error));
  },

  handleError(error) {
    if (error.statusCode === 401) {
      auth.requireLogin('/modules/cpp/pages/home/index');
      return;
    }
    this.setData({ loading: false, error: error.message || '加载失败，请重试' });
  },

  openChapters() {
    wx.navigateTo({ url: '/modules/cpp/pages/chapters/index' });
  },

  openRandom() {
    wx.navigateTo({ url: '/modules/cpp/pages/setup/index?mode=random' });
  },

  openWrong() {
    wx.navigateTo({ url: '/modules/cpp/pages/wrong/index' });
  },

  openFavorites() {
    wx.navigateTo({ url: '/modules/cpp/pages/favorites/index' });
  },

  continueSession() {
    const active = this.data.overview && this.data.overview.activeSession;
    if (!active) return;
    wx.navigateTo({ url: `/modules/cpp/pages/practice/index?sessionId=${active.id}` });
  }
});
