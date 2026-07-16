const assert = require('assert');
const fs = require('fs');
const path = require('path');
const registry = require('../miniprogram/config/subjectRegistry');
const {
  PracticeCore,
  EXAM_DISTRIBUTION,
  EXAM_DURATION_MS,
  sameAnswer
} = require('../miniprogram/services/mock/practiceCore');

const root = path.resolve(__dirname, '..');
const questions = fs.readdirSync(path.join(root, 'content'))
  .filter((name) => name.endsWith('-questions.json')).sort()
  .flatMap((name) => require(path.join(root, 'content', name)));
const questionMap = Object.fromEntries(questions.map((question) => [question.id, question]));

function memoryStorage(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    get(key) { return data[key]; },
    set(key, value) { data[key] = JSON.parse(JSON.stringify(value)); },
    data
  };
}

function makeCore(options = {}) {
  let timestamp = options.timestamp || 1760000000000;
  const clock = options.clock || (() => { timestamp += 1; return timestamp; });
  return {
    core: new PracticeCore({
      questions: options.questions || questions,
      registry,
      storage: options.storage || memoryStorage(),
      random: options.random || (() => 0.314159),
      now: clock,
      stateKey: options.stateKey || 'test_state_v2',
      legacyStateKey: options.legacyStateKey || 'test_legacy_v1'
    }),
    getTimestamp: () => timestamp,
    setTimestamp: (value) => { timestamp = value; }
  };
}

function wrongOption(question) {
  return question.options.find((option) => !question.correctOptionIds.includes(option.id)).id;
}

function answerSession(core, session, firstWrong = false) {
  session.questions.forEach((publicQuestion, index) => {
    const source = questionMap[publicQuestion.id];
    const selectedOptionIds = firstWrong && index === 0 ? [wrongOption(source)] : source.correctOptionIds;
    core.submitAnswer(session.id, {
      questionId: source.id,
      selectedOptionIds,
      clientAnswerId: `${session.id}_${source.id}`
    });
  });
  return core.finishSession(session.id);
}

assert.strictEqual(questions.length, 500);
assert.strictEqual(new Set(questions.map((item) => item.id)).size, 500);
assert.deepStrictEqual(registry.subjectIds.slice().sort(), ['co', 'cpp', 'ds', 'linux', 'network', 'os', 'stl']);
assert(sameAnswer(['A', 'B'], ['B', 'A']));
assert(!sameAnswer(['A'], ['B']));

// 七学科复用同一套章节、随机、错题与收藏流程，且会话一次只保留一个 active。
registry.subjectIds.forEach((subjectId) => {
  const { core } = makeCore({ stateKey: `subject_${subjectId}` });
  const chapters = core.getChapters(subjectId);
  assert(chapters.length > 0, `${subjectId} should have chapters`);
  const chapterSession = core.createSession({ subject: subjectId, mode: 'chapter', chapterId: chapters[0].id, count: 20 });
  assert(chapterSession.totalCount <= 20 && chapterSession.totalCount === chapters[0].totalCount);
  const first = chapterSession.questions[0];
  assert.strictEqual(first.subjectId, subjectId);
  assert.strictEqual(first.correctOptionIds, undefined);
  assert.strictEqual(first.explanation, undefined);
  const source = questionMap[first.id];
  core.submitAnswer(chapterSession.id, { questionId: first.id, selectedOptionIds: [wrongOption(source)], clientAnswerId: `${subjectId}_wrong` });

  core.setFavorite(subjectId, first.id, true);
  const favoriteSession = core.createSession({ subject: subjectId, mode: 'favorite', count: 5 });
  assert.strictEqual(favoriteSession.totalCount, 1);
  assert.strictEqual(favoriteSession.scope, 'subject');
  assert.strictEqual(favoriteSession.subject, subjectId);
  assert.strictEqual(core.getSession(chapterSession.id).status, 'abandoned');
  const wrongSession = core.createSession({ subject: subjectId, mode: 'wrong', count: 5 });
  assert.strictEqual(wrongSession.totalCount, 1);
  assert.strictEqual(core.getSession(favoriteSession.id).status, 'abandoned');
  assert.throws(() => core.createSession({ subject: subjectId, mode: 'random', count: 6 }), (error) => error.code === 'INVALID_COUNT');
});

