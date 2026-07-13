const env = require('../../config/env');
const registry = require('../../config/subjectRegistry');
const questions = require('../../data/questions');
const { PracticeCore } = require('./practiceCore');

const storage = {
  get(key) { return wx.getStorageSync(key); },
  set(key, value) { wx.setStorageSync(key, value); }
};

const core = new PracticeCore({ questions, storage, registry });

function delayed(action) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(action()); } catch (error) { reject(error); }
    }, env.mockLatency);
  });
}

module.exports = {
  getLearningOverview: () => delayed(() => core.getLearningOverview()),
  getSubjectOverview: (subjectId) => delayed(() => core.getSubjectOverview(subjectId)),
  getChapters: (subjectId) => delayed(() => core.getChapters(subjectId)),
  createSession: (payload) => delayed(() => core.createSession(payload)),
  getSession: (sessionId) => delayed(() => core.getSession(sessionId)),
  submitAnswer: (sessionId, payload) => delayed(() => core.submitAnswer(sessionId, payload)),
  finishSession: (sessionId) => delayed(() => core.finishSession(sessionId)),
  getResult: (sessionId) => delayed(() => core.getResult(sessionId)),
  getWrongQuestions: (subjectId, mastered) => delayed(() => core.getWrongQuestions(subjectId, mastered)),
  getFavorites: (subjectId) => delayed(() => core.getFavorites(subjectId)),
  setFavorite: (subjectId, questionId, favorite) => delayed(() => core.setFavorite(subjectId, questionId, favorite)),
  createExam: () => delayed(() => core.createExam()),
  getExam: (examId) => delayed(() => core.getExam(examId)),
  saveExamDraft: (examId, answers) => delayed(() => core.saveExamDraft(examId, answers)),
  submitExam: (examId) => delayed(() => core.submitExam(examId)),
  getExamResult: (examId) => delayed(() => core.getExamResult(examId)),
  listExams: () => delayed(() => core.listExams()),
  reset: () => delayed(() => core.reset())
};
