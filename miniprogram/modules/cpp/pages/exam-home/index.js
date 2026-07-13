const repository = require('../../../../services/practiceRepository');

Page({
  data: { loading: true, creating: false, error: '', activeExam: null, recentExams: [] },

  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },

  loadData() {
    this.setData({ loading: true, error: '' });
    return Promise.all([repository.getLearningOverview(), repository.listExams()])
      .then(([overview, exams]) => this.setData({
        activeExam: overview.activeExam,
        recentExams: exams.filter((item) => item.status === 'completed').slice(0, 3).map((item) => this.decorateExam(item)),
        loading: false
      }))
      .catch((error) => this.setData({ loading: false, error: error.message || '考试信息加载失败' }));
  },

  decorateExam(exam) {
    return Object.assign({}, exam, { dateText: this.formatDate(exam.createdAt) });
  },

  formatDate(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  startExam() {
    if (this.data.creating) return;
    if (this.data.activeExam) {
      this.continueExam();
      return;
    }
    wx.showModal({
      title: '开始 408 客观题模拟？',
      content: '共 40 道单选题，限时 60 分钟。开始后切后台仍会继续计时。',
      confirmText: '开始模拟',
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ creating: true });
        repository.createExam().then((exam) => {
          wx.navigateTo({ url: `/modules/cpp/pages/exam/index?examId=${exam.id}` });
        }).catch((error) => {
          this.setData({ creating: false });
          if (error.code === 'ACTIVE_EXAM_EXISTS') {
            this.loadData().then(() => this.continueExam());
            return;
          }
          wx.showModal({ title: '无法开始模拟', content: error.message || '请稍后重试', showCancel: false });
        });
      }
    });
  },

  continueExam() {
    if (!this.data.activeExam) return;
    wx.navigateTo({ url: `/modules/cpp/pages/exam/index?examId=${this.data.activeExam.id}` });
  },

  openHistory() {
    wx.navigateTo({ url: '/modules/cpp/pages/exam-history/index' });
  },

  openCoPractice() {
    wx.navigateTo({ url: '/modules/cpp/pages/home/index?subjectId=co' });
  },

  openResult(event) {
    wx.navigateTo({ url: `/modules/cpp/pages/exam-result/index?examId=${event.currentTarget.dataset.id}` });
  }
});
