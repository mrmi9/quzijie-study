# 微信云托管部署说明

> 题库管理后台启用时还必须配置 `ADMIN_ENABLED=true`、稳定的 `ADMIN_ENCRYPTION_KEY` 和 COS 加密凭据；首次账号、对象生命周期、Excel 与发布流程见 [标准化题库管理手册](QUESTION_BANK_MANAGEMENT.md)。未配置这些变量时 `/admin` 保持关闭，不影响现有小程序 API。

## 已绑定资源

- 云环境：`prod-d4gnnimmh1d0677fc`
- 服务：`express-tfts`
- 小程序调用方式：`wx.cloud.callContainer`
- 容器端口：`3000`
- 存活检查：`/health`（仅证明容器进程仍在运行）
- 就绪检查：`/ready`（云托管流量门禁必须使用此路径）
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

1. 先监听端口，让 `/health` 可以报告进程存活；
2. 将除 `/health`、`/ready` 外的业务和管理后台请求统一拦截为 `503 SERVICE_BOOTSTRAPPING`；
3. 创建不存在的 `quzijie` 数据库并执行 `prisma migrate deploy`；
4. 仅在用户、题库、目录、发布、导入和管理员等业务表完全为空时导入 500 道基线题，并完成系统回填与启动检查；
5. 所有启动任务成功后才让 `/ready` 返回 `200`，解除业务和管理后台的启动门禁。

`/health=200` 不能证明数据库、迁移、题库基线或系统回填已经就绪，也不能作为接收业务流量的依据。云托管的就绪探针或流量健康检查必须配置为 `/ready`；启动期间 `/ready` 返回 `503` 是预期行为。存活探针仍可使用 `/health`，避免把正在执行迁移的健康容器误杀。

## 控制台部署

生产部署分两个阶段，且任何包含数据库迁移的部署都必须先通过下一节的备份门禁：

1. 在云托管控制台打开环境 `prod-d4gnnimmh1d0677fc` 和服务 `express-tfts`，确认存活探针为 `/health`、就绪探针或流量健康检查为 `/ready`。
2. 新建第一阶段版本，构建目录使用仓库根目录、Dockerfile 使用根目录的 `Dockerfile`，监听端口为 `3000`，并设置 `ADMIN_ENABLED=false`。
3. 部署第一阶段版本。启动期间允许 `/health=200`，但 `/ready`、业务 API 和 `/admin/` 必须保持 `503`；只有日志确认 MySQL 迁移、基线检查和系统回填全部成功后，`/ready` 才应返回 `200` 且 `database=ok`。
4. 在第一阶段执行登录、目录、随机练习、错题、收藏、408 和积分的现有业务冒烟；失败时回滚应用版本，不启用管理后台。
5. 配齐稳定的 `ADMIN_ENCRYPTION_KEY`、私有 COS 桶和最小权限凭据后，新建第二阶段版本并设置 `ADMIN_ENABLED=true`。单管理员运营同时设置 `ADMIN_REVIEW_POLICY=single-owner` 和一次性 `ADMIN_BOOTSTRAP_TOKEN_HASH`；双人运营保留默认 `two-person`。
6. 部署第二阶段版本，再次等待 `/ready=200/database ok`。首次建号从 `/admin/setup` 完成，随后删除启动令牌哈希；验证 `/admin/` 登录、对象回读、基线快照、自检或独立复核以及 TOTP 发布/回滚流程。

## MySQL 备份与恢复

部署迁移前必须同时满足以下门禁：腾讯云控制台自动备份正常且存在近期可恢复时间点；从能访问 MySQL 私网地址的受信运维环境执行 `ops/backup-mysql.sh` 并得到通过完整结束标记和 gzip 校验的 `.sql.gz` 文件；最近一次 `ops/restore-mysql.sh` 一次性数据库恢复演练有成功记录。任一项缺失时停止部署，不得以 `/health=200` 代替备份或恢复证据。生产恢复需要目标库名复述、双重破坏性确认和额外的生产确认。完整命令见 [生产运行手册](OPERATIONS_RUNBOOK.md)。

仓库 JSON 导入只用于完全空库基线。已有生产库新增或修订题目必须通过 `/admin/` 的草稿、跨人复核和发布流程，不能运行基线导入命令。

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
