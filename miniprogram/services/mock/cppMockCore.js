const STATE_VERSION = 1;

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

function initialState() {
  return {
    version: STATE_VERSION,
    sessions: {},
    activeSessionId: '',
    submissions: {},
    attemptedQuestions: {},
    wrongQuestions: {},
    favorites: {},
    totals: {
      attempts: 0,
      correct: 0
    }
  };
}

class CppMockCore {
  constructor(options) {
    this.questions = options.questions || [];
    this.storage = options.storage;
    this.random = options.random || Math.random;
    this.now = options.now || (() => Date.now());
    this.stateKey = options.stateKey || 'cpp_mock_state_v1';
    this.questionMap = this.questions.reduce((map, question) => {
      map[question.id] = question;
      return map;
    }, {});
  }

  loadState() {
    const state = this.storage.get(this.stateKey);
    if (!state || state.version !== STATE_VERSION) {
      return initialState();
    }
    return state;
  }

  saveState(state) {
    this.storage.set(this.stateKey, state);
  }

  activeQuestions() {
    return this.questions.filter((question) => question.status === 'active');
  }

  publicQuestion(question, state) {
    return {
      id: question.id,
      chapterId: question.chapterId,
      chapterName: question.chapterName,
      type: question.type,
      stem: question.stem,
      code: question.code || '',
      options: clone(question.options),
      difficulty: question.difficulty,
      tags: clone(question.tags),
      version: question.version,
      isFavorite: Boolean(state.favorites[question.id])
    };
  }

  reviewQuestion(question, state) {
    const wrong = state.wrongQuestions[question.id] || null;
    return Object.assign(this.publicQuestion(question, state), {
      correctOptionIds: clone(question.correctOptionIds),
      explanation: question.explanation,
      wrong: wrong ? clone(wrong) : null
    });
  }

  getOverview() {
    const state = this.loadState();
    const active = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
    const attemptedCount = Object.keys(state.attemptedQuestions).length;
    const totalQuestions = this.activeQuestions().length;
    const unmasteredWrongCount = Object.values(state.wrongQuestions)
      .filter((record) => !record.mastered).length;

    return {
      totalQuestions,
      attemptedCount,
      progressPercent: totalQuestions ? Math.round((attemptedCount / totalQuestions) * 100) : 0,
      totalAttempts: state.totals.attempts,
      accuracy: state.totals.attempts
        ? Math.round((state.totals.correct / state.totals.attempts) * 100)
        : 0,
      unmasteredWrongCount,
      favoriteCount: Object.keys(state.favorites).length,
      activeSession: active && active.status === 'active'
        ? {
            id: active.id,
            mode: active.mode,
            answeredCount: Object.keys(active.answers).length,
            totalCount: active.questionIds.length,
            updatedAt: active.updatedAt
          }
        : null
    };
  }

  getChapters() {
    const state = this.loadState();
    const chapterMap = {};
    this.activeQuestions().forEach((question) => {
      if (!chapterMap[question.chapterId]) {
        chapterMap[question.chapterId] = {
          id: question.chapterId,
          name: question.chapterName,
          order: question.chapterOrder,
          totalCount: 0,
          attemptedCount: 0,
          attempts: 0,
          correct: 0
        };
      }
      const chapter = chapterMap[question.chapterId];
      chapter.totalCount += 1;
      const attempt = state.attemptedQuestions[question.id];
      if (attempt) {
        chapter.attemptedCount += 1;
        chapter.attempts += attempt.attempts;
        chapter.correct += attempt.correct;
      }
    });

    return Object.values(chapterMap)
      .sort((a, b) => a.order - b.order)
      .map((chapter) => Object.assign(chapter, {
        progressPercent: chapter.totalCount
          ? Math.round((chapter.attemptedCount / chapter.totalCount) * 100)
          : 0,
        accuracy: chapter.attempts ? Math.round((chapter.correct / chapter.attempts) * 100) : 0
      }));
  }

