function validateBaseUrl(raw, allowHttp = false) {
  const errors = [];
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
      errors.push('公开 API 必须使用 HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) errors.push('API 地址不得包含凭据、查询参数或片段');
    if (url.pathname !== '/' && url.pathname !== '') errors.push('API 地址不得包含路径');
    return { url, errors };
  } catch {
    return { url: null, errors: ['API 地址格式无效'] };
  }
}

async function readJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'x-request-id': `release-check-${Date.now()}` }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${url.pathname} 返回 HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyDeployment(rawBaseUrl, allowHttp = false) {
  const validated = validateBaseUrl(rawBaseUrl, allowHttp);
  if (validated.errors.length || !validated.url) throw new Error(validated.errors.join('；'));
  const healthUrl = new URL('/health', validated.url);
  const readyUrl = new URL('/ready', validated.url);
  const [health, ready] = await Promise.all([readJson(healthUrl), readJson(readyUrl)]);
  if (health?.data?.status !== 'ok') throw new Error('/health 响应不符合契约');
  if (ready?.data?.status !== 'ok' || ready?.data?.database !== 'ok') throw new Error('/ready 未确认数据库就绪');
  return { health: 'ok', readiness: 'ok', database: 'ok' };
}

async function main() {
  const baseUrl = process.argv[2] || process.env.QUIZIJIE_PUBLIC_API_BASE_URL || '';
  try {
    const result = await verifyDeployment(baseUrl, process.env.QUIZIJIE_ALLOW_HTTP_CHECK === 'true');
    console.log(`Deployment verification passed: ${Object.entries(result).map(([key, value]) => `${key}=${value}`).join(', ')}.`);
  } catch (error) {
    console.error(`Deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { validateBaseUrl, verifyDeployment };
