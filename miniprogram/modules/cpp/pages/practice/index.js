const auth = require('../../../../utils/auth');
const repository = require('../../../../services/cppRepository');

const TYPE_NAMES = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题'
};

Page({
  data: {
    loading: true,
    error: '',
    session: null,
    currentIndex: 0,
    question: null,
    selectedOptionIds: [],
    reviewed: false,
    result: null,
    submitting: false,
    favoriteLoading: false,
    isLast: false,
    progressPercent: 0,
    correctAnswerText: ''
  },

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    if (!this.sessionId) {
      this.setData({ loading: false, error: '缺少练习会话标识' });
      return;
    }
    this.loadSession();
  },

  loadSession() {
    this.setData({ loading: true, error: '' });
    repository.getSession(this.sessionId)
      .then((session) => {
        if (session.status === 'completed') {
          wx.redirectTo({ url: `/modules/cpp/pages/result/index?sessionId=${session.id}` });
          return;
        }
        if (session.status !== 'active') {
          this.setData({ loading: false, error: '这组练习已被新的练习替代，请返回首页重新开始。' });
          return;
        }
        const currentIndex = Math.min(session.answeredCount, session.totalCount - 1);
        this.setData({ session, currentIndex, loading: false });
        this.showCurrentQuestion();
      })
      .catch((error) => this.handleError(error));
  },

  handleError(error) {
    if (error.statusCode === 401) {
      auth.requireLogin(`/modules/cpp/pages/practice/index?sessionId=${this.sessionId}`);
      return;
    }
    this.setData({ loading: false, submitting: false, error: error.message || '练习加载失败' });
  },

  draftKey(questionId) {
    return `cpp_draft_${this.sessionId}_${questionId}`;
  },

  showCurrentQuestion() {
    const session = this.data.session;
    const question = session.questions[this.data.currentIndex];
    const savedResult = session.answers[question.id] || null;
    const selected = savedResult
      ? savedResult.selectedOptionIds
      : (wx.getStorageSync(this.draftKey(question.id)) || []);
    this.clientAnswerId = '';
    this.renderQuestion(question, selected, savedResult);
  },

  renderQuestion(question, selectedIds, result) {
    const reviewed = Boolean(result);
    const options = question.options.map((option) => {
      const selected = selectedIds.includes(option.id);
      const correct = reviewed && result.correctOptionIds.includes(option.id);
      let stateClass = selected ? 'option-selected' : '';
      if (reviewed && correct) stateClass = 'option-correct';
      if (reviewed && selected && !correct) stateClass = 'option-wrong';
      return Object.assign({}, option, { selected, correct, stateClass });
    });
    const decoratedQuestion = Object.assign({}, question, {
      typeName: TYPE_NAMES[question.type],
      options
    });
    const correctAnswerText = reviewed
      ? result.correctOptionIds
          .map((id) => question.options.find((option) => option.id === id))
          .filter(Boolean)
          .map((option) => option.label)
          .join('、')
      : '';
    const completedOffset = this.data.currentIndex + (reviewed ? 1 : 0);
    this.setData({
      question: decoratedQuestion,
      selectedOptionIds: selectedIds,
      reviewed,
      result,
      submitting: false,
      isLast: this.data.currentIndex === this.data.session.totalCount - 1,
      progressPercent: Math.round((completedOffset / this.data.session.totalCount) * 100),
      correctAnswerText
    });
  },

  selectOption(event) {
    if (this.data.reviewed || this.data.submitting) return;
    const optionId = event.currentTarget.dataset.id;
    const question = this.data.question;
    let selected = this.data.selectedOptionIds.slice();
    if (question.type === 'multiple') {
      selected = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : selected.concat(optionId);
    } else {
      selected = [optionId];
    }
    wx.setStorageSync(this.draftKey(question.id), selected);
    this.renderQuestion(question, selected, null);
  },

  submitAnswer() {
    if (!this.data.selectedOptionIds.length || this.data.submitting || this.data.reviewed) return;
    const question = this.data.question;
    if (!this.clientAnswerId) {
      this.clientAnswerId = `${this.sessionId}_${question.id}_${Date.now()}`;
    }
    this.setData({ submitting: true });
    repository.submitAnswer(this.sessionId, {
      questionId: question.id,
      selectedOptionIds: this.data.selectedOptionIds,
      clientAnswerId: this.clientAnswerId
    }).then((result) => {
      wx.removeStorageSync(this.draftKey(question.id));
      const session = this.data.session;
      session.answers[question.id] = result;
      session.answeredCount = Object.keys(session.answers).length;
      this.setData({ session });
      this.renderQuestion(question, this.data.selectedOptionIds, result);
    }).catch((error) => {
      this.setData({ submitting: false });
      wx.showModal({
        title: '提交失败',
        content: `${error.message || '请检查网络后重试'}\n你的选择已保留。`,
        showCancel: false
      });
    });
  },

  toggleFavorite() {
    if (!this.data.reviewed || this.data.favoriteLoading) return;
    const favorite = !this.data.question.isFavorite;
    this.setData({ favoriteLoading: true });
    repository.setFavorite(this.data.question.id, favorite)
      .then(() => {
        const session = this.data.session;
        session.questions[this.data.currentIndex].isFavorite = favorite;
        this.setData({ session, favoriteLoading: false });
        this.renderQuestion(session.questions[this.data.currentIndex], this.data.selectedOptionIds, this.data.result);
        wx.showToast({ title: favorite ? '已收藏' : '已取消收藏', icon: 'success' });
      })
      .catch((error) => {
        this.setData({ favoriteLoading: false });
        wx.showToast({ title: error.message || '操作失败', icon: 'none' });
      });
  },

  nextQuestion() {
    if (!this.data.reviewed || this.data.submitting) return;
    if (this.data.isLast) {
      this.finishPractice();
      return;
    }
    this.setData({ currentIndex: this.data.currentIndex + 1 });
    this.showCurrentQuestion();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  finishPractice() {
    this.setData({ submitting: true });
    repository.finishSession(this.sessionId)
      .then(() => {
        wx.redirectTo({ url: `/modules/cpp/pages/result/index?sessionId=${this.sessionId}` });
      })
      .catch((error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: error.message || '交卷失败', icon: 'none' });
      });
  }
});
