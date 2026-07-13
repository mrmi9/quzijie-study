const env = require('../../config/env');
const questions = require('../../modules/cpp/data/questions');
const { CppMockCore } = require('./cppMockCore');

const storage = {
  get(key) {
    return wx.getStorageSync(key);
  },
  set(key, value) {
    wx.setStorageSync(key, value);
  }
};

const core = new CppMockCore({ questions, storage });

function delayed(action) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(action());
      } catch (error) {
        reject(error);
      }
    }, env.mockLatency);
  });
}

module.exports = {
  getOverview: () => delayed(() => core.getOverview()),
  getChapters: () => delayed(() => core.getChapters()),
  createSession: (payload) => delayed(() => core.createSession(payload)),
  getSession: (sessionId) => delayed(() => core.getSession(sessionId)),
  submitAnswer: (sessionId, payload) => delayed(() => core.submitAnswer(sessionId, payload)),
  finishSession: (sessionId) => delayed(() => core.finishSession(sessionId)),
  getResult: (sessionId) => delayed(() => core.getResult(sessionId)),
  getWrongQuestions: (filter) => delayed(() => core.getWrongQuestions(filter)),
  getFavorites: () => delayed(() => core.getFavorites()),
  setFavorite: (questionId, favorite) => delayed(() => core.setFavorite(questionId, favorite)),
  reset: () => delayed(() => core.reset())
};