  shuffle(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      const current = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = current;
    }
    return result;
  }

  createSession(payload) {
    const mode = payload.mode;
    const allowedModes = ['chapter', 'random', 'wrong', 'favorite'];
    if (!allowedModes.includes(mode)) {
      throw createDomainError('不支持的练习模式', 'INVALID_MODE');
    }
    if (![5, 10, 20].includes(Number(payload.count))) {
      throw createDomainError('题量只能选择 5、10 或 20', 'INVALID_COUNT');
    }

    const state = this.loadState();
    let candidates = this.activeQuestions();
    if (mode === 'chapter') {
      if (!payload.chapterId) {
        throw createDomainError('章节练习缺少 chapterId', 'CHAPTER_REQUIRED');
      }
      candidates = candidates.filter((question) => question.chapterId === payload.chapterId);
    } else if (mode === 'wrong') {
      candidates = candidates.filter((question) => {
        const record = state.wrongQuestions[question.id];
        return record && !record.mastered;
      });
    } else if (mode === 'favorite') {
      candidates = candidates.filter((question) => state.favorites[question.id]);
    }

    if (!candidates.length) {
      throw createDomainError('当前没有可练习的题目', 'EMPTY_QUESTION_POOL');
    }

    if (state.activeSessionId && state.sessions[state.activeSessionId]) {
      state.sessions[state.activeSessionId].status = 'abandoned';
    }

    const questionIds = this.shuffle(candidates)
      .slice(0, Math.min(Number(payload.count), candidates.length))
      .map((question) => question.id);
    const timestamp = this.now();
    const sessionId = `mock_${timestamp}_${Math.floor(this.random() * 100000)}`;
    const session = {
      id: sessionId,
      subject: 'cpp',
      mode,
      chapterId: payload.chapterId || '',
      questionIds,
      answers: {},
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.sessions[sessionId] = session;
    state.activeSessionId = sessionId;
    this.saveState(state);
    return this.sessionView(session, state);
  }

  sessionView(session, state) {
    return {
      id: session.id,
      subject: session.subject,
      mode: session.mode,
      chapterId: session.chapterId,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      answeredCount: Object.keys(session.answers).length,
      totalCount: session.questionIds.length,
      currentIndex: Math.min(Object.keys(session.answers).length, session.questionIds.length - 1),
      questions: session.questionIds.map((id) => this.publicQuestion(this.questionMap[id], state)),
      answers: clone(session.answers)
    };
  }

  getSession(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) {
      throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    }
    return this.sessionView(session, state);
  }

  submitAnswer(sessionId, payload) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) {
      throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    }
    if (session.status !== 'active') {
      throw createDomainError('当前练习已结束', 'SESSION_FINISHED');
    }
    if (payload.clientAnswerId && state.submissions[payload.clientAnswerId]) {
      return clone(state.submissions[payload.clientAnswerId]);
    }
    if (!session.questionIds.includes(payload.questionId)) {
      throw createDomainError('题目不属于当前练习', 'QUESTION_NOT_IN_SESSION');
    }
    if (session.answers[payload.questionId]) {
      throw createDomainError('该题已经提交，不能修改答案', 'ANSWER_ALREADY_SUBMITTED');
    }
    if (!Array.isArray(payload.selectedOptionIds) || !payload.selectedOptionIds.length) {
      throw createDomainError('请先选择答案', 'ANSWER_REQUIRED');
    }

    const question = this.questionMap[payload.questionId];
    const validOptionIds = question.options.map((option) => option.id);
    const hasInvalidOption = payload.selectedOptionIds.some((id) => !validOptionIds.includes(id));
    if (hasInvalidOption) {
      throw createDomainError('提交的选项不存在', 'INVALID_OPTION');
    }

    const timestamp = this.now();
    const isCorrect = sameAnswer(payload.selectedOptionIds, question.correctOptionIds);
    const result = {
      questionId: question.id,
      selectedOptionIds: clone(payload.selectedOptionIds),
      correctOptionIds: clone(question.correctOptionIds),
      isCorrect,
      explanation: question.explanation,
      submittedAt: timestamp
    };
    session.answers[question.id] = result;
    session.updatedAt = timestamp;
    state.totals.attempts += 1;
    state.totals.correct += isCorrect ? 1 : 0;

    const attempted = state.attemptedQuestions[question.id] || {
      questionId: question.id,
      chapterId: question.chapterId,
      attempts: 0,
      correct: 0
    };
    attempted.attempts += 1;
    attempted.correct += isCorrect ? 1 : 0;
    attempted.lastAttemptAt = timestamp;
    state.attemptedQuestions[question.id] = attempted;

    const wrong = state.wrongQuestions[question.id];
    if (!isCorrect) {
      state.wrongQuestions[question.id] = Object.assign(wrong || {
        questionId: question.id,
        wrongCount: 0
      }, {
        wrongCount: (wrong ? wrong.wrongCount : 0) + 1,
        mastered: false,
        lastWrongAt: timestamp,
        masteredAt: null
      });
    } else if (session.mode === 'wrong' && wrong) {
      wrong.mastered = true;
      wrong.masteredAt = timestamp;
    }

    if (payload.clientAnswerId) {
      state.submissions[payload.clientAnswerId] = result;
    }
    this.saveState(state);
    return clone(result);
  }

  finishSession(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) {
      throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    }
    if (session.status === 'completed') {
      return this.buildResult(session);
    }
    if (Object.keys(session.answers).length !== session.questionIds.length) {
      throw createDomainError('仍有题目未完成', 'SESSION_INCOMPLETE');
    }
    session.status = 'completed';
    session.completedAt = this.now();
    session.updatedAt = session.completedAt;
    if (state.activeSessionId === sessionId) {
      state.activeSessionId = '';
    }
    this.saveState(state);
    return this.buildResult(session);
  }

  buildResult(session) {
    const answers = Object.values(session.answers);
    const chapterMap = {};
    answers.forEach((answer) => {
      const question = this.questionMap[answer.questionId];
      if (!chapterMap[question.chapterId]) {
        chapterMap[question.chapterId] = {
          chapterId: question.chapterId,
          chapterName: question.chapterName,
          totalCount: 0,
          correctCount: 0
        };
      }
      chapterMap[question.chapterId].totalCount += 1;
      chapterMap[question.chapterId].correctCount += answer.isCorrect ? 1 : 0;
    });
    const correctCount = answers.filter((answer) => answer.isCorrect).length;
    return {
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      totalCount: session.questionIds.length,
      correctCount,
      wrongCount: session.questionIds.length - correctCount,
      accuracy: session.questionIds.length
        ? Math.round((correctCount / session.questionIds.length) * 100)
        : 0,
      chapters: Object.values(chapterMap).map((chapter) => Object.assign(chapter, {
        accuracy: Math.round((chapter.correctCount / chapter.totalCount) * 100)
      }))
    };
  }

  getResult(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) {
      throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    }
    if (session.status !== 'completed') {
      throw createDomainError('练习尚未完成', 'SESSION_INCOMPLETE');
    }
    return this.buildResult(session);
  }

  getWrongQuestions(filter) {
    const state = this.loadState();
    return Object.values(state.wrongQuestions)
      .filter((record) => filter === undefined || filter === null || record.mastered === filter)
      .sort((a, b) => (b.lastWrongAt || 0) - (a.lastWrongAt || 0))
      .map((record) => this.reviewQuestion(this.questionMap[record.questionId], state));
  }

  getFavorites() {
    const state = this.loadState();
    return Object.keys(state.favorites)
      .sort((a, b) => state.favorites[b] - state.favorites[a])
      .map((questionId) => this.reviewQuestion(this.questionMap[questionId], state));
  }

  setFavorite(questionId, favorite) {
    const state = this.loadState();
    if (!this.questionMap[questionId]) {
      throw createDomainError('题目不存在', 'QUESTION_NOT_FOUND');
    }
    if (favorite) {
      state.favorites[questionId] = this.now();
    } else {
      delete state.favorites[questionId];
    }
    this.saveState(state);
    return { questionId, isFavorite: Boolean(favorite) };
  }

  reset() {
    this.saveState(initialState());
  }
}

module.exports = {
  CppMockCore,
  initialState,
  sameAnswer,
  createDomainError
};