// 普通练习判题、幂等、错题掌握状态、收藏及结果统计。
{
  const { core } = makeCore({ stateKey: 'practice_flow' });
  const session = core.createSession({ subject: 'cpp', mode: 'random', count: 5 });
  const first = questionMap[session.questions[0].id];
  const payload = { questionId: first.id, selectedOptionIds: [wrongOption(first)], clientAnswerId: 'answer_once' };
  const firstResult = core.submitAnswer(session.id, payload);
  const duplicateResult = core.submitAnswer(session.id, payload);
  assert.deepStrictEqual(duplicateResult, firstResult);
  session.questions.slice(1).forEach((item) => {
    const source = questionMap[item.id];
    core.submitAnswer(session.id, { questionId: source.id, selectedOptionIds: source.correctOptionIds, clientAnswerId: `correct_${source.id}` });
  });
  const result = core.finishSession(session.id);
  assert.strictEqual(result.totalCount, 5);
  assert.strictEqual(result.correctCount, 4);
  assert.strictEqual(result.wrongCount, 1);
  assert.strictEqual(result.status, 'completed');
  assert.deepStrictEqual(core.finishSession(session.id), result);

  assert.strictEqual(core.getWrongQuestions('cpp', false).length, 1);
  const wrongSession = core.createSession({ subject: 'cpp', mode: 'wrong', count: 20 });
  answerSession(core, wrongSession, false);
  assert.strictEqual(core.getWrongQuestions('cpp', false).length, 0);
  assert.strictEqual(core.getWrongQuestions('cpp', true).length, 1);

  core.setFavorite('cpp', first.id, true);
  assert.strictEqual(core.getFavorites('cpp').length, 1);
  const favoriteSession = core.createSession({ subject: 'cpp', mode: 'favorite', count: 5 });
  answerSession(core, favoriteSession, true);
  assert.strictEqual(core.getWrongQuestions('cpp', false).length, 1);
  core.setFavorite('cpp', first.id, false);
  assert.strictEqual(core.getFavorites().length, 0);
  assert.strictEqual(core.getSubjectOverview('cpp').totalAttempts, 7);
}

// C/C++ v1 Mock 数据迁移后，进度、错题、收藏和活动会话均保留。
{
  const storage = memoryStorage({
    legacy_key: {
      version: 1,
      sessions: {
        legacy_session: { id: 'legacy_session', mode: 'random', questionIds: ['cpp001'], answers: {}, status: 'active', createdAt: 1, updatedAt: 2 }
      },
      activeSessionId: 'legacy_session',
      submissions: { old_answer: { questionId: 'cpp002', isCorrect: true } },
      attemptedQuestions: { cpp001: { questionId: 'cpp001', chapterId: 'c-basics', attempts: 2, correct: 1 } },
      wrongQuestions: { cpp001: { questionId: 'cpp001', wrongCount: 1, mastered: false, lastWrongAt: 2 } },
      favorites: { cpp002: 3 },
      totals: { attempts: 2, correct: 1 }
    }
  });
  const { core } = makeCore({ storage, stateKey: 'new_key', legacyStateKey: 'legacy_key' });
  const overview = core.getSubjectOverview('cpp');
  assert.strictEqual(overview.attemptedCount, 1);
  assert.strictEqual(overview.totalAttempts, 2);
  assert.strictEqual(overview.unmasteredWrongCount, 1);
  assert.strictEqual(overview.favoriteCount, 1);
  assert.strictEqual(overview.activeSession.id, 'legacy_session');
  assert.strictEqual(core.getSession('legacy_session').subjectId, 'cpp');
  assert.strictEqual(core.getSession('legacy_session').scope, 'subject');
  assert.strictEqual(core.getGamificationMe().points.total, 10);
  assert.strictEqual(core.getGamificationMe().equippedTitle.key, 'first-step');
  assert.strictEqual(storage.data.new_key.version, 2);
}

// 已存在的 v2 会话补齐 scope；显式全局会话保持空学科，不会误恢复为 C/C++。
{
  const storage = memoryStorage({
    current_key: {
      version: 2,
      sessions: {
        old_subject_session: { id: 'old_subject_session', mode: 'random', questionIds: ['cpp001'], answers: {}, status: 'abandoned', createdAt: 1, updatedAt: 2 },
        global_session: { id: 'global_session', scope: 'all', mode: 'favorite', questionIds: ['ds001'], answers: {}, status: 'active', createdAt: 3, updatedAt: 4 }
      },
      activeSessionId: 'global_session',
      submissions: {},
      subjects: {},
      dailyAttempts: {},
      exams: {},
      activeExamId: ''
    }
  });
  const { core } = makeCore({ storage, stateKey: 'current_key' });
  const oldSubjectSession = core.getSession('old_subject_session');
  const globalSession = core.getSession('global_session');
  assert.strictEqual(oldSubjectSession.scope, 'subject');
  assert.strictEqual(oldSubjectSession.subjectId, 'cpp');
  assert.strictEqual(globalSession.scope, 'all');
  assert.strictEqual(globalSession.subjectId, null);
  assert.strictEqual(globalSession.subject, null);
  assert.strictEqual(storage.data.current_key.sessions.global_session.subject, null);
  assert.strictEqual(core.getLearningOverview().activeSession.scope, 'all');
  assert.strictEqual(core.getSubjectOverview('cpp').activeSession, null);
}

