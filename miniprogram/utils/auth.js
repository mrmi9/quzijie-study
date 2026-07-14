const env = require('../config/env');

const TOKEN_KEY = 'quzijie_access_token';
const REFRESH_TOKEN_KEY = 'quzijie_refresh_token';
let navigatingToLogin = false;

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setToken(token) {
  wx.setStorageSync(TOKEN_KEY, token || '');
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
}

function getRefreshToken() {
  return wx.getStorageSync(REFRESH_TOKEN_KEY) || '';
}

function setTokens(accessToken, refreshToken) {
  wx.setStorageSync(TOKEN_KEY, accessToken || '');
  wx.setStorageSync(REFRESH_TOKEN_KEY, refreshToken || '');
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
}

function removeKeysByPrefix(prefixes) {
  const storage = wx.getStorageInfoSync();
  (storage.keys || []).forEach((key) => {
    if (prefixes.some((prefix) => key.startsWith(prefix))) wx.removeStorageSync(key);
  });
}

function clearLocalDrafts() {
  removeKeysByPrefix(['practice_draft_', 'exam_draft_']);
}

function clearUserData() {
  const fixedKeys = new Set([
    TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    'practice_mock_state_v2',
    'cpp_mock_state_v1'
  ]);
  const storage = wx.getStorageInfoSync();
  (storage.keys || []).forEach((key) => {
    if (fixedKeys.has(key)) {
      wx.removeStorageSync(key);
    }
  });
  clearLocalDrafts();
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
  REFRESH_TOKEN_KEY,
  getToken,
  getRefreshToken,
  setToken,
  setTokens,
  clearToken,
  clearLocalDrafts,
  clearUserData,
  isAuthenticated,
  requireLogin
};
