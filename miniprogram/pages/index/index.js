Page({
  data: {
    modules: [
      { id: 'cpp', name: 'C/C++', subtitle: '语言基础与面向对象', enabled: true, color: '#2563eb' },
      { id: 'os', name: 'Linux / 操作系统', subtitle: '由团队其他成员建设', enabled: false, color: '#7c3aed' },
      { id: 'ds', name: '数据结构', subtitle: '由团队其他成员建设', enabled: false, color: '#059669' },
      { id: 'network', name: '计网 / STL', subtitle: '由团队其他成员建设', enabled: false, color: '#ea580c' },
      { id: 'postgraduate', name: '考研', subtitle: '由团队其他成员建设', enabled: false, color: '#db2777' }
    ]
  },

  openModule(event) {
    const moduleId = event.currentTarget.dataset.id;
    const item = this.data.modules.find((module) => module.id === moduleId);
    if (!item || !item.enabled) {
      wx.showToast({ title: '模块建设中', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/modules/cpp/pages/home/index' });
  }
});
