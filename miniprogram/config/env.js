function storageValue(key) {
  try {
    return typeof wx !== 'undefined' ? wx.getStorageSync(key) : '';
  } catch (error) {
    return '';
  }
}

function accountEnvVersion() {
  try {
    const info = typeof wx !== 'undefined' && wx.getAccountInfoSync
      ? wx.getAccountInfoSync()
      : null;
    return info && info.miniProgram && info.miniProgram.envVersion
      ? info.miniProgram.envVersion
      : 'develop';
  } catch (error) {
    return 'develop';
  }
}

const release = require('./release');
const storedMode = storageValue('quzijie_repository_mode');
const storedApiBaseUrl = storageValue('quzijie_api_base_url');
const storedTransport = storageValue('quzijie_api_transport');
const envVersion = accountEnvVersion();
const isPublishedBuild = envVersion === 'trial' || envVersion === 'release';

module.exports = {
  envVersion,
  isPublishedBuild,
  repositoryMode: isPublishedBuild ? 'api' : (storedMode === 'api' ? 'api' : 'mock'),
  transport: isPublishedBuild ? release.transport : (storedTransport === 'cloud' ? 'cloud' : 'http'),
  cloudEnvId: release.cloudEnvId,
  cloudService: release.cloudService,
  apiBaseUrl: isPublishedBuild ? release.apiBaseUrl : (storedApiBaseUrl || 'http://127.0.0.1:3000'),
  operatorName: release.operatorName,
  privacyContact: release.privacyContact,
  requestTimeout: 10000,
  mockLatency: 120,
  loginPage: '/pages/login/index'
};
