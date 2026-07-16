const auth = require('../../utils/auth');
const repository = require('../../services/practiceRepository');
const { publicAchievement } = require('../../utils/gamificationCatalog');

Page({
  data: { loading: true, error: '', unlockedCount: 0, totalCount: 12, items: [], equipping: '' },

  onLoad() {
    if (!auth.requireLogin('/pages/achievements/index')) return;
    this.loadAchievements();
  },

  onPullDownRefresh() {
    this.loadAchievements().finally(() => wx.stopPullDownRefresh());
  },

  loadAchievements() {
    this.setData({ loading: true, error: '' });
    return repository.getAchievements().then((result) => {
      const items = (result.items || []).map((item) => Object.assign({}, publicAchievement(item.key), item));
      this.setData({ loading: false, items, unlockedCount: result.unlockedCount, totalCount: result.totalCount });
    }).catch((error) => this.setData({ loading: false, error: error.message || '成就加载失败' }));
  },

  toggleEquip(event) {
    const key = event.currentTarget.dataset.key;
    const item = this.data.items.find((achievement) => achievement.key === key);
    if (!item || !item.unlocked || this.data.equipping) return;
    const nextKey = item.equipped ? null : key;
    this.setData({ equipping: key });
    repository.equipAchievementTitle(nextKey).then(() => {
      const items = this.data.items.map((achievement) => Object.assign({}, achievement, { equipped: nextKey === achievement.key }));
      this.setData({ items, equipping: '' });
      wx.showToast({ title: nextKey ? '称号已佩戴' : '已取消佩戴', icon: 'success' });
    }).catch((error) => {
      this.setData({ equipping: '' });
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    });
  }
});
