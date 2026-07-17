# 趣字节刷题 API

服务端采用 Fastify、TypeScript、Prisma 7 和 MySQL 8，已提供微信云托管身份适配、动态学科目录、五种题型、错题收藏、408 客观题考试、积分成就，以及 `/admin/` 标准化题库管理闭环。

## 环境要求

- Node.js 24 或更高版本
- MySQL 8
- 开发库 `quzijie_dev`、独立集成库 `quzijie_test` 与独立迁移库 `quzijie_migration_test`

复制 `server/.env.example` 为 `server/.env`，修改数据库连接和 JWT 密钥。真实微信登录需要设置 `WECHAT_AUTH_MODE=real`、正式 AppID 和 AppSecret；AppSecret 不得进入客户端、Git 或日志。

## 初始化与运行

在仓库根目录执行：

```powershell
npm install
npm run db:deploy --workspace server
$env:QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT='IMPORT_EMPTY_BASELINE'
npm run server:db:bootstrap-baseline
Remove-Item Env:QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT
npm run server:dev
```

基线导入只允许用于完全空白的新数据库；只要已有用户、题目、目录、发布或管理员数据就会拒绝。已有数据库扩题必须走管理后台草稿、复核和发布流程。

- `GET http://127.0.0.1:3000/health`：进程存活检查，不依赖数据库。
- `GET http://127.0.0.1:3000/ready`：数据库就绪检查。
- 408 到期扫描每 15 秒执行一次，所有考试接口同时执行请求级到期检查。

本机 MySQL 8 已安装时可直接使用独立开发库。微信云托管的容器化、迁移和空库导入步骤见 [部署说明](../docs/WXCLOUDRUN_DEPLOYMENT.md)。

## 验证

```powershell
npm run verify
npm run verify:server
npm run verify:integration
npm run verify:migration
npm run admin:build
npm run verify:all
npm run verify:release
```

集成测试会迁移独立的 `mysql://.../quzijie_test`，覆盖基线导入、Token 轮换、普通练习、408、积分、动态目录、管理员 TOTP/CSRF/RBAC、跨人复核、发布、填空、简答和回滚。`verify:migration` 使用名称以 `_migration_test` 结尾的专用库验证旧 500 题和历史外键无损迁移。任何测试 URL 都不得指向开发库或生产库。

管理后台默认关闭。生产启用方法、管理员 CLI、Excel、COS 快照和发布 SOP 见 [标准化题库管理手册](../docs/QUESTION_BANK_MANAGEMENT.md)。

## 小程序 API 模式

在微信开发者工具控制台执行：

```javascript
wx.setStorageSync('quzijie_repository_mode', 'api')
wx.setStorageSync('quzijie_api_base_url', 'http://127.0.0.1:3000')
```

重新编译后登录页通过 `wx.login` 获取临时 code。联调完成后恢复默认 Mock：

```javascript
wx.setStorageSync('quzijie_repository_mode', 'mock')
wx.removeStorageSync('quzijie_api_base_url')
```

上述 Storage 开关只对开发版有效。体验版和正式版会强制使用 `miniprogram/config/release.js` 中的 HTTPS 地址，避免误把 Mock 版本提交审核。配置预发布域名后必须运行 `npm run verify:release`。
