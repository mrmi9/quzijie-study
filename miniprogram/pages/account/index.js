const auth = require('../../utils/auth');
const env = require('../../config/env');
const authApi = require('../../services/api/authApiRepository');
const repository = require('../../services/practiceRepository');
const { buildMinePresentation } = require('../../utils/minePresentation');

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    isMock: env.repositoryMode === 'mock',
    accountLoading: true,
    overviewLoading: true,
    gamificationLoading: true,
    savingNickname: false,
    deleting: false,
    accountError: '',
    overviewError: '',
    gamificationError: '',
    actionError: '',
    createdAt: '',
    gamification: null,
    nicknameInput: '',
    canRename: true,
    stats: buildMinePresentation().stats,
    shortcuts: buildMinePresentation().shortcuts
  },

  onShow() {
    if (!auth.requireLogin('/pages/account/index')) return;
    this.refreshPage();
  },

  onPullDownRefresh() {
    if (!auth.isAuthenticated()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.refreshPage().finally(() => wx.stopPullDownRefresh());
  },

  refreshPage() {
    return Promise.all([this.loadAccount(), this.loadOverview(), this.loadGamification()]);
  },

  loadAccount() {
    this.setData({ accountLoading: true, accountError: '' });
    if (this.data.isMock) {
      this.setData({ accountLoading: false, createdAt: '本地演示账户' });
      return Promise.resolve();
    }
    return authApi.getMe()
      .then((user) => this.setData({ accountLoading: false, createdAt: displayDate(user.createdAt) }))
      .catch((error) => this.setData({ accountLoading: false, accountError: error.message || '账户信息加载失败' }));
  },

  loadOverview() {
    this.setData({ overviewLoading: true, overviewError: '' });
    return repository.getLearningOverview()
      .then((overview) => {
        const presentation = buildMinePresentation(overview);
        this.setData({ overviewLoading: false, stats: presentation.stats, shortcuts: presentation.shortcuts });
      })
      .catch((error) => this.setData({ overviewLoading: false, overviewError: error.message || '学习概览加载失败' }));
  },

  loadGamification() {
    this.setData({ gamificationLoading: true, gamificationError: '' });
    return repository.getGamificationMe().then((gamification) => {
      const nextRenameAt = gamification.nextRenameAt ? new Date(gamification.nextRenameAt) : null;
      const canRename = !nextRenameAt || nextRenameAt.getTime() <= Date.now();
      this.setData({
        gamificationLoading: false,
        gamification,
        nicknameInput: gamification.nicknameUpdatedAt ? gamification.identity.displayName : '',
        canRename
      });
    }).catch((error) => this.setData({ gamificationLoading: false, gamificationError: error.message || '积分档案加载失败' }));
  },

  onNicknameInput(event) {
    this.setData({ nicknameInput: event.detail.value });
  },

  saveNickname() {
    const displayName = this.data.nicknameInput.trim();
    if (!displayName || !this.data.canRename || this.data.savingNickname) return;
    this.setData({ savingNickname: true, gamificationError: '' });
    repository.updateGamificationProfile(displayName).then(() => {
      wx.showToast({ title: '昵称已更新', icon: 'success' });
      return this.loadGamification();
    }).catch((error) => this.setData({ gamificationError: error.message || '昵称更新失败' }))
      .finally(() => this.setData({ savingNickname: false }));
  },

  openLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/index' });
  },

  openAchievements() {
    wx.navigateTo({ url: '/pages/achievements/index' });
  },

  openShortcut(event) {
    const item = this.data.shortcuts.find((shortcut) => shortcut.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.navigation === 'tab') wx.switchTab({ url: item.url });
    else wx.navigateTo({ url: item.url });
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
    const scope = this.data.isMock ? '本机演示进度' : '账户、练习记录、错题、收藏、考试、积分和成就历史';
    wx.showModal({
      title: '永久删除账户？',
      content: `将永久删除${scope}，且无法恢复。`,
      confirmText: '确认删除',
      confirmColor: '#b42318',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ deleting: true, actionError: '' });
        const request = this.data.isMock ? Promise.resolve() : authApi.deleteMe();
        request.then(() => {
          auth.clearUserData();
          wx.showToast({ title: '账户数据已删除', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/login/index' }), 500);
        }).catch((error) => {
          this.setData({ deleting: false, actionError: error.message || '删除失败，请稍后重试' });
        });
      }
    });
  }
});
