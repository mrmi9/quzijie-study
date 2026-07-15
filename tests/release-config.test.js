const assert = require('assert');
const path = require('path');
const { validateReleaseTransport } = require('../tools/check-release');

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
assert.equal(developDefault.transport, 'http');
assert.equal(developDefault.apiBaseUrl, 'http://127.0.0.1:3000');

const developApi = loadEnv('develop', {
  quzijie_repository_mode: 'api',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(developApi.repositoryMode, 'api');
assert.equal(developApi.transport, 'http');
assert.equal(developApi.apiBaseUrl, 'http://127.0.0.1:4000');

const trial = loadEnv('trial', {
  quzijie_repository_mode: 'mock',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(trial.repositoryMode, 'api');
assert.equal(trial.transport, 'cloud');
assert.equal(trial.cloudEnvId, 'prod-d4gnnimmh1d0677fc');
assert.equal(trial.cloudService, 'express-tfts');
assert.equal(trial.apiBaseUrl, '');

const release = loadEnv('release', {
  quzijie_repository_mode: 'mock',
  quzijie_api_base_url: 'http://127.0.0.1:4000'
});
assert.equal(release.repositoryMode, 'api');
assert.equal(release.transport, 'cloud');
assert.equal(release.cloudEnvId, 'prod-d4gnnimmh1d0677fc');
assert.equal(release.cloudService, 'express-tfts');
assert.equal(release.apiBaseUrl, '');

assert.deepEqual(validateReleaseTransport({
  transport: 'cloud',
  cloudEnvId: 'prod-d4gnnimmh1d0677fc',
  cloudService: 'express-tfts',
  apiBaseUrl: ''
}), []);
assert.match(validateReleaseTransport({
  transport: 'cloud',
  cloudEnvId: '',
  cloudService: 'Express Service'
}).join('\n'), /cloudEnvId/);
assert.match(validateReleaseTransport({
  transport: 'cloud',
  cloudEnvId: '',
  cloudService: 'Express Service'
}).join('\n'), /cloudService/);
assert.match(validateReleaseTransport({
  transport: 'cloud',
  cloudEnvId: 'https:evil',
  cloudService: 'express-tfts'
}).join('\n'), /cloudEnvId/);
assert.match(validateReleaseTransport({
  transport: 'cloud',
  cloudEnvId: 'prod-valid',
  cloudService: 'express-tfts-'
}).join('\n'), /cloudService/);
assert.deepEqual(validateReleaseTransport({
  transport: 'http',
  apiBaseUrl: 'https://api.quzijie.example'
}), []);
assert.match(validateReleaseTransport({
  transport: 'http',
  apiBaseUrl: 'http://127.0.0.1:3000'
}).join('\n'), /HTTPS|localhost|IP/);
assert.match(validateReleaseTransport({ transport: 'unknown' }).join('\n'), /transport/);

delete global.wx;
delete require.cache[require.resolve(envPath)];
console.log('Release configuration tests passed: published builds force committed API configuration.');
