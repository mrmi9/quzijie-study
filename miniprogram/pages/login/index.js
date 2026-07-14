const auth = require('../../utils/auth');
const env = require('../../config/env');
const authApi = require('../../services/api/authApiRepository');

Page({
  data: {
    loading: false,
    isMock: env.repositoryMode === 'mock'
  },

  onLoad(options) {
    this.redirect = options.redirect
      ? decodeURIComponent(options.redirect)
      : getApp().globalData.loginRedirect || '/pages/index/index';
  },

  login() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    if (env.repositoryMode === 'mock') {
      auth.setToken('mock-user-token');
      this.returnToModule();
      return;
    }

    wx.login({
      success: (loginResult) => {
        if (!loginResult.code) {
          this.setData({ loading: false });
          wx.showToast({ title: '未取得微信登录凭证', icon: 'none' });
          return;
        }
        authApi.loginWithWechatCode(loginResult.code)
          .then((result) => {
            auth.setTokens(result.accessToken, result.refreshToken);
            this.returnToModule();
          })
          .catch((error) => {
            this.setData({ loading: false });
            wx.showToast({ title: error.message || '微信登录失败', icon: 'none' });
          });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  },

  returnToModule() {
    getApp().globalData.loginRedirect = '';
    wx.reLaunch({ url: this.redirect });
  }
});
