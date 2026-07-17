const STATE_VERSION = 2;
const EXAM_TYPE = 'postgraduate-408-objective';
const EXAM_DURATION_MS = 60 * 60 * 1000;
const EXAM_DISTRIBUTION = { ds: 12, co: 12, os: 9, network: 7 };
const {
  initialGamification,
  ensureGamification,
  awardAnswers,
  evaluateAchievements,
  getGamificationMe,
  leaderboard,
  updateProfile,
  getAchievements,
  equipTitle
} = require('./gamificationCore');

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

function normalizeFill(value, config) {
  let result = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!(config && config.caseSensitive)) result = result.toLocaleLowerCase('zh-CN');
  if (!(config && config.punctuationSensitive)) result = result.replace(/[^\p{L}\p{N}\s]/gu, '');
  return result;
}

function sameFillAnswer(submitted, accepted, config) {
  return submitted.length === accepted.length && submitted.every((answer, index) => {
    const normalized = normalizeFill(answer, config);
    return (accepted[index] || []).some((candidate) => normalizeFill(candidate, config) === normalized);
  });
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
    activeExamId: '',
    gamification: initialGamification()
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
    if (current && current.version === STATE_VERSION) {
      const normalized = clone(current);
      const changed = this.normalizeSessionScopes(normalized);
      if (changed) this.saveState(normalized);
      return normalized;
    }
    const migrated = this.migrateLegacyState(this.storage.get(this.legacyStateKey));
    this.saveState(migrated);
    return migrated;
  }

  normalizeSessionScopes(state) {
    let changed = false;
    if (ensureGamification(state, this.now())) changed = true;
    Object.values(state.sessions || {}).forEach((session) => {
      if (!session.scope) {
        session.scope = 'subject';
        changed = true;
      }
      if (session.scope === 'all') {
        if (session.subject !== null) {
          session.subject = null;
          changed = true;
        }
      } else if (!session.subject) {
        session.subject = 'cpp';
        changed = true;
      }
    });
    return changed;
  }

  migrateLegacyState(legacy) {
    const state = initialState();
    if (!legacy || legacy.version !== 1) return state;
    state.sessions = clone(legacy.sessions || {});
    Object.values(state.sessions).forEach((session) => {
      session.scope = 'subject';
      session.subject = session.subject || 'cpp';
    });
    state.activeSessionId = legacy.activeSessionId || '';
    state.submissions = clone(legacy.submissions || {});
    state.subjects.cpp = {
      attemptedQuestions: clone(legacy.attemptedQuestions || {}),
      wrongQuestions: clone(legacy.wrongQuestions || {}),
      favorites: clone(legacy.favorites || {}),
      totals: clone(legacy.totals || { attempts: 0, correct: 0 })
    };
    delete state.gamification;
    ensureGamification(state, this.now());
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
      blankCount: question.type === 'fill_blank' ? (question.acceptedAnswers || []).length : 0,
      isFavorite: Boolean(subject.favorites[question.id])
    };
  }

  reviewQuestion(question, state) {
    const subject = this.subjectState(state, question.subjectId);
    const wrong = subject.wrongQuestions[question.id] || null;
    return Object.assign(this.publicQuestion(question, state), {
      correctOptionIds: clone(question.correctOptionIds),
      acceptedAnswers: clone(question.acceptedAnswers || []),
      referenceAnswer: question.referenceAnswer || '',
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
    const scope = payload.scope === undefined ? 'subject' : payload.scope;
    const mode = payload.mode;
    if (!['subject', 'all'].includes(scope)) throw createDomainError('不支持的练习范围', 'INVALID_SCOPE');
    if (!['chapter', 'random', 'wrong', 'favorite'].includes(mode)) throw createDomainError('不支持的练习模式', 'INVALID_MODE');
    if (scope === 'all' && (mode !== 'favorite' || payload.subject !== undefined || payload.chapterId !== undefined)) {
      throw createDomainError('全学科范围仅支持不指定学科和章节的收藏重练', 'INVALID_GLOBAL_SESSION');
    }
    if (scope === 'subject' && !payload.subject) throw createDomainError('单学科练习缺少 subject', 'SUBJECT_REQUIRED');
    if (scope === 'subject' && !this.registry.getSubject(payload.subject)) throw createDomainError('学科不存在', 'SUBJECT_NOT_FOUND');
    const allCount = payload.count === 'all';
    const numericCount = Number(payload.count);
    if (scope === 'all') {
      if (!allCount && ![5, 10, 20].includes(numericCount)) throw createDomainError('题量只能选择 5、10、20 或全部', 'INVALID_COUNT');
    } else if (allCount || ![5, 10, 20].includes(numericCount)) {
      throw createDomainError('题量只能选择 5、10 或 20', 'INVALID_COUNT');
    }
    if (scope === 'subject' && mode !== 'chapter' && payload.chapterId !== undefined) {
      throw createDomainError('仅章节练习可以指定 chapterId', 'CHAPTER_NOT_ALLOWED');
    }
    const state = this.loadState();
    const subject = scope === 'subject' ? this.subjectState(state, payload.subject) : null;
    let candidates = this.activeQuestions(scope === 'subject' ? payload.subject : undefined);
    if (scope === 'all') {
      candidates = candidates.filter((question) => this.subjectState(state, question.subjectId).favorites[question.id]);
    } else if (mode === 'chapter') {
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
    const selectedQuestions = this.shuffle(candidates).slice(0, allCount ? candidates.length : Math.min(numericCount, candidates.length));
    const session = {
      id: `practice_${timestamp}_${Math.floor(this.random() * 100000)}`,
      scope,
      subject: scope === 'all' ? null : payload.subject,
      mode,
      chapterId: payload.chapterId || '',
      requestedCount: allCount ? selectedQuestions.length : numericCount,
      questionIds: selectedQuestions.map((item) => item.id),
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
    const scope = session.scope || 'subject';
    const subjectId = scope === 'all' ? null : session.subject;
    return {
      id: session.id,
      scope,
      subjectId,
      subject: subjectId,
      mode: session.mode,
      answeredCount: Object.keys(session.answers).length,
      totalCount: session.questionIds.length,
      updatedAt: session.updatedAt
    };
  }

  sessionView(session, state) {
    return Object.assign(this.sessionSummary(session), {
      chapterId: session.chapterId,
      status: session.status,
      createdAt: session.createdAt,
      currentIndex: Math.min(Object.values(session.answers).filter((answer) => answer.isCorrect !== null).length, session.questionIds.length - 1),
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
    let selected = [];
    let textAnswers = [];
    let isCorrect = null;
    if (['single', 'multiple', 'judge'].includes(question.type)) {
      selected = payload.selectedOptionIds || (payload.answer && payload.answer.optionIds) || [];
      if (!selected.length) throw createDomainError('请先选择答案', 'ANSWER_REQUIRED');
      if (selected.some((id) => !question.options.some((option) => option.id === id))) throw createDomainError('提交的选项不存在', 'INVALID_OPTION');
      isCorrect = sameAnswer(selected, question.correctOptionIds);
    } else if (question.type === 'fill_blank') {
      textAnswers = (payload.answer && payload.answer.values) || (Array.isArray(payload.textAnswer) ? payload.textAnswer : [payload.textAnswer || '']);
      if (textAnswers.some((value) => !String(value).trim())) throw createDomainError('请完成全部填空', 'ANSWER_REQUIRED');
      isCorrect = sameFillAnswer(textAnswers, question.acceptedAnswers || [], question.answerConfig || {});
    } else {
      const value = (payload.answer && payload.answer.value) || payload.textAnswer || '';
      if (!String(value).trim()) throw createDomainError('请先填写简答内容', 'ANSWER_REQUIRED');
      textAnswers = [String(value).trim()];
    }
    const timestamp = this.now();
    const result = {
      questionId: question.id,
      selectedOptionIds: clone(selected),
      textAnswers: clone(textAnswers),
      answerType: question.type,
      correctOptionIds: clone(question.correctOptionIds),
      acceptedAnswers: question.type === 'fill_blank' ? clone(question.acceptedAnswers || []) : [],
      referenceAnswer: question.type === 'short_answer' ? (question.referenceAnswer || '') : '',
      evaluationRequired: question.type === 'short_answer',
      selfAssessment: null,
      isCorrect,
      explanation: question.explanation,
      submittedAt: timestamp,
      pointsAwarded: 0,
      unlockedAchievementKeys: []
    };
    session.answers[question.id] = result;
    session.updatedAt = timestamp;
    this.markAttempt(state, question, Boolean(result.isCorrect), timestamp);
    if (result.isCorrect !== null) this.markWrong(state, question, result.isCorrect, session.mode, timestamp);
    const reward = awardAnswers(state, [{ questionId: question.id, subjectId: question.subjectId, isCorrect: Boolean(result.isCorrect), allowCorrectReward: question.type !== 'short_answer', occurredAt: timestamp }]);
    result.pointsAwarded = reward.pointsAwarded;
    result.unlockedAchievementKeys = reward.unlockedAchievements.map((achievement) => achievement.key);
    if (payload.clientAnswerId) state.submissions[payload.clientAnswerId] = result;
    this.saveState(state);
    return clone(result);
  }

  assessShortAnswer(sessionId, questionId, assessment) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session || session.status !== 'active') throw createDomainError('练习不存在或已经结束', 'SESSION_NOT_FOUND');
    const question = this.questionMap[questionId];
    const answer = session.answers[questionId];
    if (!question || question.type !== 'short_answer' || !answer) throw createDomainError('简答题尚未提交', 'ANSWER_REQUIRED');
    if (answer.isCorrect !== null) return clone(answer);
    const mastered = assessment === 'mastered';
    answer.isCorrect = mastered;
    answer.selfAssessment = assessment;
    answer.evaluationRequired = false;
    if (mastered) this.subjectState(state, question.subjectId).totals.correct += 1;
    this.markWrong(state, question, mastered, session.mode, this.now());
    this.saveState(state);
    return clone(answer);
  }

  finishSession(sessionId) {
    const state = this.loadState();
    const session = state.sessions[sessionId];
    if (!session) throw createDomainError('练习不存在或已失效', 'SESSION_NOT_FOUND');
    if (session.status === 'completed') return this.buildSessionResult(session);
    if (Object.keys(session.answers).length !== session.questionIds.length) throw createDomainError('仍有题目未完成', 'SESSION_INCOMPLETE');
    if (Object.values(session.answers).some((answer) => answer.isCorrect === null)) throw createDomainError('仍有简答题尚未完成自评', 'SELF_ASSESSMENT_REQUIRED');
    session.status = 'completed';
    session.completedAt = this.now();
    session.updatedAt = session.completedAt;
    if (state.activeSessionId === sessionId) state.activeSessionId = '';
    this.saveState(state);
    return this.buildSessionResult(session);
  }

  buildSessionResult(session) {
    const chapters = {};
    const subjects = {};
    Object.values(session.answers).forEach((answer) => {
      const question = this.questionMap[answer.questionId];
      const chapterKey = `${question.subjectId}:${question.chapterId}`;
      if (!chapters[chapterKey]) chapters[chapterKey] = { subjectId: question.subjectId, chapterId: question.chapterId, chapterName: question.chapterName, totalCount: 0, correctCount: 0 };
      chapters[chapterKey].totalCount += 1;
      chapters[chapterKey].correctCount += answer.isCorrect ? 1 : 0;
      if (!subjects[question.subjectId]) subjects[question.subjectId] = { subjectId: question.subjectId, totalCount: 0, correctCount: 0 };
      subjects[question.subjectId].totalCount += 1;
      subjects[question.subjectId].correctCount += answer.isCorrect ? 1 : 0;
    });
    const correctCount = Object.values(session.answers).filter((answer) => answer.isCorrect).length;
    const scope = session.scope || 'subject';
    const subjectId = scope === 'all' ? null : session.subject;
    const withAccuracy = (item) => Object.assign(item, {
      wrongCount: item.totalCount - item.correctCount,
      accuracy: Math.round((item.correctCount / item.totalCount) * 100)
    });
    return {
      sessionId: session.id,
      scope,
      subjectId,
      subject: subjectId,
      mode: session.mode,
      status: session.status,
      totalCount: session.questionIds.length,
      correctCount,
      wrongCount: session.questionIds.length - correctCount,
      accuracy: session.questionIds.length ? Math.round((correctCount / session.questionIds.length) * 100) : 0,
      subjects: this.registry.subjectIds.filter((id) => subjects[id]).map((id) => withAccuracy(subjects[id])),
      chapters: Object.values(chapters).map(withAccuracy)
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
        if (question) {
          const attempted = Boolean(subject.attemptedQuestions[questionId]);
          records.push({
            savedAt: subject.favorites[questionId],
            question: attempted
              ? Object.assign(this.reviewQuestion(question, state), { answersAvailable: true })
              : Object.assign(this.publicQuestion(question, state), { answersAvailable: false, wrong: null })
          });
        }
      });
    });
    return records.sort((a, b) => b.savedAt - a.savedAt).map((item) => item.question);
  }

  setFavorite(subjectId, questionId, favorite) {
    const state = this.loadState();
    const question = this.questionMap[questionId];
    if (!question || question.subjectId !== subjectId) throw createDomainError('题目不存在', 'QUESTION_NOT_FOUND');
    const subject = this.subjectState(state, subjectId);
    if (favorite && !subject.attemptedQuestions[questionId]) {
      throw createDomainError('完成当前题目作答后才能收藏', 'QUESTION_NOT_ANSWERED');
    }
    if (favorite) subject.favorites[questionId] = this.now();
    else delete subject.favorites[questionId];
    ensureGamification(state, this.now());
    evaluateAchievements(state, this.now(), false);
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
    const rewardInputs = [];
    const reviews = exam.questionIds.map((questionId) => {
      const question = this.questionMap[questionId];
      const selected = exam.answers[questionId] || [];
      const isCorrect = sameAnswer(selected, question.correctOptionIds);
      this.markAttempt(state, question, isCorrect, timestamp);
      if (selected.length) rewardInputs.push({ questionId, subjectId: question.subjectId, isCorrect, occurredAt: timestamp });
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
      submittedAt: timestamp,
      pointsAwarded: 0,
      unlockedAchievementKeys: []
    };
    const reward = awardAnswers(state, rewardInputs);
    exam.result.pointsAwarded = reward.pointsAwarded;
    exam.result.unlockedAchievementKeys = reward.unlockedAchievements.map((achievement) => achievement.key);
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

  getGamificationMe() {
    const state = this.loadState();
    const result = getGamificationMe(state, this.now());
    this.saveState(state);
    return result;
  }

  updateGamificationProfile(displayName) {
    const state = this.loadState();
    const result = updateProfile(state, displayName, this.now());
    this.saveState(state);
    return result;
  }

  getLeaderboard(period, limit) {
    const state = this.loadState();
    const result = leaderboard(state, period, limit, this.now());
    this.saveState(state);
    return result;
  }

  getAchievements() {
    const state = this.loadState();
    const result = getAchievements(state, this.now());
    this.saveState(state);
    return result;
  }

  equipAchievementTitle(achievementKey) {
    const state = this.loadState();
    const result = equipTitle(state, achievementKey, this.now());
    this.saveState(state);
    return result;
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
