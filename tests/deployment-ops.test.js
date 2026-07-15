const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
assert.deepEqual(validateBaseUrl('https://api.qushuati.cloud:8443').errors, []);
assert.match(validateBaseUrl('http://api.quzijie.test').errors.join('\n'), /HTTPS/);
assert.deepEqual(validateBaseUrl('http://127.0.0.1:3000', true).errors, []);
assert.match(validateBaseUrl('https://api.quzijie.test/api').errors.join('\n'), /路径/);

const root = path.resolve(__dirname, '..');
const deployScript = fs.readFileSync(path.join(root, 'ops/deploy.sh'), 'utf8');
const rollbackScript = fs.readFileSync(path.join(root, 'ops/rollback.sh'), 'utf8');
const backupScript = fs.readFileSync(path.join(root, 'ops/backup-postgres.sh'), 'utf8');
const restoreScript = fs.readFileSync(path.join(root, 'ops/restore-postgres.sh'), 'utf8');
const backupInstaller = fs.readFileSync(path.join(root, 'ops/install-backup-timer.sh'), 'utf8');
const backupService = fs.readFileSync(path.join(root, 'ops/systemd/quzijie-backup.service'), 'utf8');
const backupTimer = fs.readFileSync(path.join(root, 'ops/systemd/quzijie-backup.timer'), 'utf8');
const httpsInstaller = fs.readFileSync(path.join(root, 'ops/install-https-proxy.sh'), 'utf8');
const nginxSite = fs.readFileSync(path.join(root, 'ops/nginx/quzijie-api.conf'), 'utf8');
const nginxRateLimit = fs.readFileSync(path.join(root, 'ops/nginx/quzijie-rate-limit.conf'), 'utf8');
const certificateReloadHook = fs.readFileSync(path.join(root, 'ops/certbot/quzijie-nginx-reload.sh'), 'utf8');
const acmeBootstrap = fs.readFileSync(path.join(root, 'ops/bootstrap-acme.sh'), 'utf8');
const acmeSite = fs.readFileSync(path.join(root, 'ops/nginx/quzijie-acme-bootstrap.conf'), 'utf8');
assert.match(deployScript, /QUIZIJIE_COMPOSE_OVERRIDE_FILE/);
assert.match(rollbackScript, /QUIZIJIE_COMPOSE_OVERRIDE_FILE/);
assert.match(deployScript, /QUIZIJIE_PREFLIGHT_IMAGE:-node:24-alpine/);
assert.match(deployScript, /QUIZIJIE_PULL_IMAGES:-true/);
assert.match(rollbackScript, /QUIZIJIE_PULL_IMAGES:-true/);
assert.match(backupScript, /DATABASE_ADMIN_URL:-\$\{DATABASE_URL%%\\\?\*\}/);
assert.match(restoreScript, /DATABASE_ADMIN_URL:-\$\{DATABASE_URL%%\\\?\*\}/);
assert.match(backupScript, /pg_dump --dbname="\$database_admin_url"/);
assert.match(restoreScript, /pg_restore --dbname="\$database_admin_url"/);
assert.match(backupInstaller, /systemctl enable --now quzijie-backup.timer/);
assert.match(backupService, /NoNewPrivileges=true/);
assert.match(backupService, /ReadWritePaths=\/opt\/quzijie-study\/backups/);
assert.match(backupTimer, /OnCalendar=\*-\*-\* 03:20:00 Asia\/Shanghai/);
assert.match(httpsInstaller, /nginx -t/);
assert.match(httpsInstaller, /api\.qushuati\.cloud/);
assert.match(httpsInstaller, /sudo test -f .*fullchain\.pem/);
assert.match(httpsInstaller, /sudo test -f .*privkey\.pem/);
assert.match(httpsInstaller, /sites-enabled\/quzijie-acme-bootstrap\.conf/);
assert.match(httpsInstaller, /sites-enabled\/quzijie-api\n/);
assert.match(nginxSite, /listen 8443 ssl http2/);
assert.match(nginxSite, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
assert.match(nginxSite, /https:\/\/\$host:8443\$request_uri/);
assert.match(nginxRateLimit, /rate=20r\/s/);
assert.match(certificateReloadHook, /nginx -t/);
assert.match(certificateReloadHook, /systemctl reload nginx/);
assert.match(acmeBootstrap, /quzijie-acme-bootstrap\.conf/);
assert.match(acmeBootstrap, /nginx -t/);
assert.match(acmeSite, /\.well-known\/acme-challenge/);

console.log('Deployment operation tests passed: environment and public endpoint gates are enforced.');
