const repository = require('./practiceRepository');
const registry = require('../config/subjectRegistry');

function subjectRepository(subjectId) {
  if (!registry.getSubject(subjectId)) throw new Error(`未知学科：${subjectId}`);
  return {
    getOverview: () => repository.getSubjectOverview(subjectId),
    getChapters: () => repository.getChapters(subjectId),
    createSession: (payload) => repository.createSession(Object.assign({}, payload, { subject: subjectId })),
    getWrongQuestions: (mastered) => repository.getWrongQuestions(subjectId, mastered),
    getFavorites: () => repository.getFavorites(subjectId),
    setFavorite: (questionId, favorite) => repository.setFavorite(subjectId, questionId, favorite)
  };
}

module.exports = subjectRepository;
