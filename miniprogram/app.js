App({
  onLaunch() {
    const release = require('./config/release');
    if (release.transport === 'cloud' && wx.cloud) {
      wx.cloud.init({ env: release.cloudEnvId });
    }
  },
  globalData: {
    loginRedirect: ''
  }
});
