const auth = require('../../utils/auth');
const repository = require('../../services/practiceRepository');

const PERIODS = [
  { id: 'daily', label: '日榜' },
  { id: 'weekly', label: '周榜' },
  { id: 'all', label: '总榜' }
];

function podiumOrder(items) {
  if (items.length < 3) return items;
  return [items[1], items[0], items[2]];
}

Page({
  data: {
    periods: PERIODS,
    period: 'daily',
    loading: true,
    error: '',
    podium: [],
    rankings: [],
    currentUser: null
  },

  onLoad() {
    if (!auth.requireLogin('/pages/leaderboard/index')) return;
    this.loadLeaderboard();
  },

  onPullDownRefresh() {
    this.loadLeaderboard().finally(() => wx.stopPullDownRefresh());
  },

  selectPeriod(event) {
    const period = event.currentTarget.dataset.period;
    if (!period || period === this.data.period) return;
    this.setData({ period });
    this.loadLeaderboard();
  },

  loadLeaderboard() {
    this.setData({ loading: true, error: '' });
    return repository.getLeaderboard(this.data.period, 100)
      .then((board) => {
        const items = board.items || [];
        const top = board.podium || items.slice(0, 3);
        this.setData({
          loading: false,
          podium: podiumOrder(top),
          rankings: board.rankings || items.slice(3),
          currentUser: board.currentUser
        });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || '排行榜加载失败' }));
  }
});
