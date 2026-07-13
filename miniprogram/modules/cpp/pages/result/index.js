const repository = require('../../../../services/cppRepository');

const MODE_NAMES = {
  chapter: '章节练习',
  random: '随机练习',
  wrong: '错题重做',
  favorite: '收藏重练'
};

Page({
  data: { loading: true, error: '', result: null, modeName: '' },

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.loadResult();
  },

  loadResult() {
    if (!this.sessionId) {
      this.setData({ loading: false, error: '缺少练习结果标识' });
      return;
    }
    this.setData({ loading: true, error: '' });
    repository.getResult(this.sessionId)
      .then((result) => this.setData({
        result,
        modeName: MODE_NAMES[result.mode] || '练习',
        loading: false
      }))
      .catch((error) => this.setData({ loading: false, error: error.message || '结果加载失败' }));
  },

  goHome() {
    wx.reLaunch({ url: '/modules/cpp/pages/home/index' });
  },

  openWrong() {
    wx.redirectTo({ url: '/modules/cpp/pages/wrong/index' });
  },

  practiceAgain() {
    const mode = this.data.result.mode;
    if (mode === 'chapter') {
      wx.redirectTo({ url: '/modules/cpp/pages/chapters/index' });
      return;
    }
    wx.redirectTo({ url: `/modules/cpp/pages/setup/index?mode=${mode}` });
  }
});
