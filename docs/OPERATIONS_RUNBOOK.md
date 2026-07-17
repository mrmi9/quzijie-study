# 趣字节刷题生产运行手册

本手册面向当前微信云托管 + MySQL 8 环境。服务发布步骤见 [WXCLOUDRUN_DEPLOYMENT.md](WXCLOUDRUN_DEPLOYMENT.md)，题库内容发布步骤见 [QUESTION_BANK_MANAGEMENT.md](QUESTION_BANK_MANAGEMENT.md)。

## 1. 每次部署前

1. 确认云托管当前版本、MySQL 自动备份状态和最近恢复点。
2. 在能够访问 MySQL 私网地址的受信运维机准备权限为 `600` 的环境文件。
3. 执行一次离线一致性备份：

```bash
export QUIZIJIE_API_ENV_FILE=/secure/quzijie-mysql.env
export QUIZIJIE_BACKUP_DIR=/secure/backups
export QUIZIJIE_BACKUP_RETENTION_DAYS=14
bash ops/backup-mysql.sh
```

4. 运行全量门禁并记录结果：

```powershell
npm run verify:all
npm run check:release
```

以上是生产部署硬门禁：自动备份/恢复点、当次离线备份及最近一次一次性数据库恢复演练必须均有可核验记录。缺少任一记录时停止部署，不执行生产迁移，也不启用题库管理后台。

`ops/install-backup-timer.sh` 只适用于 `/opt/quzijie-study` 且能访问目标 MySQL 的受信 Linux 运维机。它每天北京时间 03:20 执行 `backup-mysql.sh`；微信云托管数据库的控制台自动备份仍必须独立开启，不能只依赖这台机器。

## 2. 部署与观察

1. 第一阶段设置 `ADMIN_ENABLED=false`，部署包含向后兼容 MySQL 迁移的新后端。
2. 云托管存活探针使用 `/health`，就绪探针或流量健康检查必须使用 `/ready`。启动期间 `/health=200` 仅说明进程存活；`/ready` 以及所有业务、管理后台接口返回 `503 SERVICE_BOOTSTRAPPING` 是预期行为。
3. 等待 `/ready=200/database ok`，确认迁移、题库基线检查和系统回填全部完成，再验证 `/api/v1/catalog`、登录、随机练习、填空/简答、408、错题、收藏和积分。
4. 配齐稳定的 `ADMIN_ENCRYPTION_KEY`、私有 COS 桶、最小权限凭据和 `ADMIN_REVIEW_POLICY` 后，第二阶段设置 `ADMIN_ENABLED=true` 并部署；单管理员首次通过一次性 `/admin/setup` 建号并删除启动令牌哈希，再等待 `/ready=200/database ok` 并验证 `/admin/`。
5. 第一次启用题库后台时只发布一个小型测试批次，核对快照 SHA-256 和对象回读。
6. 观察日志中的 API 5xx、迁移错误、缺少当前题目版本、对象上传失败和容器重启。

云托管启动流程只会向完全空白的业务库导入仓库基线。任何非空库都不能运行基线导入；日常题库更新一律从管理后台发布。

## 题库对象存储维护

首次启用管理后台以及修改 COS 桶策略后，先以只读模式检查本系统托管的生命周期规则：

```bash
npm run storage:lifecycle --workspace server
```

确认输出只让 `question-bank/imports/` 和 `question-bank/media/uploads/` 在 30 天后过期、只终止 7 天未完成的分块上传，并保留桶内其他规则后，才追加 `-- --apply`。`question-bank/releases/` 和 `question-bank/media/sha256/` 必须永久保留。

每月或由腾讯云定时任务运行失败发布对象清理。默认命令只预览，确认数据库状态和对象键后才执行：

```bash
npm run storage:cleanup --workspace server
npm run storage:cleanup --workspace server -- --apply
```

清理器只删除超过保留期且状态为 `FAILED` 的发布前缀，任何 `PUBLISHED` 记录及当前活动发布都不会被删除。执行日志和系统审计需与当月运维记录一并保存。

从已构建的 CloudRun 镜像执行时，分别使用 `storage:lifecycle:compiled` 和 `storage:cleanup:compiled`，避免依赖开发期 `tsx`。

## 3. 应用回滚

应用故障时回滚到上一健康云托管版本。数据库迁移必须向前兼容，不自动执行破坏性 Schema 回滚。题库内容问题从后台发布记录发起回滚，回滚会创建新发布记录和快照，不修改旧记录。

## 4. MySQL 恢复演练

至少定期恢复到独立的一次性数据库并核对迁移表、用户数、题目数、当前发布 ID 和代表性历史会话：

```bash
export QUIZIJIE_API_ENV_FILE=/secure/quzijie-mysql.env
export QUIZIJIE_RESTORE_FILE=/secure/backups/quzijie-YYYYMMDDTHHMMSSZ.sql.gz
export QUIZIJIE_RESTORE_DATABASE=quzijie_restore_test
export QUIZIJIE_RESTORE_DATABASE_CONFIRM=quzijie_restore_test
export QUIZIJIE_TARGET_ENVIRONMENT=staging
export QUIZIJIE_ALLOW_RESTORE=YES
export QUIZIJIE_ALLOW_DATABASE_REPLACE=YES
bash ops/restore-mysql.sh
```

恢复脚本会销毁并重建显式指定的目标库。它拒绝把环境文件中的活动库标记为 staging 后覆盖；生产库恢复还要求 `QUIZIJIE_ALLOW_PRODUCTION_RESTORE=YES`。生产恢复前必须停写、审批、通知并再次备份当前状态。

## 5. 每次发布后的核对

- `/health=200`、`/ready=200/database ok` 与真实小程序调用通过；平台就绪探针确认指向 `/ready`，而不是仅检查 `/health`；
- 登录、练习、错题、收藏、408、积分成就和账户删除各抽查一次；
- 动态目录数量、题库当前版本和快照哈希一致；
- 日志不包含数据库密码、Token、OpenID、TOTP 或对象存储密钥；
- 备份文件通过 gzip 完整性检查，恢复演练有记录；
- 当前版本、上一版本、Git SHA、迁移和题库发布 ID 已留档。
