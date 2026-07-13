const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: {
    loading: true,
    error: '',
    exam: null,
    answers: {},
    question: null,
    currentIndex: 0,
    remainingText: '60:00',
    timerWarning: false,
    answeredCount: 0,
    showCard: false,
    saving: false,
    submitting: false
  },

  onLoad(options) {
    this.examId = options.examId || '';
    if (!this.examId) {
      this.setData({ loading: false, error: '缺少模拟考试标识' });
      return;
    }
    this.loadExam();
  },

  onShow() {
    if (this.data.exam && this.data.exam.status === 'active') this.startTimer();
  },

  onHide() {
    this.stopTimer();
    this.saveDraft({ silent: true });
  },

  onUnload() {
    this.stopTimer();
  },

  localDraftKey() { return `exam_draft_${this.examId}`; },

  loadExam() {
    this.setData({ loading: true, error: '' });
    return repository.getExam(this.examId).then((exam) => {
      if (exam.status === 'completed') {
        wx.redirectTo({ url: `/modules/cpp/pages/exam-result/index?examId=${exam.id}` });
        return;
      }
      const local = wx.getStorageSync(this.localDraftKey()) || {};
      const allowed = new Set(exam.questions.map((question) => question.id));
      const answers = Object.assign({}, exam.answers);
      Object.keys(local).forEach((questionId) => {
        if (allowed.has(questionId) && Array.isArray(local[questionId])) answers[questionId] = local[questionId];
      });
      this.setData({ exam, answers, loading: false, answeredCount: Object.keys(answers).length });
      this.showQuestion(0);
      this.startTimer();
      if (Object.keys(local).length) this.saveDraft({ silent: true });
    }).catch((error) => this.setData({ loading: false, error: error.message || '试卷加载失败' }));
  },

  startTimer() {
    this.stopTimer();
    this.updateTimer();
    this.timer = setInterval(() => this.updateTimer(), 1000);
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  updateTimer() {
    const exam = this.data.exam;
    if (!exam || this.data.submitting) return;
    const seconds = Math.max(0, Math.ceil((Number(exam.expiresAt) - Date.now()) / 1000));
    const minutesText = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secondsText = String(seconds % 60).padStart(2, '0');
    this.setData({ remainingText: `${minutesText}:${secondsText}`, timerWarning: seconds <= 300 });
    if (seconds <= 0) {
      this.stopTimer();
      this.submitExam(true);
    }
  },

  showQuestion(index) {
    const exam = this.data.exam;
    if (!exam || index < 0 || index >= exam.totalCount) return;
    const source = exam.questions[index];
    const selected = this.data.answers[source.id] || [];
    const subject = registry.getSubject(source.subjectId) || { shortName: source.subjectId };
    const question = Object.assign({}, source, {
      subjectName: subject.shortName,
      options: source.options.map((option) => Object.assign({}, option, { selected: selected.includes(option.id) }))
    });
    this.setData({ currentIndex: index, question, showCard: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  selectOption(event) {
    if (this.data.submitting) return;
    const question = this.data.question;
    const answers = Object.assign({}, this.data.answers, { [question.id]: [event.currentTarget.dataset.id] });
    this.setData({ answers, answeredCount: Object.keys(answers).length });
    wx.setStorageSync(this.localDraftKey(), answers);
    this.showQuestion(this.data.currentIndex);
    this.saveDraft({ silent: true });
  },

  saveDraft(options = {}) {
    if (!this.data.exam || this.data.exam.status !== 'active' || this.data.submitting) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(this.data.answers));
    this.draftRevision = (this.draftRevision || 0) + 1;
    const revision = this.draftRevision;
    this.setData({ saving: true });
    const queued = (this.saveQueue || Promise.resolve()).catch(() => null)
      .then(() => repository.saveExamDraft(this.examId, snapshot));
    this.saveQueue = queued.then((response) => {
      if (revision === this.draftRevision) this.setData({ saving: false });
      if (response && response.score !== undefined && response.examId) {
        wx.removeStorageSync(this.localDraftKey());
        wx.redirectTo({ url: `/modules/cpp/pages/exam-result/index?examId=${this.examId}` });
        return response;
      }
      if (response && response.expiresAt) this.setData({ exam: Object.assign({}, this.data.exam, { expiresAt: response.expiresAt }) });
      return response;
    }).catch((error) => {
      if (revision === this.draftRevision) this.setData({ saving: false });
      if (!options.silent) wx.showToast({ title: error.message || '草稿保存失败', icon: 'none' });
      return null;
    });
    return this.saveQueue;
  },

  previousQuestion() { this.showQuestion(this.data.currentIndex - 1); },
  nextQuestion() { this.showQuestion(this.data.currentIndex + 1); },
  toggleCard() { this.setData({ showCard: !this.data.showCard }); },
  goQuestion(event) { this.showQuestion(Number(event.currentTarget.dataset.index)); },

  requestSubmit() {
    const unanswered = this.data.exam.totalCount - this.data.answeredCount;
    wx.showModal({
      title: '确认交卷？',
      content: unanswered ? `还有 ${unanswered} 题未作答，未答题将计为错误。` : '所有题目均已作答，交卷后不能修改答案。',
      confirmText: '确认交卷',
      success: (result) => { if (result.confirm) this.submitExam(false); }
    });
  },

  submitExam(automatic) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    this.stopTimer();
    (this.saveQueue || Promise.resolve()).catch(() => null)
      .then(() => repository.saveExamDraft(this.examId, this.data.answers))
      .catch(() => null)
      .then(() => repository.submitExam(this.examId))
      .then(() => {
        wx.removeStorageSync(this.localDraftKey());
        if (automatic) wx.showToast({ title: '时间到，已自动交卷', icon: 'none' });
        wx.redirectTo({ url: `/modules/cpp/pages/exam-result/index?examId=${this.examId}` });
      })
      .catch((error) => {
        this.setData({ submitting: false });
        this.startTimer();
        wx.showModal({ title: '交卷失败', content: `${error.message || '请检查网络后重试'}\n草稿仍已保留。`, showCancel: false });
      });
  },

  previewImage(event) {
    const urls = (this.data.question.images || []).map((item) => item.src);
    if (urls.length) wx.previewImage({ current: event.currentTarget.dataset.src, urls });
  }
});