// 全局聚合按不同题目计进度，跨学科收藏和错题互不污染。
{
  const { core } = makeCore({ stateKey: 'global_overview' });
  ['cpp', 'ds'].forEach((subjectId) => {
    const session = core.createSession({ subject: subjectId, mode: 'random', count: 5 });
    answerSession(core, session, subjectId === 'cpp');
    core.setFavorite(subjectId, session.questions[0].id, true);
  });
  const overview = core.getLearningOverview();
  assert.strictEqual(overview.totalQuestions, 500);
  assert.strictEqual(overview.attemptedCount, 10);
  assert.strictEqual(overview.favoriteCount, 2);
  assert.strictEqual(overview.unmasteredWrongCount, 1);
  assert.strictEqual(core.getFavorites().length, 2);
  assert.strictEqual(core.getWrongQuestions().length, 1);
  assert.strictEqual(overview.modules.length, 5);
}

// 全局收藏支持 5/10/20/全部，跨学科随机取题且不重复，并输出分学科与带学科的章节统计。
{
  const cppFavorites = questions.filter((question) => question.subjectId === 'cpp').slice(0, 6);
  const dsFavorites = questions.filter((question) => question.subjectId === 'ds').slice(0, 6);
  const favoriteQuestions = cppFavorites.flatMap((question, index) => [question, dsFavorites[index]]);
  const unfavoritedQuestion = questions.filter((question) => question.subjectId === 'cpp')[6];
  const disabledFavorite = Object.assign({}, questions.filter((question) => question.subjectId === 'cpp')[7], { status: 'disabled' });
  const { core } = makeCore({
    questions: favoriteQuestions.concat(unfavoritedQuestion, disabledFavorite),
    stateKey: 'global_favorite_sessions',
    random: () => 0
  });
  favoriteQuestions.forEach((question) => core.setFavorite(question.subjectId, question.id, true));
  core.setFavorite(disabledFavorite.subjectId, disabledFavorite.id, true);

  const expectedCounts = new Map([[5, 5], [10, 10], [20, 12]]);
  expectedCounts.forEach((expectedCount, count) => {
    const session = core.createSession({ scope: 'all', mode: 'favorite', count });
    assert.strictEqual(session.scope, 'all');
    assert.strictEqual(session.subjectId, null);
    assert.strictEqual(session.subject, null);
    assert.strictEqual(session.totalCount, expectedCount);
    assert.strictEqual(new Set(session.questions.map((question) => question.id)).size, expectedCount);
    assert(session.questions.every((question) => question.correctOptionIds === undefined && question.explanation === undefined));
    if (count === 5) assert.deepStrictEqual(new Set(session.questions.map((question) => question.subjectId)), new Set(['cpp', 'ds']));
  });

  const allSession = core.createSession({ scope: 'all', mode: 'favorite', count: 'all' });
  assert.strictEqual(allSession.totalCount, favoriteQuestions.length);
  assert.strictEqual(new Set(allSession.questions.map((question) => question.id)).size, favoriteQuestions.length);
  assert(!allSession.questions.some((question) => question.id === unfavoritedQuestion.id));
  assert(!allSession.questions.some((question) => question.id === disabledFavorite.id));
  assert.notDeepStrictEqual(allSession.questions.map((question) => question.id), favoriteQuestions.map((question) => question.id));

  const removedFavorite = allSession.questions[0];
  core.setFavorite(removedFavorite.subjectId, removedFavorite.id, false);
  assert.strictEqual(core.getSession(allSession.id).totalCount, favoriteQuestions.length);

  const result = answerSession(core, allSession, true);
  assert.strictEqual(result.scope, 'all');
  assert.strictEqual(result.subjectId, null);
  assert.strictEqual(result.subject, null);
  assert.deepStrictEqual(result.subjects.map((subject) => subject.subjectId), ['cpp', 'ds']);
  assert.strictEqual(result.subjects.reduce((sum, subject) => sum + subject.totalCount, 0), favoriteQuestions.length);
  assert.strictEqual(result.subjects.reduce((sum, subject) => sum + subject.wrongCount, 0), 1);
  assert(result.chapters.every((chapter) => ['cpp', 'ds'].includes(chapter.subjectId)));
  assert(result.chapters.every((chapter) => chapter.totalCount === chapter.correctCount + chapter.wrongCount));

  assert.throws(() => core.createSession({ scope: 'all', mode: 'random', count: 5 }), (error) => error.code === 'INVALID_GLOBAL_SESSION');
  assert.throws(() => core.createSession({ scope: 'all', mode: 'favorite', subject: 'cpp', count: 5 }), (error) => error.code === 'INVALID_GLOBAL_SESSION');
  assert.throws(() => core.createSession({ scope: 'all', mode: 'favorite', chapterId: 'c-basics', count: 5 }), (error) => error.code === 'INVALID_GLOBAL_SESSION');
  assert.throws(() => core.createSession({ scope: 'all', mode: 'favorite', count: 6 }), (error) => error.code === 'INVALID_COUNT');
  assert.throws(() => core.createSession({ scope: '', mode: 'favorite', count: 5 }), (error) => error.code === 'INVALID_SCOPE');
  assert.throws(() => core.createSession({ mode: 'favorite', count: 5 }), (error) => error.code === 'SUBJECT_REQUIRED');
  assert.throws(() => core.createSession({ subject: 'cpp', mode: 'favorite', chapterId: 'c-basics', count: 5 }), (error) => error.code === 'CHAPTER_NOT_ALLOWED');
  assert.throws(() => core.createSession({ subject: 'cpp', mode: 'favorite', count: 'all' }), (error) => error.code === 'INVALID_COUNT');
}

