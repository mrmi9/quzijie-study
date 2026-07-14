function storageValue(key) {
  try {
    return typeof wx !== 'undefined' ? wx.getStorageSync(key) : '';
  } catch (error) {
    return '';
  }
}

const storedMode = storageValue('quzijie_repository_mode');
const storedApiBaseUrl = storageValue('quzijie_api_base_url');

module.exports = {
  repositoryMode: storedMode === 'api' ? 'api' : 'mock',
  apiBaseUrl: storedApiBaseUrl || 'http://127.0.0.1:3000',
  requestTimeout: 10000,
  mockLatency: 120,
  loginPage: '/pages/login/index'
};
