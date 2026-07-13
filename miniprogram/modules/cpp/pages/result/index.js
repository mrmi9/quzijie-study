const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');

const MODE_NAMES = {
  chapter: '章节练习',
  random: '随机练习',
  wrong: '错题重做',
  favorite: '收藏重练'
};

Page({
  data: { loading: true, error: '', result: null, modeName: '', subjectName: '' },

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.loadResult();
  },

  loadResult() {
    if (!this.sessionId) {
      this.setData({ loading: false, error: '缺少练习结果标识' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    return repository.getResult(this.sessionId)
      .then((result) => {
        const subject = registry.getSubject(result.subjectId) || { name: result.subjectId };
        this.setData({ result, subjectName: subject.name, modeName: MODE_NAMES[result.mode] || '练习', loading: false });
        wx.setNavigationBarTitle({ title: `${subject.name} 练习结果` });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || '结果加载失败' }));
  },

  goHome() {
    wx.reLaunch({ url: `/modules/cpp/pages/home/index?subjectId=${this.data.result.subjectId}` });
  },

  openWrong() {
    wx.redirectTo({ url: `/modules/cpp/pages/wrong/index?subjectId=${this.data.result.subjectId}` });
  },

  practiceAgain() {
    const result = this.data.result;
    if (result.mode === 'chapter') {
      wx.redirectTo({ url: `/modules/cpp/pages/chapters/index?subjectId=${result.subjectId}` });
      return;
    }
    wx.redirectTo({ url: `/modules/cpp/pages/setup/index?mode=${result.mode}&subjectId=${result.subjectId}` });
  }
});
