const auth = require('../../../../utils/auth');
const createSubjectRepository = require('../../../../services/subjectRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: {
    subjectId: 'cpp',
    subject: registry.getSubject('cpp'),
    loading: true,
    error: '',
    overview: null
  },

  onLoad(options) {
    const subject = registry.getSubject(options.subjectId) || registry.getSubject('cpp');
    this.repository = createSubjectRepository(subject.id);
    this.setData({ subjectId: subject.id, subject });
    wx.setNavigationBarTitle({ title: `${subject.name} 刷题` });
  },

  onShow() {
    const returnUrl = `/modules/cpp/pages/home/index?subjectId=${this.data.subjectId}`;
    if (!auth.requireLogin(returnUrl)) return;
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  loadOverview() {
    this.setData({ loading: true, error: '' });
    return this.repository.getOverview()
      .then((overview) => this.setData({ overview, loading: false }))
      .catch((error) => this.handleError(error));
  },

  handleError(error) {
    if (error.statusCode === 401) return;
    this.setData({ loading: false, error: error.message || '加载失败，请重试' });
  },

  openChapters() {
    wx.navigateTo({ url: `/modules/cpp/pages/chapters/index?subjectId=${this.data.subjectId}` });
  },

  openRandom() {
    wx.navigateTo({ url: `/modules/cpp/pages/setup/index?mode=random&subjectId=${this.data.subjectId}` });
  },

  openWrong() {
    wx.navigateTo({ url: `/modules/cpp/pages/wrong/index?subjectId=${this.data.subjectId}` });
  },

  openFavorites() {
    wx.navigateTo({ url: `/modules/cpp/pages/favorites/index?subjectId=${this.data.subjectId}` });
  },

  continueSession() {
    const active = this.data.overview && this.data.overview.activeSession;
    if (!active) return;
    wx.navigateTo({ url: `/modules/cpp/pages/practice/index?sessionId=${active.id}` });
  }
});
