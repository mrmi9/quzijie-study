const repository = require('../../../../services/practiceRepository');

Page({
  data: { loading: true, error: '', exams: [] },

  onShow() { this.loadExams(); },
  onPullDownRefresh() { this.loadExams().finally(() => wx.stopPullDownRefresh()); },

  loadExams() {
    this.setData({ loading: true, error: '' });
    return repository.listExams().then((exams) => this.setData({ exams: exams.map((item) => this.decorate(item)), loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '历史成绩加载失败' }));
  },

  decorate(exam) {
    const date = new Date(exam.createdAt);
    const pad = (value) => String(value).padStart(2, '0');
    return Object.assign({}, exam, {
      dateText: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
      statusText: exam.status === 'completed' ? '已交卷' : '进行中'
    });
  },

  openExam(event) {
    const exam = this.data.exams.find((item) => item.id === event.currentTarget.dataset.id);
    if (!exam) return;
    const page = exam.status === 'completed' ? 'exam-result' : 'exam';
    wx.navigateTo({ url: `/modules/cpp/pages/${page}/index?examId=${exam.id}` });
  }
});