// 全局收藏为空时给出明确错误，不创建空白会话。
{
  const { core } = makeCore({ stateKey: 'empty_global_favorites' });
  assert.throws(() => core.createSession({ scope: 'all', mode: 'favorite', count: 'all' }), (error) => error.code === 'EMPTY_QUESTION_POOL');
}

// 408：40 道单选，12/12/9/7 配比，无答案泄露，可改草稿，提交幂等并归档错题。
{
  const { core } = makeCore({ stateKey: 'exam_flow' });
  const exam = core.createExam();
  assert.strictEqual(exam.totalCount, 40);
  assert.strictEqual(new Set(exam.questions.map((item) => item.id)).size, 40);
  assert(exam.questions.every((item) => item.type === 'single'));
  assert(exam.questions.every((item) => item.correctOptionIds === undefined && item.explanation === undefined));
  const distribution = exam.questions.reduce((result, question) => {
    result[question.subjectId] = (result[question.subjectId] || 0) + 1;
    return result;
  }, {});
  assert.deepStrictEqual(distribution, EXAM_DISTRIBUTION);
  assert.throws(() => core.createExam(), (error) => error.code === 'ACTIVE_EXAM_EXISTS');

  const first = questionMap[exam.questions[0].id];
  const second = questionMap[exam.questions[1].id];
  core.saveExamDraft(exam.id, { [first.id]: [wrongOption(first)] });
  core.saveExamDraft(exam.id, { [first.id]: first.correctOptionIds, [second.id]: [wrongOption(second)] });
  core.saveExamDraft(exam.id, { [second.id]: [wrongOption(second)] });
  assert.strictEqual(core.getExam(exam.id).answers[first.id], undefined);
  core.saveExamDraft(exam.id, { [first.id]: first.correctOptionIds, [second.id]: [wrongOption(second)] });
  const restored = core.getExam(exam.id);
  assert.deepStrictEqual(restored.answers[first.id], first.correctOptionIds);
  assert.deepStrictEqual(restored.answers[second.id], [wrongOption(second)]);
  const result = core.submitExam(exam.id);
  assert.strictEqual(result.totalCount, 40);
  assert.strictEqual(result.answeredCount, 2);
  assert.strictEqual(result.correctCount, 1);
  assert.strictEqual(result.score, 2);
  assert.strictEqual(result.wrongCount, 39);
  assert.deepStrictEqual(core.submitExam(exam.id), result);
  assert.deepStrictEqual(core.getExamResult(exam.id), result);
  assert.strictEqual(core.getExam(exam.id).status, 'completed');
  assert.strictEqual(core.listExams()[0].score, 2);
  assert.strictEqual(core.getWrongQuestions().length, 39);
  assert.strictEqual(core.getLearningOverview().attemptedCount, 40);

  const snapshotStem = result.reviews[0].question.stem;
  questionMap[result.reviews[0].question.id].stem = '被修改的题干';
  assert.strictEqual(core.getExamResult(exam.id).reviews[0].question.stem, snapshotStem);
}

// 到期恢复会自动交卷，空题计错；重复恢复不会重复计分。
{
  let current = 1800000000000;
  const { core } = makeCore({ stateKey: 'expired_exam', clock: () => current });
  const exam = core.createExam();
  current += EXAM_DURATION_MS + 1;
  const restored = core.getExam(exam.id);
  assert.strictEqual(restored.status, 'completed');
  const result = core.getExamResult(exam.id);
  assert.strictEqual(result.answeredCount, 0);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(core.getLearningOverview().totalAttempts, 40);
  core.getExam(exam.id);
  assert.strictEqual(core.getLearningOverview().totalAttempts, 40);
}

console.log('PracticeCore tests passed: 7 subjects, global favorite sessions, migration, records, recovery and 408 exam state machine.');
