const createSubjectRepository = require('../../../../services/subjectRepository');
const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');
const { getGlobalPracticePresentation } = require('../../../../utils/globalPracticePresentation');

const MODE_NAMES = {
  chapter: '章节练习',
  random: '随机练习',
  wrong: '错题重做',
  favorite: '收藏重练'
};

Page({
  data: {
    subjectId: 'cpp',
    subjectName: 'C/C++',
    scope: 'subject',
    isGlobal: false,
    mode: 'random',
    modeName: '随机练习',
    setupTitle: '',
    setupTip: '',
    allCountLabel: '',
    chapterId: '',
    chapterName: '',
    counts: [5, 10, 20],
    selectedCount: 10,
    selectedCountLabel: '10 题',
    creating: false
  },

  onLoad(options) {
    const mode = MODE_NAMES[options.mode] ? options.mode : 'random';
    const globalPresentation = options.scope === 'all' ? getGlobalPracticePresentation(mode) : null;
    const isGlobal = Boolean(globalPresentation);
    const subject = registry.getSubject(options.subjectId) || registry.getSubject('cpp');
    this.repository = isGlobal ? repository : createSubjectRepository(subject.id);
    this.setData({
      subjectId: isGlobal ? '' : subject.id,
      subjectName: isGlobal ? '全部学科' : subject.name,
      scope: isGlobal ? 'all' : 'subject',
      isGlobal,
      mode,
      modeName: isGlobal ? globalPresentation.modeName : MODE_NAMES[mode],
      setupTitle: isGlobal ? globalPresentation.setupTitle : '',
      setupTip: isGlobal ? globalPresentation.setupTip : '',
      allCountLabel: isGlobal ? globalPresentation.allCountLabel : '',
      chapterId: options.chapterId || '',
      chapterName: options.chapterName ? decodeURIComponent(options.chapterName) : '',
      counts: isGlobal ? [5, 10, 20, 'all'] : [5, 10, 20],
      selectedCount: isGlobal ? 'all' : 10,
      selectedCountLabel: isGlobal ? globalPresentation.allCountLabel : '10 题'
    });
    wx.setNavigationBarTitle({ title: isGlobal ? globalPresentation.modeName : MODE_NAMES[mode] });
  },

  chooseCount(event) {
    if (this.data.creating) return;
    const value = event.currentTarget.dataset.count;
    const selectedCount = value === 'all' ? 'all' : Number(value);
    this.setData({
      selectedCount,
      selectedCountLabel: selectedCount === 'all' ? this.data.allCountLabel : `${selectedCount} 题`
    });
  },

  startPractice() {
    if (this.data.creating) return;
    this.setData({ creating: true });
    const payload = this.data.isGlobal
      ? { scope: 'all', mode: this.data.mode, count: this.data.selectedCount }
      : {
        mode: this.data.mode,
        chapterId: this.data.chapterId || undefined,
        count: this.data.selectedCount
      };
    this.repository.createSession(payload).then((session) => {
      wx.redirectTo({ url: `/modules/cpp/pages/practice/index?sessionId=${session.id}` });
    }).catch((error) => {
      this.setData({ creating: false });
      wx.showModal({ title: '无法开始练习', content: error.message || '请稍后重试', showCancel: false });
    });
  }
});
