const env = require('../config/env');
const auth = require('../utils/auth');
const apiRepository = require('./api/cppApiRepository');
const mockRepository = require('./mock/cppMockRepository');

const repository = env.repositoryMode === 'api' ? apiRepository : mockRepository;

function currentPageUrl() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page || !page.route) return '/modules/cpp/pages/home/index';
  const query = Object.keys(page.options || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(page.options[key])}`)
    .join('&');
  return `/${page.route}${query ? `?${query}` : ''}`;
}

function unauthenticatedError() {
  const error = new Error('请登录后使用刷题模块');
  error.code = 'UNAUTHORIZED';
  error.statusCode = 401;
  return error;
}

const guardedRepository = {};
Object.keys(repository).forEach((method) => {
  guardedRepository[method] = (...args) => {
    if (!auth.isAuthenticated()) {
      auth.requireLogin(currentPageUrl());
      return Promise.reject(unauthenticatedError());
    }
    return repository[method](...args);
  };
});

module.exports = guardedRepository;
