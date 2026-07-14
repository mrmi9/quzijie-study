const STATE_VERSION = 2;
const EXAM_TYPE = 'postgraduate-408-objective';
const EXAM_DURATION_MS = 60 * 60 * 1000;
const EXAM_DISTRIBUTION = { ds: 12, co: 12, os: 9, network: 7 };

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createDomainError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameAnswer(left, right) {
  const a = (left || []).slice().sort();
  const b = (right || []).slice().sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function emptySubjectState() {
  return {
    attemptedQuestions: {},
    wrongQuestions: {},
    favorites: {},
    totals: { attempts: 0, correct: 0 }
  };
}

function initialState() {
  return {
    version: STATE_VERSION,
    sessions: {},
    activeSessionId: '',
    submissions: {},
    subjects: {},
    dailyAttempts: {},
    exams: {},
    activeExamId: ''
  };
}

class PracticeCore {
  constructor(options) {
    this.questions = options.questions || [];
    this.storage = options.storage;
    this.registry = options.registry;
    this.random = options.random || Math.random;
    this.now = options.now || (() => Date.now());
    this.stateKey = options.stateKey || 'practice_mock_state_v2';
    this.legacyStateKey = options.legacyStateKey || 'cpp_mock_state_v1';
    this.questionMap = this.questions.reduce((map, question) => {
      map[question.id] = question;
      return map;
    }, {});
  }

  loadState() {
    const current = this.storage.get(this.stateKey);
    if (current && current.version === STATE_VERSION) return current;
    const migrated = this.migrateLegacyState(this.storage.get(this.legacyStateKey));
    this.saveState(migrated);
    return migrated;
  }

  migrateLegacyState(legacy) {
    const state = initialState();
    if (!legacy || legacy.version !== 1) return state;
    state.sessions = clone(legacy.sessions || {});
    Object.values(state.sessions).forEach((session) => { session.subject = session.subject || 'cpp'; });
    state.activeSessionId = legacy.activeSessionId || '';
    state.submissions = clone(legacy.submissions || {});
    state.subjects.cpp = {
      attemptedQuestions: clone(legacy.attemptedQuestions || {}),
      wrongQuestions: clone(legacy.wrongQuestions || {}),
      favorites: clone(legacy.favorites || {}),
      totals: clone(legacy.totals || { attempts: 0, correct: 0 })
    };
    return state;
  }

  saveState(state) {
    this.storage.set(this.stateKey, state);
  }

  subjectState(state, subjectId) {
    if (!state.subjects[subjectId]) state.subjects[subjectId] = emptySubjectState();
    return state.subjects[subjectId];
  }

  dateKey(timestamp) {
    return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  activeQuestions(subjectId) {
    return this.questions.filter((question) => question.status === 'active' && (!subjectId || question.subjectId === subjectId));
  }

  publicQuestion(question, state) {
    const subject = this.subjectState(state, question.subjectId);
    return {
      id: question.id,
      subjectId: question.subjectId,
      chapterId: question.chapterId,
      chapterName: question.chapterName,
      type: question.type,
      stem: question.stem,
      code: question.code || '',
      images: clone(question.images || []),
      options: clone(question.options),
      difficulty: question.difficulty,
      tags: clone(question.tags),
      version: question.version,
      isFavorite: Boolean(subject.favorites[question.id])
    };
  }

  reviewQuestion(question, state) {
    const subject = this.subjectState(state, question.subjectId);
    const wrong = subject.wrongQuestions[question.id] || null;
    return Object.assign(this.publicQuestion(question, state), {
      correctOptionIds: clone(question.correctOptionIds),
      explanation: question.explanation,
      wrong: wrong ? clone(wrong) : null
    });
  }

  shuffle(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  getLearningOverview() {
    const state = this.loadState();
    const totals = Object.values(state.subjects).reduce((result, subject) => {
      result.attempts += subject.totals.attempts;
      result.correct += subject.totals.correct;
      result.attempted += Object.keys(subject.attemptedQuestions).length;
      result.wrong += Object.values(subject.wrongQuestions).filter((item) => !item.mastered).length;
      result.favorites += Object.keys(subject.favorites).length;
      return result;
    }, { attempts: 0, correct: 0, attempted: 0, wrong: 0, favorites: 0 });
    const totalQuestions = this.activeQuestions().length;
    const todayAttempts = state.dailyAttempts[this.dateKey(this.now())] || 0;
    const modules = this.registry.MODULES.map((module) => {
      const questions = this.questions.filter((question) => module.subjectIds.includes(question.subjectId) && question.status === 'active');
      const attempted = module.subjectIds.reduce((count, subjectId) => {
        const subject = this.subjectState(state, subjectId);
        return count + Object.keys(subject.attemptedQuestions).length;
      }, 0);
      return Object.assign({}, module, {
        totalQuestions: questions.length,
        attemptedCount: attempted,
        progressPercent: questions.length ? Math.round((attempted / questions.length) * 100) : 0
      });
    });
    const activeSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
    const activeExam = state.activeExamId ? state.exams[state.activeExamId] : null;
    return {
      totalQuestions,
      attemptedCount: totals.attempted,
      progressPercent: totalQuestions ? Math.round((totals.attempted / totalQuestions) * 100) : 0,
      totalAttempts: totals.attempts,
      todayAttempts,
      accuracy: totals.attempts ? Math.round((totals.correct / totals.attempts) * 100) : 0,
      unmasteredWrongCount: totals.wrong,
      favoriteCount: totals.favorites,
      modules,
      activeSession: activeSession && activeSession.status === 'active' ? this.sessionSummary(activeSession) : null,
      activeExam: activeExam && activeExam.status === 'active' ? this.examSummary(activeExam) : null
    };
  }

  getSubjectOverview(subjectId) {
    const state = this.loadState();
    const subject = this.subjectState(state, subjectId);
    const questions = this.activeQuestions(subjectId);
    const active = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
    const attemptedCount = Object.keys(subject.attemptedQuestions).length;
    return {
      subjectId,
      totalQuestions: questions.length,
      attemptedCount,
      progressPercent: questions.length ? Math.round((attemptedCount / questions.length) * 100) : 0,
      totalAttempts: subject.totals.attempts,
      accuracy: subject.totals.attempts ? Math.round((subject.totals.correct / subject.totals.attempts) * 100) : 0,
      unmasteredWrongCount: Object.values(subject.wrongQuestions).filter((record) => !record.mastered).length,
      favoriteCount: Object.keys(subject.favorites).length,
      activeSession: active && active.status === 'active' && active.subject === subjectId ? this.sessionSummary(active) : null
    };
  }

  getChapters(subjectId) {
    const state = this.loadState();
    const subject = this.subjectState(state, subjectId);
    const chapters = {};
    this.activeQuestions(subjectId).forEach((question) => {
      if (!chapters[question.chapterId]) {
        chapters[question.chapterId] = {
          id: question.chapterId,
          name: question.chapterName,
          order: question.chapterOrder,
          totalCount: 0,
          attemptedCount: 0,
          attempts: 0,
          correct: 0
        };
      }
      const chapter = chapters[question.chapterId];
      chapter.totalCount += 1;
      const attempt = subject.attemptedQuestions[question.id];
      if (attempt) {
        chapter.attemptedCount += 1;
        chapter.attempts += attempt.attempts;
        chapter.correct += attempt.correct;
      }
    });
    return Object.values(chapters).sort((a, b) => a.order - b.order).map((chapter) => Object.assign(chapter, {
      progressPercent: chapter.totalCount ? Math.round((chapter.attemptedCount / chapter.totalCount) * 100) : 0,
      accuracy: chapter.attempts ? Math.round((chapter.correct / chapter.attempts) * 100) : 0
    }));
  }

  createSession(payload) {
    const mode = payload.mode;
    if (!this.registry.getSubject(payload.subject)) throw createDomainError('学科不存在', 'SUBJECT_NOT_FOUND');
    if (!['chapter', 'random', 'wrong', 'favorite'].includes(mode)) throw createDomainError('不支持的练习模式', 'INVALID_MODE');
    if (![5, 10, 20].includes(Number(payload.count))) throw createDomainError('题量只能选择 5、10 或 20', 'INVALID_COUNT');
    const state = this.loadState();
    const subject = this.subjectState(state, payload.subject);
    let candidates = this.activeQuestions(payload.subject);
    if (mode === 'chapter') {
      if (!payload.chapterId) throw createDomainError('章节练习缺少 chapterId', 'CHAPTER_REQUIRED');
      candidates = candidates.filter((question) => question.chapterId === payload.chapterId);
    } else if (mode === 'wrong') {
      candidates = candidates.filter((question) => subject.wrongQuestions[question.id] && !subject.wrongQuestions[question.id].mastered);
    } else if (mode === 'favorite') {
      candidates = candidates.filter((question) => subject.favorites[question.id]);
    }
    if (!candidates.length) throw createDomainError('当前没有可练习的题目', 'EMPTY_QUESTION_POOL');
    if (state.activeSessionId && state.sessions[state.activeSessionId]) state.sessions[state.activeSessionId].status = 'abandoned';
    const timestamp = this.now();
    const session = {
      id: `practice_${timestamp}_${Math.floor(this.random() * 100000)}`,
      subject: payload.subject,
      mode,
      chapterId: payload.chapterId || '',
      questionIds: this.shuffle(candidates).slice(0, Math.min(Number(payload.count), candidates.length)).map((item) => item.id),
      answers: {},
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.sessions[session.id] = session;
    state.activeSessionId = session.id;
    this.saveState(state);
    return this.sessionView(session, state);
  }

  sessionSummary(session) {
    return {
      id: session.id,
      subjectId: session.subject,
      mode: session.mode,
      answeredCount: Object.keys(session.answers).length,
      totalCount: session.questionIds.length,
      updatedAt: session.updatedAt
    };
  }

  sessionView(session, state) {
    return Object.assign(this.sessionSummary(session), {
      subject: session.subject,
      chapterId: session.chapterId,
      status: session.status,
      createdAt: session.createdAt,
      currentIndex: Math.min(Object.keys(session.answers).length, session.questionIds.length - 1),
      questions: session.questionIds.map((id) => this.publicQuestion(this.questionMap[id], state)),
      answers: clone(session.answers)
    });
  }

  getSession(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    return this.sessionView(session, state);
  }

  markAttempt(state, question, isCorrect, timestamp) {
    const subject = this.subjectState(state, question.subjectId);
    const attempted = subject.attemptedQuestions[question.id] || {
      questionId: question.id,
      chapterId: question.chapterId,
      attempts: 0,
      correct: 0
    };
    attempted.attempts += 1;
    attempted.correct += isCorrect ? 1 : 0;
    attempted.lastAttemptAt = timestamp;
    subject.attemptedQuestions[question.id] = attempted;
    subject.totals.attempts += 1;
    subject.totals.correct += isCorrect ? 1 : 0;
    const date = this.dateKey(timestamp);
    state.dailyAttempts[date] = (state.dailyAttempts[date] || 0) + 1;
  }

  markWrong(state, question, isCorrect, mode, timestamp) {
    const subject = this.subjectState(state, question.subjectId);
    const wrong = subject.wrongQuestions[question.id];
    if (!isCorrect) {
      subject.wrongQuestions[question.id] = Object.assign(wrong || { questionId: question.id, wrongCount: 0 }, {
        wrongCount: (wrong ? wrong.wrongCount : 0) + 1,
        mastered: false,
        lastWrongAt: timestamp,
        masteredAt: null
      });
    } else if (mode === 'wrong' && wrong) {
      wrong.mastered = true;
      wrong.masteredAt = timestamp;
    }
  }

  submitAnswer(sessionId, payload) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    if (session.status !== 'active') throw createDomainError('当前练习已结束', 'SESSION_FINISHED');
    if (payload.clientAnswerId && state.submissions[payload.clientAnswerId]) return clone(state.submissions[payload.clientAnswerId]);
    if (!session.questionIds.includes(payload.questionId)) throw createDomainError('题目不属于当前练习', 'QUESTION_NOT_IN_SESSION');
    if (session.answers[payload.questionId]) throw createDomainError('该题已经提交，不能修改答案', 'ANSWER_ALREADY_SUBMITTED');
    const question = this.questionMap[payload.questionId];
    const selected = payload.selectedOptionIds || [];
    if (!selected.length) throw createDomainError('请先选择答案', 'ANSWER_REQUIRED');
    if (selected.some((id) => !question.options.some((option) => option.id === id))) throw createDomainError('提交的选项不存在', 'INVALID_OPTION');
    const timestamp = this.now();
    const result = {
      questionId: question.id,
      selectedOptionIds: clone(selected),
      correctOptionIds: clone(question.correctOptionIds),
      isCorrect: sameAnswer(selected, question.correctOptionIds),
      explanation: question.explanation,
      submittedAt: timestamp
    };
    session.answers[question.id] = result;
    session.updatedAt = timestamp;
    this.markAttempt(state, question, result.isCorrect, timestamp);
    this.markWrong(state, question, result.isCorrect, session.mode, timestamp);
    if (payload.clientAnswerId) state.submissions[payload.clientAnswerId] = result;
    this.saveState(state);
    return clone(result);
  }

  finishSession(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    if (session.status === 'completed') return this.buildSessionResult(session);
    if (Object.keys(session.answers).length !== session.questionIds.length) throw createDomainError('仍有题目未完成', 'SESSION_INCOMPLETE');
    session.status = 'completed';
    session.completedAt = this.now();
    session.updatedAt = session.completedAt;
    if (state.activeSessionId === sessionId) state.activeSessionId = '';
    this.saveState(state);
    return this.buildSessionResult(session);
  }

  buildSessionResult(session) {
    const chapters = {};
    Object.values(session.answers).forEach((answer) => {
      const question = this.questionMap[answer.questionId];
      if (!chapters[question.chapterId]) chapters[question.chapterId] = { chapterId: question.chapterId, chapterName: question.chapterName, totalCount: 0, correctCount: 0 };
      chapters[question.chapterId].totalCount += 1;
      chapters[question.chapterId].correctCount += answer.isCorrect ? 1 : 0;
    });
    const correctCount = Object.values(session.answers).filter((answer) => answer.isCorrect).length;
    return {
      sessionId: session.id,
      subjectId: session.subject,
      mode: session.mode,
      status: session.status,
      totalCount: session.questionIds.length,
      correctCount,
      wrongCount: session.questionIds.length - correctCount,
      accuracy: session.questionIds.length ? Math.round((correctCount / session.questionIds.length) * 100) : 0,
      chapters: Object.values(chapters).map((chapter) => Object.assign(chapter, { accuracy: Math.round((chapter.correctCount / chapter.totalCount) * 100) }))
    };
  }

  getResult(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    if (session.status !== 'completed') throw createDomainError('练习尚未完成', 'SESSION_INCOMPLETE');
    return this.buildSessionResult(session);
  }

  getWrongQuestions(subjectId, mastered) {
    const state = this.loadState();
    const subjectIds = subjectId ? [subjectId] : this.registry.subjectIds;
    const records = [];
    subjectIds.forEach((id) => {
      const subject = this.subjectState(state, id);
      Object.values(subject.wrongQuestions).forEach((record) => {
        if (mastered === undefined || mastered === null || record.mastered === mastered) {
          const question = this.questionMap[record.questionId];
          if (question) records.push(this.reviewQuestion(question, state));
        }
      });
    });
    return records.sort((a, b) => ((b.wrong && b.wrong.lastWrongAt) || 0) - ((a.wrong && a.wrong.lastWrongAt) || 0));
  }

  getFavorites(subjectId) {
    const state = this.loadState();
    const subjectIds = subjectId ? [subjectId] : this.registry.subjectIds;
    const records = [];
    subjectIds.forEach((id) => {
      const subject = this.subjectState(state, id);
      Object.keys(subject.favorites).forEach((questionId) => {
        const question = this.questionMap[questionId];
        if (question) records.push({ savedAt: subject.favorites[questionId], question: this.reviewQuestion(question, state) });
      });
    });
    return records.sort((a, b) => b.savedAt - a.savedAt).map((item) => item.question);
  }

  setFavorite(subjectId, questionId, favorite) {
    const state = this.loadState();
    const question = this.questionMap[questionId];
    if (!question || question.subjectId !== subjectId) throw createDomainError('题目不存在', 'QUESTION_NOT_FOUND');
    const subject = this.subjectState(state, subjectId);
    if (favorite) subject.favorites[questionId] = this.now();
    else delete subject.favorites[questionId];
    this.saveState(state);
    return { subjectId, questionId, isFavorite: Boolean(favorite) };
  }

  createExam() {
    let state = this.loadState();
    const active = state.activeExamId ? state.exams[state.activeExamId] : null;
    if (active && active.status === 'active' && this.now() < active.expiresAt) throw createDomainError('已有未完成的模拟考试', 'ACTIVE_EXAM_EXISTS');
    if (active && active.status === 'active') {
      this.submitExam(active.id);
      state = this.loadState();
    }
    const questionIds = [];
    Object.keys(EXAM_DISTRIBUTION).forEach((subjectId) => {
      const pool = this.activeQuestions(subjectId).filter((question) => question.type === 'single' && (question.examScopes || []).includes('408'));
      const required = EXAM_DISTRIBUTION[subjectId];
      if (pool.length < required) throw createDomainError(`${subjectId} 单选题数量不足`, 'EXAM_POOL_INSUFFICIENT');
      questionIds.push(...this.shuffle(pool).slice(0, required).map((question) => question.id));
    });
    const timestamp = this.now();
    const exam = {
      id: `exam_${timestamp}_${Math.floor(this.random() * 100000)}`,
      type: EXAM_TYPE,
      questionIds: this.shuffle(questionIds),
      answers: {},
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + EXAM_DURATION_MS,
      submittedAt: null,
      result: null
    };
    state.exams[exam.id] = exam;
    state.activeExamId = exam.id;
    this.saveState(state);
    return this.examView(exam, state);
  }

  examSummary(exam) {
    return {
      id: exam.id,
      type: exam.type,
      status: exam.status,
      answeredCount: Object.keys(exam.answers).length,
      totalCount: exam.questionIds.length,
      createdAt: exam.createdAt,
      expiresAt: exam.expiresAt,
      score: exam.result ? exam.result.score : null
    };
  }

  examView(exam, state) {
    return Object.assign(this.examSummary(exam), {
      updatedAt: exam.updatedAt,
      remainingSeconds: Math.max(0, Math.ceil((exam.expiresAt - this.now()) / 1000)),
      questions: exam.questionIds.map((id) => this.publicQuestion(this.questionMap[id], state)),
      answers: clone(exam.answers)
    });
  }

  getExam(examId) {
    let state = this.loadState();
    const exam = state.exams[examId];
    if (!exam) throw createDomainError('模拟考试不存在', 'EXAM_NOT_FOUND');
    if (exam.status === 'active' && this.now() >= exam.expiresAt) {
      this.submitExam(examId);
      state = this.loadState();
    }
    return this.examView(state.exams[examId], state);
  }

  saveExamDraft(examId, answers) {
    const state = this.loadState();
    const exam = state.exams[examId];
    if (!exam) throw createDomainError('模拟考试不存在', 'EXAM_NOT_FOUND');
    if (exam.status !== 'active') throw createDomainError('模拟考试已交卷', 'EXAM_FINISHED');
    if (this.now() >= exam.expiresAt) return this.submitExam(examId);
    const allowed = new Set(exam.questionIds);
    exam.answers = {};
    Object.keys(answers || {}).forEach((questionId) => {
      if (!allowed.has(questionId)) throw createDomainError('题目不属于当前试卷', 'QUESTION_NOT_IN_EXAM');
      const question = this.questionMap[questionId];
      const selected = answers[questionId] || [];
      if (selected.length > 1 || selected.some((id) => !question.options.some((option) => option.id === id))) throw createDomainError('试卷答案无效', 'INVALID_OPTION');
      if (selected.length) exam.answers[questionId] = clone(selected);
      else delete exam.answers[questionId];
    });
    exam.updatedAt = this.now();
    this.saveState(state);
    return this.examView(exam, state);
  }

  submitExam(examId) {
    const state = this.loadState();
    const exam = state.exams[examId];
    if (!exam) throw createDomainError('模拟考试不存在', 'EXAM_NOT_FOUND');
    if (exam.status === 'completed') return clone(exam.result);
    const timestamp = this.now();
    const reviews = exam.questionIds.map((questionId) => {
      const question = this.questionMap[questionId];
      const selected = exam.answers[questionId] || [];
      const isCorrect = sameAnswer(selected, question.correctOptionIds);
      this.markAttempt(state, question, isCorrect, timestamp);
      this.markWrong(state, question, isCorrect, 'exam', timestamp);
      return {
        question: clone(question),
        selectedOptionIds: clone(selected),
        isCorrect
      };
    });
    const subjects = {};
    reviews.forEach((review) => {
      const question = review.question;
      if (!subjects[question.subjectId]) subjects[question.subjectId] = { subjectId: question.subjectId, totalCount: 0, correctCount: 0 };
      subjects[question.subjectId].totalCount += 1;
      subjects[question.subjectId].correctCount += review.isCorrect ? 1 : 0;
    });
    const correctCount = reviews.filter((review) => review.isCorrect).length;
    exam.status = 'completed';
    exam.submittedAt = timestamp;
    exam.updatedAt = timestamp;
    exam.result = {
      examId: exam.id,
      type: exam.type,
      totalCount: exam.questionIds.length,
      answeredCount: Object.keys(exam.answers).length,
      correctCount,
      wrongCount: exam.questionIds.length - correctCount,
      score: correctCount * 2,
      maxScore: 80,
      accuracy: Math.round((correctCount / exam.questionIds.length) * 100),
      subjects: Object.values(subjects).map((subject) => Object.assign(subject, { accuracy: Math.round((subject.correctCount / subject.totalCount) * 100) })),
      reviews,
      submittedAt: timestamp
    };
    if (state.activeExamId === examId) state.activeExamId = '';
    this.saveState(state);
    return clone(exam.result);
  }

  getExamResult(examId) {
    const state = this.loadState();
    const exam = state.exams[examId];
    if (!exam) throw createDomainError('模拟考试不存在', 'EXAM_NOT_FOUND');
    if (exam.status !== 'completed') throw createDomainError('模拟考试尚未交卷', 'EXAM_INCOMPLETE');
    return clone(exam.result);
  }

  listExams() {
    const state = this.loadState();
    return Object.values(state.exams).sort((a, b) => b.createdAt - a.createdAt).map((exam) => this.examSummary(exam));
  }

  reset() {
    this.saveState(initialState());
  }
}

module.exports = {
  PracticeCore,
  initialState,
  emptySubjectState,
  sameAnswer,
  createDomainError,
  EXAM_DISTRIBUTION,
  EXAM_DURATION_MS,
  EXAM_TYPE
};
