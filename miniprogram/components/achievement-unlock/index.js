const { publicAchievement } = require('../../utils/gamificationCatalog');

Component({
  data: {
    visible: false,
    queue: [],
    current: null,
    remaining: 0
  },

  methods: {
    show(achievementKeys) {
      const queue = (achievementKeys || []).map(publicAchievement).filter(Boolean);
      if (!queue.length) return;
      this.setData({ visible: true, queue, current: queue[0], remaining: queue.length - 1 });
    },

    next() {
      const queue = this.data.queue.slice(1);
      if (!queue.length) {
        this.close();
        return;
      }
      this.setData({ queue, current: queue[0], remaining: queue.length - 1 });
    },

    close() {
      this.setData({ visible: false, queue: [], current: null, remaining: 0 });
      this.triggerEvent('close');
    },

    stopBubble() {}
  }
});
