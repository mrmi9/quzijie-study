const assert = require('assert');
const path = require('path');

const envPath = path.resolve(__dirname, '..', 'miniprogram', 'config', 'env.js');

function loadEnv(envVersion, storage = {}) {
  global.wx = {
    getStorageSync(key) { return storage[key] || ''; },
    getAccountInfoSync() { return { miniProgram: { envVersion } }; }
  };
  delete require.cache[require.resolve(envPath)];
  return require(envPath);
}

const developDefault = loadEnv('develop');
assert.equal(developDefault.repositoryMode, 'mock');
assert.equal(developDefault.apiBaseUrl, 'http://127.0.0.1:3000');

const developApi = loadEnv('develop', {
  quzijie_repository_mode: 'api',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(developApi.repositoryMode, 'api');
assert.equal(developApi.apiBaseUrl, 'http://127.0.0.1:4000');

const trial = loadEnv('trial', {
  quzijie_repository_mode: 'mock',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(trial.repositoryMode, 'api');
assert.equal(trial.apiBaseUrl, 'https://api.qushuati.cloud:8443');

const release = loadEnv('release', {
  quzijie_repository_mode: 'mock',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(release.repositoryMode, 'api');
assert.equal(release.apiBaseUrl, 'https://api.qushuati.cloud:8443');

delete global.wx;
delete require.cache[require.resolve(envPath)];
console.log('Release configuration tests passed: published builds force committed API configuration.');
