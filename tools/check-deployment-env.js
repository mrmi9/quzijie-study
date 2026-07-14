const fs = require('fs');
const path = require('path');

function parseEnv(source) {
  const values = {};
  String(source).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) return;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  });
  return values;
}

function weakSecret(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized.length < 32
    || new Set(normalized).size < 8
    || /replace-with|change-me|example|password|test-secret|dev-secret/.test(normalized);
}

function validateValues(values, expectedAppId) {
  const errors = [];
  if (values.NODE_ENV !== 'production') errors.push('NODE_ENV 必须为 production');
  if (values.WECHAT_AUTH_MODE !== 'real') errors.push('WECHAT_AUTH_MODE 必须为 real');
  if (!values.WECHAT_APP_ID || values.WECHAT_APP_ID !== expectedAppId) errors.push('WECHAT_APP_ID 必须与 project.config.json 一致');
  if (!values.WECHAT_APP_SECRET || /replace|example|待填写/i.test(values.WECHAT_APP_SECRET)) errors.push('WECHAT_APP_SECRET 缺失或仍为占位值');
  if (weakSecret(values.JWT_ACCESS_SECRET)) errors.push('JWT_ACCESS_SECRET 强度不足或仍为示例值');

  try {
    const database = new URL(values.DATABASE_URL || '');
    if (!['postgresql:', 'postgres:'].includes(database.protocol)) errors.push('DATABASE_URL 必须使用 PostgreSQL');
    if (!database.hostname || !database.username || !database.password || !database.pathname.slice(1)) {
      errors.push('DATABASE_URL 必须包含主机、数据库、用户名和密码');
    }
    if (/quzijie_dev_password|change-me|example|password/i.test(database.password)) {
      errors.push('DATABASE_URL 仍在使用示例或弱密码');
    }
  } catch {
    errors.push('DATABASE_URL 不是有效的 PostgreSQL 连接地址');
  }

  const port = Number(values.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT 必须是有效端口');
  if (values.HOST && values.HOST !== '0.0.0.0') errors.push('容器内 HOST 必须为 0.0.0.0');
  return errors;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const envPath = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(envPath)) {
    console.error('用法: node tools/check-deployment-env.js <环境文件>');
    process.exit(1);
  }

  if (process.platform !== 'win32' && (fs.statSync(envPath).mode & 0o077) !== 0) {
    console.error('部署环境文件权限过宽，请执行 chmod 600');
    process.exit(1);
  }

  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const errors = validateValues(parseEnv(fs.readFileSync(envPath, 'utf8')), project.appid);
  if (errors.length) {
    console.error('生产环境预检未通过：');
    errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
    process.exit(1);
  }
  console.log('Production environment preflight passed without exposing secret values.');
}

if (require.main === module) main();

module.exports = { parseEnv, validateValues, weakSecret };
