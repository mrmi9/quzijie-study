# 趣刷题喽发布候选版清单

本清单以“微信正式版本可供真实用户使用”为完成标准。当前正式链路是微信云托管 `prod-d4gnnimmh1d0677fc/express-tfts`、MySQL 8 和 `wx.cloud.callContainer`；旧自建 PostgreSQL、8443 端口及 `request` 合法域名不再是发布目标或发布门禁。

## 1. 当前必须由项目负责人配置

### 1.1 微信云托管与 MySQL

- [x] 正式环境、服务和公网入口已经创建，MySQL 不向公网开放。
- [ ] 每次生产部署前重新确认当前线上基线的 `/health`、`/ready` 和数据库连接；不得沿用历史验收结果。
- [ ] 云托管存活探针使用 `/health`，就绪探针或流量健康检查使用 `/ready`；未把 `/health=200` 当作数据库和业务就绪依据。
- [ ] 在腾讯云控制台确认生产 MySQL 自动备份和最近可恢复时间点。
- [ ] 在可访问云数据库私网地址的受信运维机运行 `ops/backup-mysql.sh`，并用 `ops/restore-mysql.sh` 对一次性数据库完成恢复演练。
- [ ] 为题库管理后台配置长期稳定的 `ADMIN_ENCRYPTION_KEY`、私有 COS 桶及最小权限密钥；密钥只能进入云托管加密环境变量。
- [x] AppSecret、数据库密码、JWT 密钥、管理员密码、TOTP 种子和 COS 密钥均未写入 Git 或日志。

### 1.2 微信公众平台

- [x] AppID `wx69380e593ebd5ac7` 的主体、基本信息、服务类目和备案已经完成。
- [x] 小程序使用云环境 `prod-d4gnnimmh1d0677fc` 和服务 `express-tfts`，不依赖旧 HTTPS 业务域名。
- [ ] 在“账号设置 → 服务内容声明 → 用户隐私保护指引”填写与小程序内隐私说明完全一致的正式内容。
- [ ] 提审前再次核对隐私指引覆盖微信登录标识、答题记录、错题、收藏、考试、积分流水、成就、自定义昵称和公开编号。
- [ ] 明确说明排行榜会公开展示自定义昵称或默认“刷题者”、四位公开编号、积分和佩戴称号，不公开内部用户 ID、OpenID、UnionID 或头像。
- [ ] 确认项目成员具有开发、体验、审核和发布权限，并补齐 iOS 体验成员。

### 1.3 公开信息与内容复核

- [x] 运营主体“米文立”和公开联系邮箱 `1130967204@qq.com` 已写入发布配置。
- [x] 现有 500 题已通过结构、内容和近重复门禁。
- [x] 新增 350 道题全部采用原创表述，登记 58 个官方或开放资料来源，并完成事实、答案、版权和重复项四类交叉复核。
- [ ] 在生产后台使用两个独立管理员完成“提交 → 非提交人复核 → 发布”，不得绕过审计流程直接修改生产表。
- [ ] 确认小程序名称、简介、头像、类目、用户协议和隐私说明可以对外公开。

## 2. 由 Codex 继续完成

- [x] 实现动态学科/章节、五种题型、Excel 导入、暂存校验、跨人复核、原子发布、快照、回滚和审计。
- [x] 实现 Argon2id、TOTP、安全 Cookie、CSRF、限流、会话撤销及管理员角色权限。
- [x] 准备 MySQL 迁移、生产备份/恢复、COS 生命周期和云托管启动脚本。
- [x] 在独立 MySQL 8 中验证旧库迁移保留 7 学科、45 章节、500 题及代表性用户关系。
- [x] 在独立 MySQL 8 中完成真实 350 题 XLSX 的上传、1550 行校验、跨人复核、原子发布、自检和回滚。
- [ ] 通过自动备份/恢复点、当次离线备份和一次性数据库恢复演练三项硬门禁后，先以 `ADMIN_ENABLED=false` 部署迁移。
- [ ] 第一阶段启动时确认 `/health` 可存活但 `/ready`、业务 API 和 `/admin/` 均返回 `503 SERVICE_BOOTSTRAPPING`；等待 `/ready=200/database ok` 后再验证现有小程序业务。
- [ ] 配齐私有 COS、稳定管理密钥和两个独立管理员后以 `ADMIN_ENABLED=true` 再部署，等待 `/ready=200/database ok` 后验证 `/admin/` 和基线快照。
- [ ] 创建至少两个独立管理员账号，导入并发布 350 题正式批次。
- [ ] 真机抽查新题、填空题、简答自评、错题记录、积分规则和历史会话快照。
- [ ] 上传小程序体验版，完成 Android 全流程和 iOS 最小验收后提交审核。

## 3. 发布门禁

所有数据库命令必须显式指向本机或 CI 的专用 `_test` 数据库，禁止对生产库运行：

```powershell
npm.cmd run validate:open-batch
Get-FileHash -Algorithm SHA256 content/imports/2026-07-17-open-sources/*.xlsx
npm.cmd run verify:miniprogram
npm.cmd run verify:server
npm.cmd run admin:build

$env:MIGRATION_TEST_DATABASE_URL = 'mysql://.../quzijie_migration_test'
npm.cmd run verify:migration

$env:TEST_DATABASE_URL = 'mysql://.../quzijie_test'
npm.cmd run verify:integration

npm.cmd run check:release
git diff --check
docker build --tag quzijie-cloudrun:candidate .
```

`check:release` 必须验证正式 AppID、`transport=cloud`、云环境 ID、云托管服务名、运营者、隐私联系方式及账户/隐私页面；只有 HTTP 模式才校验 HTTPS 业务域名。

## 4. 发布完成定义

- 新迁移已在生产 MySQL 成功执行，生产备份和恢复点有效。
- 云托管存活探针指向 `/health`，就绪探针或流量健康检查指向 `/ready`；启动期业务与后台接口保持 `503`，启动完成后 `/ready=200/database ok`。
- 第二阶段 `/admin/` 可访问，日志无持续 5xx、容器重启、迁移或快照错误。
- 350 题生产批次显示已复核、已发布，活动题量和快照 SHA-256 与后台记录一致。
- 小程序通过云托管读取最新目录与题库，不依赖 Mock、调试模式或旧自建 API。
- 微信审核通过且正式版本已发布；真实用户可以登录、练习、考试、恢复进度、查看错题收藏并删除账户。
- 监控、日志、告警、备份、题库回滚和应用版本回滚均可用。
