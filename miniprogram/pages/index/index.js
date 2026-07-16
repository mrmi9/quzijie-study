const auth = require('../../utils/auth');
const repository = require('../../services/practiceRepository');

Page({
  data: { loading: true, error: '', overview: null, modules: [] },

  onShow() {
    if (!auth.requireLogin('/pages/index/index')) return;
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  loadOverview() {
    this.setData({ loading: true, error: '' });
    return repository.getLearningOverview()
      .then((overview) => this.setData({ overview, modules: overview.modules, loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '学习数据加载失败' }));
  },

  openModule(event) {
    const moduleId = event.currentTarget.dataset.id;
    const item = this.data.modules.find((module) => module.id === moduleId);
    if (!item) return;
    if (item.type === 'exam') {
      wx.navigateTo({ url: '/modules/cpp/pages/exam-home/index' });
    } else if (item.type === 'group') {
      wx.navigateTo({ url: `/modules/cpp/pages/tracks/index?groupId=${item.id}` });
    } else {
      wx.navigateTo({ url: `/modules/cpp/pages/home/index?subjectId=${item.subjectIds[0]}` });
    }
  },

  continueSession() {
    const active = this.data.overview && this.data.overview.activeSession;
    if (active) wx.navigateTo({ url: `/modules/cpp/pages/practice/index?sessionId=${active.id}` });
  },

  continueExam() {
    const active = this.data.overview && this.data.overview.activeExam;
    if (active) wx.navigateTo({ url: `/modules/cpp/pages/exam/index?examId=${active.id}` });
  }
});
