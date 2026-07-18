const auth = require('../../../../utils/auth');
const repository = require('../../../../services/practiceRepository');
const registry = require('../../../../config/subjectRegistry');
const { buildPracticeOptionFeedback } = require('../../../../utils/practiceOptionFeedback');
const { buildPracticeNavigationState } = require('../../../../utils/practiceNavigation');
const { getGlobalPracticePresentation } = require('../../../../utils/globalPracticePresentation');

const TYPE_NAMES = { single: '单选题', multiple: '多选题', judge: '判断题', fill_blank: '填空题', short_answer: '简答题' };
const DIFFICULTY_NAMES = { 1: '基础', 2: '进阶', 3: '难题' };

Page({
  data: {
    loading: true,
    error: '',
    session: null,
    currentIndex: 0,
    question: null,
    selectedOptionIds: [],
    textAnswers: [],
    shortAnswer: '',
    canSubmit: false,
    awaitingSelfAssessment: false,
    reviewed: false,
    result: null,
    submitting: false,
    favoriteLoading: false,
    isGlobal: false,
    isFirst: true,
    isLast: false,
    progressPercent: 0,
    correctAnswerText: '',
    missedAnswerText: ''
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
    return repository.getSession(this.sessionId)
      .then((session) => {
        if (session.status === 'completed') {
          wx.redirectTo({ url: `/modules/cpp/pages/result/index?sessionId=${session.id}` });
          return;
        }
        if (session.status !== 'active') {
          this.setData({ loading: false, error: '这组练习已被新的练习替代，请返回首页重新开始。' });
          return;
        }
        const isGlobal = session.scope === 'all';
        const subject = registry.getSubject(session.subjectId || session.subject);
        const globalPresentation = isGlobal ? getGlobalPracticePresentation(session.mode) : null;
        if (isGlobal) wx.setNavigationBarTitle({ title: globalPresentation ? globalPresentation.modeName : '全学科练习' });
        else if (subject) wx.setNavigationBarTitle({ title: `${subject.name} 答题` });
        const currentIndex = Math.min(session.currentIndex === undefined ? session.answeredCount : session.currentIndex, session.totalCount - 1);
        this.setData({ session, currentIndex, isGlobal, loading: false });
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
    return `practice_draft_${this.sessionId}_${questionId}`;
  },

  showCurrentQuestion() {
    const session = this.data.session;
    const question = session.questions[this.data.currentIndex];
    const savedResult = session.answers[question.id] || null;
    const localDraft = wx.getStorageSync(this.draftKey(question.id));
    const selected = savedResult ? savedResult.selectedOptionIds : (Array.isArray(localDraft) && question.type !== 'fill_blank' ? localDraft : []);
    const textAnswers = savedResult
      ? (savedResult.textAnswers || [])
      : (question.type === 'fill_blank' ? (Array.isArray(localDraft) ? localDraft : Array(question.blankCount || 1).fill('')) : [typeof localDraft === 'string' ? localDraft : '']);
    this.clientAnswerId = '';
    this.renderQuestion(question, selected, textAnswers, savedResult);
  },

  renderQuestion(question, selectedIds, textAnswers, result) {
    const answered = Boolean(result);
    const awaitingSelfAssessment = Boolean(result && result.evaluationRequired);
    const reviewed = answered && !awaitingSelfAssessment;
    const rawOptions = (question.options || []).map((option) => ({ id: option.id, label: option.label, text: option.text }));
    const optionFeedback = buildPracticeOptionFeedback({
      options: rawOptions,
      questionType: question.type,
      selectedOptionIds: selectedIds,
      correctOptionIds: answered ? result.correctOptionIds : [],
      reviewed: answered
    });
    const questionSubject = registry.getSubject(question.subjectId);
    const decoratedQuestion = Object.assign({}, question, {
      subjectName: questionSubject ? questionSubject.shortName : question.subjectId,
      typeName: TYPE_NAMES[question.type],
      isChoice: ['single', 'multiple', 'judge'].includes(question.type),
      isFill: question.type === 'fill_blank',
      isShort: question.type === 'short_answer',
      difficultyName: DIFFICULTY_NAMES[question.difficulty] || question.difficulty,
      options: optionFeedback.options,
      blankInputs: Array.from({ length: question.blankCount || 1 }, (_item, index) => ({ index, value: textAnswers[index] || '' }))
    });
    let correctAnswerText = '';
    if (answered && ['single', 'multiple', 'judge'].includes(question.type)) {
      correctAnswerText = result.correctOptionIds.map((id) => rawOptions.find((option) => option.id === id)).filter(Boolean).map((option) => option.label).join('、');
    } else if (answered && question.type === 'fill_blank') {
      correctAnswerText = (result.acceptedAnswers || []).map((answers) => answers[0]).join('；');
    } else if (answered && question.type === 'short_answer') {
      correctAnswerText = result.referenceAnswer || '';
    }
    const navigation = buildPracticeNavigationState({
      currentIndex: this.data.currentIndex,
      totalCount: this.data.session.totalCount
    });
    const completedOffset = this.data.currentIndex + (reviewed ? 1 : 0);
    const shortAnswer = textAnswers[0] || '';
    const canSubmit = question.type === 'fill_blank'
      ? textAnswers.length === (question.blankCount || 1) && textAnswers.every((value) => String(value).trim())
      : question.type === 'short_answer'
        ? Boolean(shortAnswer.trim())
        : selectedIds.length > 0;
    this.setData({
      question: decoratedQuestion,
      selectedOptionIds: selectedIds,
      textAnswers,
      shortAnswer,
      canSubmit,
      reviewed,
      awaitingSelfAssessment,
      result,
      submitting: false,
      isFirst: navigation.isFirst,
      isLast: navigation.isLast,
      progressPercent: Math.round((completedOffset / this.data.session.totalCount) * 100),
      correctAnswerText,
      missedAnswerText: optionFeedback.missedAnswerText
    });
  },

  selectOption(event) {
    if (this.data.reviewed || this.data.submitting) return;
    const optionId = event.currentTarget.dataset.id;
    const question = this.data.question;
    let selected = this.data.selectedOptionIds.slice();
    if (question.type === 'multiple') {
      selected = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : selected.concat(optionId);
    } else {
      selected = [optionId];
    }
    wx.setStorageSync(this.draftKey(question.id), selected);
    this.renderQuestion(question, selected, this.data.textAnswers, null);
  },

  inputFillAnswer(event) {
    if (this.data.reviewed || this.data.submitting) return;
    const index = Number(event.currentTarget.dataset.index);
    const textAnswers = this.data.textAnswers.slice();
    textAnswers[index] = event.detail.value;
    wx.setStorageSync(this.draftKey(this.data.question.id), textAnswers);
    this.renderQuestion(this.data.question, [], textAnswers, null);
  },

  inputShortAnswer(event) {
    if (this.data.reviewed || this.data.submitting) return;
    const value = event.detail.value;
    wx.setStorageSync(this.draftKey(this.data.question.id), value);
    this.renderQuestion(this.data.question, [], [value], null);
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.src;
    const urls = (this.data.question.images || []).map((item) => item.src);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  submitAnswer() {
    if (!this.data.canSubmit || this.data.submitting || this.data.reviewed || this.data.awaitingSelfAssessment) return;
    const question = this.data.question;
    if (!this.clientAnswerId) this.clientAnswerId = `${this.sessionId}_${question.id}_${Date.now()}`;
    this.setData({ submitting: true });
    const payload = {
      questionId: question.id,
      clientAnswerId: this.clientAnswerId
    };
    if (question.type === 'fill_blank') payload.answer = { kind: 'fill', values: this.data.textAnswers };
    else if (question.type === 'short_answer') payload.answer = { kind: 'short', value: this.data.shortAnswer };
    else payload.selectedOptionIds = this.data.selectedOptionIds;
    repository.submitAnswer(this.sessionId, payload).then((result) => {
      wx.removeStorageSync(this.draftKey(question.id));
      const session = this.data.session;
      session.answers[question.id] = result;
      session.answeredCount = Object.keys(session.answers).length;
      this.setData({ session });
      this.renderQuestion(question, this.data.selectedOptionIds, result.textAnswers || this.data.textAnswers, result);
      this.showGamificationReward(result);
    }).catch((error) => {
      this.setData({ submitting: false });
      wx.showModal({ title: '提交失败', content: `${error.message || '请检查网络后重试'}\n你的选择已保留。`, showCancel: false });
    });
  },

  assessShortAnswer(event) {
    if (!this.data.awaitingSelfAssessment || this.data.submitting) return;
    const assessment = event.currentTarget.dataset.assessment;
    this.setData({ submitting: true });
    repository.assessShortAnswer(this.sessionId, this.data.question.id, assessment)
      .then((result) => {
        const session = this.data.session;
        session.answers[this.data.question.id] = result;
        this.setData({ session });
        this.renderQuestion(this.data.question, [], result.textAnswers || this.data.textAnswers, result);
      })
      .catch((error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: error.message || '自评提交失败', icon: 'none' });
      });
  },

  showGamificationReward(result) {
    const points = Number(result.pointsAwarded || 0);
    const keys = result.unlockedAchievementKeys || [];
    if (points > 0) wx.showToast({ title: `积分 +${points}`, icon: 'none', duration: 1400 });
    if (keys.length) {
      setTimeout(() => {
        const modal = this.selectComponent('#achievementUnlock');
        if (modal) modal.show(keys);
      }, points > 0 ? 900 : 0);
    }
  },

  toggleFavorite() {
    if (!this.data.reviewed || this.data.favoriteLoading) return;
    const questionId = this.data.question.id;
    const favorite = !this.data.question.isFavorite;
    const subjectId = this.data.question.subjectId;
    this.setData({ favoriteLoading: true });
    repository.setFavorite(subjectId, questionId, favorite)
      .then(() => {
        const session = this.data.session;
        const questionIndex = session.questions.findIndex((question) => question.id === questionId);
        if (questionIndex >= 0) session.questions[questionIndex].isFavorite = favorite;
        const stillViewingQuestion = Boolean(this.data.question && this.data.question.id === questionId);
        this.setData({ session, favoriteLoading: false });
        if (stillViewingQuestion && questionIndex >= 0) {
          this.renderQuestion(session.questions[questionIndex], this.data.selectedOptionIds, this.data.textAnswers, this.data.result);
        }
        wx.showToast({ title: favorite ? '已收藏' : '已取消收藏', icon: 'success' });
      })
      .catch((error) => {
        this.setData({ favoriteLoading: false });
        wx.showToast({ title: error.message || '操作失败', icon: 'none' });
      });
  },

  previousQuestion() {
    if (this.data.submitting) return;
    const navigation = buildPracticeNavigationState({
      currentIndex: this.data.currentIndex,
      totalCount: this.data.session.totalCount
    });
    if (navigation.isFirst) return;
    this.setData({ currentIndex: navigation.previousIndex });
    this.showCurrentQuestion();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  nextQuestion() {
    if (!this.data.reviewed || this.data.submitting) return;
    const navigation = buildPracticeNavigationState({
      currentIndex: this.data.currentIndex,
      totalCount: this.data.session.totalCount
    });
    if (navigation.isLast) {
      this.finishPractice();
      return;
    }
    this.setData({ currentIndex: navigation.nextIndex });
    this.showCurrentQuestion();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  finishPractice() {
    this.setData({ submitting: true });
    repository.finishSession(this.sessionId)
      .then(() => wx.redirectTo({ url: `/modules/cpp/pages/result/index?sessionId=${this.sessionId}` }))
      .catch((error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: error.message || '交卷失败', icon: 'none' });
      });
  }
});
