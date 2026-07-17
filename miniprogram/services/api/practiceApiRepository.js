const request = require('../../utils/request');

function queryString(params) {
  const parts = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

module.exports = {
  getCatalog: () => request({ url: '/api/v1/catalog' }),
  getLearningOverview: () => request({ url: '/api/v1/learning/overview' }),
  getSubjectOverview: (subjectId) => request({ url: `/api/v1/subjects/${subjectId}/overview` }),
  getChapters: (subjectId) => request({ url: `/api/v1/subjects/${subjectId}/chapters` }),
  createSession: (payload) => request({ url: '/api/v1/practice-sessions', method: 'POST', data: payload }),
  getSession: (sessionId) => request({ url: `/api/v1/practice-sessions/${sessionId}` }),
  submitAnswer: (sessionId, payload) => request({ url: `/api/v1/practice-sessions/${sessionId}/answers`, method: 'POST', data: payload }),
  assessShortAnswer: (sessionId, questionId, assessment) => request({ url: `/api/v1/practice-sessions/${sessionId}/answers/${questionId}/self-assessment`, method: 'POST', data: { assessment } }),
  finishSession: (sessionId) => request({ url: `/api/v1/practice-sessions/${sessionId}/finish`, method: 'POST' }),
  getResult: (sessionId) => request({ url: `/api/v1/practice-sessions/${sessionId}/result` }),
  getWrongQuestions: (subjectId, mastered) => request({ url: `/api/v1/records/wrong${queryString({ subjectId, mastered })}` }),
  getFavorites: (subjectId) => request({ url: `/api/v1/records/favorites${queryString({ subjectId })}` }),
  setFavorite: (subjectId, questionId, favorite) => request({ url: `/api/v1/records/favorites/${subjectId}/${questionId}`, method: favorite ? 'PUT' : 'DELETE' }),
  createExam: () => request({ url: '/api/v1/exams', method: 'POST', data: { type: 'postgraduate-408-objective' } }),
  getExam: (examId) => request({ url: `/api/v1/exams/${examId}` }),
  saveExamDraft: (examId, answers) => request({ url: `/api/v1/exams/${examId}/draft`, method: 'PUT', data: { answers } }),
  submitExam: (examId) => request({ url: `/api/v1/exams/${examId}/submit`, method: 'POST' }),
  getExamResult: (examId) => request({ url: `/api/v1/exams/${examId}/result` }),
  listExams: () => request({ url: '/api/v1/exams?type=postgraduate-408-objective' }),
  getGamificationMe: () => request({ url: '/api/v1/gamification/me' }),
  updateGamificationProfile: (displayName) => request({ url: '/api/v1/gamification/profile', method: 'PUT', data: { displayName } }),
  getLeaderboard: (period, limit) => request({ url: `/api/v1/gamification/leaderboard${queryString({ period, limit })}` }),
  getAchievements: () => request({ url: '/api/v1/gamification/achievements' }),
  equipAchievementTitle: (achievementKey) => request({ url: '/api/v1/gamification/equipped-title', method: 'PUT', data: { achievementKey } })
};
