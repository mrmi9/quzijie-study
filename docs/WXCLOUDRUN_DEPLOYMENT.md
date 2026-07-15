# 微信云托管部署说明

## 已绑定资源

- 云环境：`prod-d4gnnimmh1d0677fc`
- 服务：`express-tfts`
- 小程序调用方式：`wx.cloud.callContainer`
- 容器端口：`3000`
- 存活检查：`/health`
- 就绪检查：`/ready`
- 数据库：微信云托管 MySQL，业务库名默认 `quzijie`

`express-tfts` 只是创建环境时生成的服务名。部署本项目后，模板的 `/api/count` 会被业务 API 取代，这是预期行为。

## 安全前置条件

1. 任何曾出现在聊天、截图、日志或提交中的数据库密码都必须先在云托管控制台重置。
2. 数据库密码、OpenID、Token 和其他凭据不得写入源码、Git、镜像层或文档。
3. 本项目的云托管登录直接使用平台注入的 `X-WX-OPENID`，不需要小程序 AppSecret，也不需要 JWT 密钥。
4. 业务接口同时要求平台注入的 `X-WX-SOURCE`，缺少可信来源时返回 `401 CLOUD_IDENTITY_MISSING`。

## 服务环境变量

云托管模板通常已经向服务注入 `MYSQL_ADDRESS`、`MYSQL_USERNAME` 和 `MYSQL_PASSWORD`。保留重置后的真实值，并补充：

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
WECHAT_AUTH_MODE=cloud
MYSQL_DATABASE=quzijie
DB_CONNECTION_LIMIT=5
QUIZIJIE_SEED_ON_EMPTY=true
```

也可以只设置一个标准 `mysql://` 格式的 `DATABASE_URL`，但不要同时在代码中保存连接串。默认启动流程会：

1. 创建不存在的 `quzijie` 数据库；
2. 执行 `prisma migrate deploy`；
3. 仅在题目表为空时导入 500 道题；
4. 启动 Fastify 服务。

## 控制台部署

1. 在云托管控制台打开环境 `prod-d4gnnimmh1d0677fc`。
2. 打开服务 `express-tfts`，新建版本并选择本仓库代码。
3. 构建目录使用仓库根目录，Dockerfile 使用根目录的 `Dockerfile`。
4. 确认监听端口为 `3000`，环境变量符合上一节。
5. 部署完成后先检查版本日志，必须看到 MySQL 迁移成功；空库首次启动还应看到 `Seeded 500 questions`。
6. 访问公网域名的 `/health` 和 `/ready`，两者都应返回 `data.status = ok`，其中 `/ready` 还应返回 `database = ok`。

## 小程序验证

体验版和正式版已固定使用：

```js
wx.cloud.callContainer({
  config: { env: 'prod-d4gnnimmh1d0677fc' },
  path: '/api/v1/auth/wechat/cloud-login',
  header: { 'X-WX-SERVICE': 'express-tfts' },
  method: 'POST',
  data: {}
})
```

验收顺序：登录、首页统计、创建 C/C++ 随机练习、提交答案、错题与收藏、创建并提交一场 408 模拟考试、退出后重新进入恢复状态、删除测试账户。

## 本地复现

本地使用 MySQL 8 设置 `TEST_DATABASE_URL` 后运行：

```powershell
npm run verify:miniprogram
npm run verify:server
npm run verify:integration
docker build -t quzijie-cloudrun:local .
```

旧 PostgreSQL 迁移文件保存在 `server/prisma/migrations-postgresql/`，只用于追溯旧部署；云托管只执行 `server/prisma/migrations/` 中的 MySQL 迁移。
