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
assert.deepStrictEqual(registry.subjectIds.sort(), ['co', 'cpp', 'ds', 'linux', 'network', 'os', 'stl']);
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
  assert.strictEqual(storage.data.new_key.version, 2);
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

console.log('PracticeCore tests passed: 7 subjects, migration, records, recovery and 408 exam state machine.');
