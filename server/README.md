# 趣字节刷题 API

服务端采用 Fastify、TypeScript、Prisma 7 和 MySQL 8，已提供微信云托管身份适配、七学科普通练习、错题收藏、聚合统计、408 客观题考试，以及积分、排行榜和成就闭环。

## 环境要求

- Node.js 24 或更高版本
- MySQL 8
- 开发库 `quzijie_dev` 与独立测试库 `quzijie_test`

复制 `server/.env.example` 为 `server/.env`，修改数据库连接和 JWT 密钥。真实微信登录需要设置 `WECHAT_AUTH_MODE=real`、正式 AppID 和 AppSecret；AppSecret 不得进入客户端、Git 或日志。

## 初始化与运行

在仓库根目录执行：

```powershell
npm install
npm run db:deploy --workspace server
npm run server:db:seed
npm run server:dev
```

- `GET http://127.0.0.1:3000/health`：进程存活检查，不依赖数据库。
- `GET http://127.0.0.1:3000/ready`：数据库就绪检查。
- 408 到期扫描每 15 秒执行一次，所有考试接口同时执行请求级到期检查。

本机 MySQL 8 已安装时可直接使用独立开发库。微信云托管的容器化、迁移和空库导入步骤见 [部署说明](../docs/WXCLOUDRUN_DEPLOYMENT.md)。

## 验证

```powershell
npm run verify
npm run verify:server
npm run verify:integration
npm run verify:all
npm run verify:release
```

集成测试会迁移独立的 `mysql://.../quzijie_test`，覆盖 500 题导入、Token 轮换、普通练习、408 组卷、草稿、并发幂等交卷、积分每日上限、排行榜、历史回填、删除级联和历史快照。测试库不得指向开发库或生产库。

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
