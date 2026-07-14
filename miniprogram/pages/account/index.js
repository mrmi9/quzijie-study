const auth = require('../../utils/auth');
const env = require('../../config/env');
const authApi = require('../../services/api/authApiRepository');

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    isMock: env.repositoryMode === 'mock',
    loading: true,
    deleting: false,
    error: '',
    createdAt: ''
  },

  onShow() {
    if (!auth.requireLogin('/pages/account/index')) return;
    if (this.data.isMock) {
      this.setData({ loading: false, createdAt: '本地演示账户' });
      return;
    }
    this.loadAccount();
  },

  loadAccount() {
    this.setData({ loading: true, error: '' });
    return authApi.getMe()
      .then((user) => this.setData({ loading: false, createdAt: displayDate(user.createdAt) }))
      .catch((error) => this.setData({ loading: false, error: error.message || '账户信息加载失败' }));
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后可再次使用微信登录，服务端学习记录不会删除。',
      success: (result) => {
        if (!result.confirm) return;
        const refreshToken = auth.getRefreshToken();
        const request = !this.data.isMock && refreshToken
          ? authApi.logout(refreshToken).catch(() => null)
          : Promise.resolve();
        request.finally(() => {
          auth.clearToken();
          auth.clearLocalDrafts();
          wx.reLaunch({ url: '/pages/login/index' });
        });
      }
    });
  },

  deleteAccount() {
    if (this.data.deleting) return;
    const scope = this.data.isMock ? '本机演示进度' : '账户、练习记录、错题、收藏和考试历史';
    wx.showModal({
      title: '永久删除账户？',
      content: `将永久删除${scope}，且无法恢复。`,
      confirmText: '确认删除',
      confirmColor: '#b42318',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ deleting: true, error: '' });
        const request = this.data.isMock ? Promise.resolve() : authApi.deleteMe();
        request.then(() => {
          auth.clearUserData();
          wx.showToast({ title: '账户数据已删除', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/login/index' }), 500);
        }).catch((error) => {
          this.setData({ deleting: false, error: error.message || '删除失败，请稍后重试' });
        });
      }
    });
  }
});
