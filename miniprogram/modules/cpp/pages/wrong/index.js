const createSubjectRepository = require('../../../../services/subjectRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: {
    subjectId: 'cpp', subjectName: 'C/C++',
    filters: [{ key: 'all', label: '全部' }, { key: 'unmastered', label: '未掌握' }, { key: 'mastered', label: '已掌握' }],
    activeFilter: 'all', loading: true, error: '', questions: [], unmasteredCount: 0
  },

  onLoad(options) {
    const subject = registry.getSubject(options.subjectId) || registry.getSubject('cpp');
    this.repository = createSubjectRepository(subject.id);
    this.setData({ subjectId: subject.id, subjectName: subject.name });
    wx.setNavigationBarTitle({ title: `${subject.name} 错题` });
  },

  onShow() { this.loadQuestions(); },
  onPullDownRefresh() { this.loadQuestions().finally(() => wx.stopPullDownRefresh()); },

  filterValue() {
    if (this.data.activeFilter === 'mastered') return true;
    if (this.data.activeFilter === 'unmastered') return false;
    return undefined;
  },

  loadQuestions() {
    this.setData({ loading: true, error: '' });
    return Promise.all([
      this.repository.getWrongQuestions(this.filterValue()),
      this.repository.getWrongQuestions(false)
    ]).then(([questions, unmastered]) => this.setData({
      questions: questions.map((question) => this.decorateQuestion(question)),
      unmasteredCount: unmastered.length,
      loading: false
    })).catch((error) => this.setData({ loading: false, error: error.message || '错题加载失败' }));
  },

  decorateQuestion(question) {
    const correctText = question.correctOptionIds.map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => `${option.label}. ${option.text}`).join('；');
    return Object.assign({}, question, { correctText, masteredText: question.wrong && question.wrong.mastered ? '已掌握' : '未掌握' });
  },

  changeFilter(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key });
    this.loadQuestions();
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: [src] });
  },

  startReview() {
    if (!this.data.unmasteredCount) {
      wx.showToast({ title: '没有待掌握的错题', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/modules/cpp/pages/setup/index?mode=wrong&subjectId=${this.data.subjectId}` });
  }
});
