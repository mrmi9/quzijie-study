const env = require('../config/env');
const auth = require('./auth');

let redirectingForLogin = false;

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

function request(options) {
  const token = auth.getToken();
  const headers = Object.assign(
    { 'content-type': 'application/json' },
    token ? { Authorization: `Bearer ${token}` } : {},
    options.header || {}
  );

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${env.apiBaseUrl}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: headers,
      timeout: options.timeout || env.requestTimeout,
      success(response) {
        const status = response.statusCode;
        const payload = response.data || {};
        if (status >= 200 && status < 300) {
          resolve(Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload);
          return;
        }

        if (status === 401) {
          handleUnauthorized();
        }
        reject(createError(payload.message, payload.code, status, payload.details));
      },
      fail(error) {
        const isTimeout = String(error.errMsg || '').includes('timeout');
        reject(createError(
          isTimeout ? '请求超时，请稍后重试' : '网络异常，请检查连接后重试',
          isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          0,
          error
        ));
      }
    });
  });
}

module.exports = request;
module.exports.createError = createError;
