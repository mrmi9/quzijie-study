const env = require('../config/env');
const auth = require('../utils/auth');
const apiRepository = require('./api/practiceApiRepository');
const mockRepository = require('./mock/practiceMockRepository');

const repository = env.repositoryMode === 'api' ? apiRepository : mockRepository;

function currentPageUrl() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page || !page.route) return '/pages/index/index';
  const query = Object.keys(page.options || {}).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(page.options[key])}`).join('&');
  return `/${page.route}${query ? `?${query}` : ''}`;
}

function unauthorizedError() {
  const error = new Error('请登录后使用刷题模块');
  error.code = 'UNAUTHORIZED';
  error.statusCode = 401;
  return error;
}

const guarded = {};
Object.keys(repository).forEach((method) => {
  guarded[method] = (...args) => {
    if (!auth.isAuthenticated()) {
      auth.requireLogin(currentPageUrl());
      return Promise.reject(unauthorizedError());
    }
    return repository[method](...args);
  };
});

module.exports = guarded;
