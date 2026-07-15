const env = require('../config/env');
const auth = require('./auth');

let redirectingForLogin = false;
let refreshingToken = null;

function createError(message, code, statusCode, details) {
  const error = new Error(message || '请求失败');
  error.code = code || 'REQUEST_FAILED';
  error.statusCode = statusCode || 0;
  error.details = details || null;
  return error;
}

function currentPageUrl() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page || !page.route) return '/pages/index/index';
  const query = Object.keys(page.options || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(page.options[key])}`)
    .join('&');
  return `/${page.route}${query ? `?${query}` : ''}`;
}

function handleUnauthorized() {
  auth.clearToken();
  if (redirectingForLogin) return;
  redirectingForLogin = true;
  auth.requireLogin(currentPageUrl());
  setTimeout(() => { redirectingForLogin = false; }, 1200);
}

function refreshAccessToken() {
  if (refreshingToken) return refreshingToken;
  if (!env.apiBaseUrl) {
    return Promise.reject(createError('发布环境尚未配置 API 地址', 'API_BASE_URL_MISSING', 0));
  }
  const refreshToken = auth.getRefreshToken();
  if (!refreshToken) return Promise.reject(createError('登录状态已失效，请重新登录', 'UNAUTHORIZED', 401));
  refreshingToken = new Promise((resolve, reject) => {
    wx.request({
      url: `${env.apiBaseUrl}/api/v1/auth/refresh`,
      method: 'POST',
      data: { refreshToken },
      header: { 'content-type': 'application/json' },
      timeout: env.requestTimeout,
      success(response) {
        const payload = response.data || {};
        const data = Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
        if (response.statusCode >= 200 && response.statusCode < 300 && data.accessToken && data.refreshToken) {
          auth.setTokens(data.accessToken, data.refreshToken);
          resolve(data.accessToken);
          return;
        }
        reject(createError(payload.message || '登录状态已失效，请重新登录', payload.code || 'UNAUTHORIZED', response.statusCode));
      },
      fail(error) {
        reject(createError('刷新登录状态失败，请检查网络后重试', 'NETWORK_ERROR', 0, error));
      }
    });
  }).finally(() => { refreshingToken = null; });
  return refreshingToken;
}

function send(options) {
  if (env.transport === 'cloud') {
    return wx.cloud.callContainer(Object.assign({}, options, {
      config: { env: env.cloudEnvId },
      path: options.url,
      header: Object.assign({}, options.header, { 'X-WX-SERVICE': env.cloudService })
    }));
  }
  return new Promise((resolve, reject) => {
    wx.request(Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

function request(options) {
  if (env.repositoryMode === 'api' && env.transport !== 'cloud' && !env.apiBaseUrl) {
    return Promise.reject(createError('发布环境尚未配置 API 地址', 'API_BASE_URL_MISSING', 0));
  }
  const token = env.transport === 'cloud' ? '' : auth.getToken();
  const method = (options.method || 'GET').toUpperCase();
  const bodyMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const data = options.data === undefined && bodyMethods.includes(method) ? {} : options.data;
  const headers = Object.assign(
    { 'content-type': 'application/json' },
    token ? { Authorization: `Bearer ${token}` } : {},
    options.header || {}
  );

  return send({
      url: env.transport === 'cloud' ? options.url : `${env.apiBaseUrl}${options.url}`,
      method,
      data,
      header: headers,
      timeout: options.timeout || env.requestTimeout
    }).then((response) => {
        const status = response.statusCode;
        const payload = response.data || {};
        if (status >= 200 && status < 300) {
          return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
        }

        if (env.transport !== 'cloud' && status === 401 && !options.skipAuthRefresh
          && !options.retriedAfterRefresh && auth.getRefreshToken()) {
          return refreshAccessToken()
            .then(() => request(Object.assign({}, options, { retriedAfterRefresh: true })))
            .catch((error) => {
              if (!options.skipAuthRedirect && error.statusCode === 401) handleUnauthorized();
              throw error;
            });
        }
        if (status === 401 && !options.skipAuthRedirect) {
          handleUnauthorized();
        }
        throw createError(payload.message, payload.code, status, payload.details);
      })
      .catch((error) => {
        if (error && error.code && error.statusCode !== undefined) throw error;
        const isTimeout = String(error.errMsg || '').includes('timeout');
        throw createError(
          isTimeout ? '请求超时，请稍后重试' : '网络异常，请检查连接后重试',
          isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          0,
          error
        );
      });
}

module.exports = request;
module.exports.createError = createError;
