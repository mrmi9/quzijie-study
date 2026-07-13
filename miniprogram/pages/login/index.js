const auth = require('../../utils/auth');
const env = require('../../config/env');

Page({
  data: {
    loading: false,
    isMock: env.repositoryMode === 'mock'
  },

  onLoad(options) {
    this.redirect = options.redirect
      ? decodeURIComponent(options.redirect)
      : getApp().globalData.loginRedirect || '/modules/cpp/pages/home/index';
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
      success: () => {
        this.setData({ loading: false });
        wx.showModal({
          title: '等待公共登录接口',
          content: '已取得微信登录凭证，请由团队公共登录层换取访问令牌并调用 auth.setToken。',
          showCancel: false
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
