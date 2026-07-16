const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');
const { decorateGlobalPracticeResult, decorateSubjectPracticeResult } = require('../../../../utils/globalPracticePresentation');

const MODE_NAMES = {
  chapter: '章节练习',
  random: '随机练习',
  wrong: '错题重做',
  favorite: '收藏重练'
};

Page({
  data: { loading: true, error: '', result: null, modeName: '', subjectName: '', homeButtonText: '', isGlobal: false },

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
        const isGlobal = result.scope === 'all';
        if (isGlobal) {
          const decoratedResult = decorateGlobalPracticeResult(result, registry.getSubjects());
          this.setData({ result: decoratedResult, subjectName: '全部学科', homeButtonText: '返回学习首页', modeName: '全学科收藏重练', isGlobal, loading: false });
          wx.setNavigationBarTitle({ title: '全学科收藏结果' });
          return;
        }
        const subject = registry.getSubject(result.subjectId) || { name: result.subjectId };
        const decoratedResult = decorateSubjectPracticeResult(result, subject.name);
        this.setData({ result: decoratedResult, subjectName: subject.name, homeButtonText: `返回 ${subject.name} 首页`, modeName: MODE_NAMES[result.mode] || '练习', isGlobal, loading: false });
        wx.setNavigationBarTitle({ title: `${subject.name} 练习结果` });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || '结果加载失败' }));
  },

  goHome() {
    if (this.data.isGlobal) {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    wx.reLaunch({ url: `/modules/cpp/pages/home/index?subjectId=${this.data.result.subjectId}` });
  },

  openWrong() {
    if (this.data.isGlobal) {
      wx.switchTab({ url: '/pages/wrong/index' });
      return;
    }
    wx.redirectTo({ url: `/modules/cpp/pages/wrong/index?subjectId=${this.data.result.subjectId}` });
  },

  practiceAgain() {
    const result = this.data.result;
    if (this.data.isGlobal) {
      wx.redirectTo({ url: '/modules/cpp/pages/setup/index?scope=all&mode=favorite' });
      return;
    }
    if (result.mode === 'chapter') {
      wx.redirectTo({ url: `/modules/cpp/pages/chapters/index?subjectId=${result.subjectId}` });
      return;
    }
    wx.redirectTo({ url: `/modules/cpp/pages/setup/index?mode=${result.mode}&subjectId=${result.subjectId}` });
  }
});
