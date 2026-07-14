# 趣字节刷题 API

服务端采用 Fastify、TypeScript、Prisma 7 和 PostgreSQL 17，已提供真实微信登录适配、访问/刷新令牌、七学科普通练习、错题收藏、聚合统计及 408 客观题考试闭环。

## 环境要求

- Node.js 24 或更高版本
- PostgreSQL 17
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

本机 PostgreSQL 已安装时无需启动 `compose.yaml`。容器化和迁移步骤见 [部署说明](../docs/DEPLOYMENT.md)。

## 验证

```powershell
npm run verify
npm run verify:server
npm run verify:integration
npm run verify:all
```

集成测试会迁移 `quzijie_test`，覆盖 500 题导入、Token 轮换、普通练习、408 组卷、草稿、并发幂等交卷、到期交卷、错题统计和历史快照。测试库不得指向开发库或生产库。

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
