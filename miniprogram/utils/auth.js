const env = require('../config/env');

const TOKEN_KEY = 'quzijie_access_token';
let navigatingToLogin = false;

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token || '');
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
}

function isAuthenticated() {
  return Boolean(getToken());
}

function requireLogin(redirect) {
  if (isAuthenticated()) {
    return true;
  }

  const target = redirect || '/pages/index/index';
  getApp().globalData.loginRedirect = target;
  if (navigatingToLogin) return false;
  navigatingToLogin = true;
  wx.navigateTo({
    url: `${env.loginPage}?redirect=${encodeURIComponent(target)}`,
    complete() {
      setTimeout(() => { navigatingToLogin = false; }, 800);
    }
  });
  return false;
}

module.exports = {
  TOKEN_KEY,
  getToken,
  setToken,
  clearToken,
  isAuthenticated,
  requireLogin
};
