const fs = require('fs');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function nonPlaceholder(value) {
  const text = String(value || '').trim();
  return text && !/待配置|待填写|example\.com|示例/i.test(text);
}

function validateReleaseTransport(release) {
  const transportErrors = [];
  const transport = String(release.transport || '').trim();
  const cloudResourcePattern = /^[a-z][a-z0-9-]{0,62}$/;

  if (transport === 'cloud') {
    const cloudEnvId = String(release.cloudEnvId || '').trim();
    const cloudService = String(release.cloudService || '').trim();
    if (!nonPlaceholder(cloudEnvId) || !cloudResourcePattern.test(cloudEnvId) || cloudEnvId.endsWith('-')) {
      transportErrors.push('release.cloudEnvId 必须填写有效的微信云托管环境 ID');
    }
    if (!nonPlaceholder(cloudService) || !cloudResourcePattern.test(cloudService) || cloudService.endsWith('-')) {
      transportErrors.push('release.cloudService 必须填写有效的微信云托管服务名');
    }
    return transportErrors;
  }

  if (transport !== 'http') {
    return ['release.transport 必须为 cloud 或 http'];
  }

  try {
    const api = new URL(String(release.apiBaseUrl || ''));
    const hostname = api.hostname.toLowerCase();
    if (api.protocol !== 'https:') transportErrors.push('release.apiBaseUrl 必须使用 HTTPS');
    if (api.username || api.password || api.search || api.hash) {
      transportErrors.push('release.apiBaseUrl 不得包含凭据、查询参数或片段');
    }
    if (api.pathname !== '/' && api.pathname !== '') {
      transportErrors.push('release.apiBaseUrl 只填写域名和可选端口，不填写路径');
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || net.isIP(hostname)) {
      transportErrors.push('release.apiBaseUrl 不得使用 localhost 或 IP 地址');
    }
    if (hostname === 'api.weixin.qq.com' || hostname === 'example.com' || hostname.endsWith('.example.com')) {
      transportErrors.push('release.apiBaseUrl 必须替换为已备案并配置到微信后台的业务域名');
    }
  } catch {
    transportErrors.push('miniprogram/config/release.js 中必须填写有效的 HTTPS API 地址');
  }

  return transportErrors;
}

function runReleaseCheck() {
  const errors = [];
  const project = readJson('project.config.json');
  const app = readJson('miniprogram/app.json');
  const release = require(path.join(root, 'miniprogram', 'config', 'release.js'));
  const review = fs.readFileSync(path.join(root, 'content', 'REVIEW_STATUS.md'), 'utf8');

  if (!/^wx[0-9a-f]{16}$/i.test(String(project.appid || ''))) {
    errors.push('project.config.json 必须配置正式小程序 AppID');
  }
  if (project.setting?.urlCheck !== true) {
    errors.push('project.config.json setting.urlCheck 必须为 true');
  }
  errors.push(...validateReleaseTransport(release));

  if (!nonPlaceholder(release.operatorName)) errors.push('release.operatorName 必须填写实际运营主体');
  if (!nonPlaceholder(release.privacyContact)) errors.push('release.privacyContact 必须填写可用的隐私联系渠道');

  const pages = new Set(app.pages || []);
  ['pages/account/index', 'pages/privacy/index'].forEach((page) => {
    if (!pages.has(page)) errors.push(`发布包缺少必要页面：${page}`);
  });

  if (/交叉复核人：\s*待填写/.test(review)) errors.push('500 题尚未填写非出题人员交叉复核人');
  if (/交叉复核日期：\s*待填写/.test(review)) errors.push('500 题尚未填写交叉复核日期');
  if (/交叉复核结论：\s*待复核/.test(review)) errors.push('500 题交叉复核结论尚未通过');

  if (errors.length) {
    console.error('发布门禁未通过：');
    errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
    process.exit(1);
  }

  const releaseTarget = release.transport === 'cloud'
    ? `${release.cloudEnvId}/${release.cloudService}`
    : release.apiBaseUrl;
  console.log(`Release readiness passed for ${release.transport}:${releaseTarget}.`);
}

if (require.main === module) runReleaseCheck();

module.exports = { validateReleaseTransport, runReleaseCheck };
