const registry = require('../../../../config/subjectRegistry');
const repository = require('../../../../services/practiceRepository');

Page({
  data: { module: null, tracks: [], loading: true, error: '' },

  onLoad(options) {
    this.groupId = options.groupId;
    const module = registry.getModule(options.groupId);
    if (!module || module.type !== 'group') {
      repository.getCatalog().then((catalog) => {
        registry.applyCatalog(catalog);
        const loaded = registry.getModule(this.groupId);
        if (!loaded || loaded.type !== 'group') throw new Error('组合模块不存在');
        this.setData({ module: loaded });
        wx.setNavigationBarTitle({ title: loaded.name });
        return this.loadTracks();
      }).catch((error) => this.setData({ loading: false, error: error.message || '组合模块不存在' }));
      return;
    }
    this.setData({ module });
    wx.setNavigationBarTitle({ title: module.name });
    this.loadTracks();
  },

  onPullDownRefresh() {
    this.loadTracks().finally(() => wx.stopPullDownRefresh());
  },

  loadTracks() {
    const module = this.data.module;
    if (!module) return Promise.resolve();
    this.setData({ loading: true, error: '' });
    return Promise.all(module.subjectIds.map((subjectId) => repository.getSubjectOverview(subjectId)))
      .then((overviews) => {
        const tracks = module.subjectIds.map((subjectId, index) => Object.assign({}, registry.getSubject(subjectId), overviews[index]));
        this.setData({ tracks, loading: false });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || '方向加载失败' }));
  },

  openTrack(event) {
    const subjectId = event.currentTarget.dataset.id;
    if (!registry.getSubject(subjectId)) return;
    wx.navigateTo({ url: `/modules/cpp/pages/home/index?subjectId=${subjectId}` });
  }
});
