const request = require('../../utils/request');

function queryString(params) {
  const parts = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

module.exports = {
  getOverview() {
    return request({ url: '/api/v1/subjects/cpp/overview' });
  },

  getChapters() {
    return request({ url: '/api/v1/subjects/cpp/chapters' });
  },

  createSession(payload) {
    return request({ url: '/api/v1/practice-sessions', method: 'POST', data: payload });
  },

  getSession(sessionId) {
    return request({ url: `/api/v1/practice-sessions/${sessionId}` });
  },

  submitAnswer(sessionId, payload) {
    return request({
      url: `/api/v1/practice-sessions/${sessionId}/answers`,
      method: 'POST',
      data: payload
    });
  },

  finishSession(sessionId) {
    return request({ url: `/api/v1/practice-sessions/${sessionId}/finish`, method: 'POST' });
  },

  getResult(sessionId) {
    return request({ url: `/api/v1/practice-sessions/${sessionId}/result` });
  },

  getWrongQuestions(filter) {
    return request({
      url: `/api/v1/users/me/wrong-questions${queryString({ subject: 'cpp', mastered: filter })}`
    });
  },

  getFavorites() {
    return request({ url: '/api/v1/users/me/favorites?subject=cpp' });
  },

  setFavorite(questionId, favorite) {
    return request({
      url: `/api/v1/users/me/favorites/${questionId}`,
      method: favorite ? 'PUT' : 'DELETE'
    });
  }
};
