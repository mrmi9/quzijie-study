const assert = require('assert');
const { parseEnv, validateValues } = require('../tools/check-deployment-env');
const { validateBaseUrl } = require('../tools/verify-deployment');

const appId = 'wx69380e593ebd5ac7';
const valid = parseEnv(`
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://quzijie:Correct-Horse-74_Battery@db.internal:5432/quzijie?schema=public
JWT_ACCESS_SECRET=8zNQ!2dpLk7Vx4wM9aBc6eRf3tYu5iOp
WECHAT_AUTH_MODE=real
WECHAT_APP_ID=${appId}
WECHAT_APP_SECRET=local-secret-value-not-printed
`);
assert.deepEqual(validateValues(valid, appId), []);

const invalid = Object.assign({}, valid, {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://quzijie:password@localhost:5432/quzijie',
  JWT_ACCESS_SECRET: 'change-me',
  WECHAT_AUTH_MODE: 'stub'
});
const errors = validateValues(invalid, appId).join('\n');
assert.match(errors, /NODE_ENV/);
assert.match(errors, /WECHAT_AUTH_MODE/);
assert.match(errors, /JWT_ACCESS_SECRET/);
assert.match(errors, /DATABASE_URL/);

assert.deepEqual(validateBaseUrl('https://api.quzijie.test').errors, []);
assert.match(validateBaseUrl('http://api.quzijie.test').errors.join('\n'), /HTTPS/);
assert.deepEqual(validateBaseUrl('http://127.0.0.1:3000', true).errors, []);
assert.match(validateBaseUrl('https://api.quzijie.test/api').errors.join('\n'), /路径/);

console.log('Deployment operation tests passed: environment and public endpoint gates are enforced.');
