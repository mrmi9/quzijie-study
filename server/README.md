# 趣字节刷题 API

当前服务端里程碑提供微信登录适配、访问/刷新令牌、七学科普通练习、进度统计、错题与收藏接口。408 考试服务端接口暂时明确返回 `501 NOT_IMPLEMENTED`，小程序的 Mock 408 流程不受影响。

## 环境要求

- Node.js 24 或更高版本
- PostgreSQL 17
- 开发库 `quzijie_dev` 与独立测试库 `quzijie_test`

复制 `server/.env.example` 为 `server/.env`，并按本机数据库账号修改 `DATABASE_URL` 与 `TEST_DATABASE_URL`。默认示例使用：

```text
postgresql://quzijie:quzijie_dev_password@localhost:5432/quzijie_dev?schema=public
postgresql://quzijie:quzijie_dev_password@localhost:5432/quzijie_test?schema=public
```

Docker Compose 配置保留为可选方案；使用本机 PostgreSQL 时不需要启动 `compose.yaml`。

## 初始化与运行

在仓库根目录执行：

```powershell
npm install
npm run server:db:migrate
npm run server:db:seed
npm run server:dev
```

健康检查为 `GET http://127.0.0.1:3000/health`。开发环境默认启用受控微信 Stub 登录；生产环境会拒绝 Stub，必须提供 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，并把 `WECHAT_AUTH_MODE` 设置为 `real`。

## 验证

```powershell
npm run verify
npm run verify:server
npm run verify:integration
```

`verify:integration` 会对 `quzijie_test` 执行迁移，并验证 500 题导入、Token 轮换、用户隔离、答题幂等、交卷和结果恢复。测试库不得指向开发库或生产库。

## 小程序 API 模式

小程序默认仍使用 Mock。需要本地联调时，在微信开发者工具控制台设置：

```javascript
wx.setStorageSync('quzijie_repository_mode', 'api')
wx.setStorageSync('quzijie_api_base_url', 'http://127.0.0.1:3000')
```

重新编译后登录页会调用 `wx.login`，再由后端交换业务 Token。恢复 Mock：

```javascript
wx.setStorageSync('quzijie_repository_mode', 'mock')
wx.removeStorageSync('quzijie_api_base_url')
```
