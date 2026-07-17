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
  if (values.WECHAT_AUTH_MODE !== 'cloud') errors.push('WECHAT_AUTH_MODE 必须为 cloud');

  if (values.DATABASE_URL) {
    try {
      const database = new URL(values.DATABASE_URL);
      if (database.protocol !== 'mysql:') errors.push('DATABASE_URL 必须使用 MySQL');
      if (!database.hostname || !database.username || !database.password || !database.pathname.slice(1)) {
        errors.push('DATABASE_URL 必须包含主机、数据库、用户名和密码');
      }
      if (/quzijie_dev_password|change-me|example|password/i.test(database.password)) {
        errors.push('DATABASE_URL 仍在使用示例或弱密码');
      }
    } catch {
      errors.push('DATABASE_URL 不是有效的 MySQL 连接地址');
    }
  } else {
    if (!/^[^:]+:\d+$/.test(values.MYSQL_ADDRESS || '')) errors.push('MYSQL_ADDRESS 必须使用 host:port 格式');
    if (!values.MYSQL_USERNAME) errors.push('MYSQL_USERNAME 缺失');
    if (!values.MYSQL_PASSWORD || /change-me|example|password/i.test(values.MYSQL_PASSWORD)) {
      errors.push('MYSQL_PASSWORD 缺失或仍为示例值');
    }
    if (!/^[A-Za-z0-9_]+$/.test(values.MYSQL_DATABASE || '')) errors.push('MYSQL_DATABASE 无效');
  }

  const port = Number(values.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT 必须是有效端口');
  if (values.HOST && values.HOST !== '0.0.0.0') errors.push('容器内 HOST 必须为 0.0.0.0');

  if (values.ADMIN_ENABLED && !['true', 'false'].includes(values.ADMIN_ENABLED)) {
    errors.push('ADMIN_ENABLED 只能为 true 或 false');
  }
  if (values.ADMIN_ENABLED === 'true') {
    if (weakSecret(values.ADMIN_ENCRYPTION_KEY)) {
      errors.push('ADMIN_ENCRYPTION_KEY 必须是至少 32 位的高强度稳定密钥');
    }
    const reviewPolicy = values.ADMIN_REVIEW_POLICY || 'two-person';
    if (!['two-person', 'single-owner'].includes(reviewPolicy)) {
      errors.push('ADMIN_REVIEW_POLICY 只能为 two-person 或 single-owner');
    }
    const sessionHours = Number(values.ADMIN_SESSION_TTL_HOURS || 12);
    if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 168) {
      errors.push('ADMIN_SESSION_TTL_HOURS 必须是 1 到 168 之间的整数');
    }
    if (values.QUESTION_BANK_STORAGE !== 'cos') {
      errors.push('生产环境启用管理后台时 QUESTION_BANK_STORAGE 必须为 cos');
    }
    ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'].forEach((name) => {
      if (!String(values[name] || '').trim()) errors.push(`${name} 缺失`);
    });
    if (values.COS_PUBLIC_BASE_URL) {
      errors.push('私有 COS 桶的 COS_PUBLIC_BASE_URL 必须留空并由服务端代理读取');
    }
    if (values.ADMIN_BOOTSTRAP_TOKEN_HASH && !/^[a-f0-9]{64}$/i.test(values.ADMIN_BOOTSTRAP_TOKEN_HASH)) {
      errors.push('ADMIN_BOOTSTRAP_TOKEN_HASH 必须是 32 字节随机令牌的 SHA-256 十六进制值');
    }
  }
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
