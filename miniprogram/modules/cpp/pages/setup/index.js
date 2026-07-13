const repository = require('../../../../services/cppRepository');

const MODE_NAMES = {
  chapter: '章节练习',
  random: '随机练习',
  wrong: '错题重做',
  favorite: '收藏重练'
};

Page({
  data: {
    mode: 'random',
    modeName: '随机练习',
    chapterId: '',
    chapterName: '',
    counts: [5, 10, 20],
    selectedCount: 10,
    creating: false
  },

  onLoad(options) {
    const mode = MODE_NAMES[options.mode] ? options.mode : 'random';
    this.setData({
      mode,
      modeName: MODE_NAMES[mode],
      chapterId: options.chapterId || '',
      chapterName: options.chapterName ? decodeURIComponent(options.chapterName) : ''
    });
  },

  chooseCount(event) {
    if (this.data.creating) return;
    this.setData({ selectedCount: Number(event.currentTarget.dataset.count) });
  },

  startPractice() {
    if (this.data.creating) return;
    this.setData({ creating: true });
    repository.createSession({
      subject: 'cpp',
      mode: this.data.mode,
      chapterId: this.data.chapterId || undefined,
      count: this.data.selectedCount
    }).then((session) => {
      wx.redirectTo({ url: `/modules/cpp/pages/practice/index?sessionId=${session.id}` });
    }).catch((error) => {
      this.setData({ creating: false });
      wx.showModal({
        title: '无法开始练习',
        content: error.message || '请稍后重试',
        showCancel: false
      });
    });
  }
});
