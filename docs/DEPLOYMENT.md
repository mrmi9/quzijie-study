# 趣字节刷题部署说明

当前正式环境为微信云托管 + MySQL 8。部署参数、控制台步骤和验收方法以 [微信云托管部署说明](WXCLOUDRUN_DEPLOYMENT.md) 为准；旧的自建 PostgreSQL 方案已经退役，不得用于当前环境的迁移、备份或恢复。

## 1. 发布前

1. 在腾讯云控制台确认生产 MySQL 自动备份和保留策略正常。
2. 从能访问云数据库的受信运维环境执行 `ops/backup-mysql.sh`，并保留生成的 `.sql.gz` 文件。
3. 运行 `npm run verify:all` 和 `npm run check:release`。
4. 记录当前健康云托管版本、Git 提交、数据库迁移状态和题库发布 ID。

运维环境文件必须使用 `mysql://` 的 `DATABASE_URL`，或平台提供的 `MYSQL_ADDRESS`、`MYSQL_USERNAME`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。文件权限设为 `600`，不得把凭据放入 Git、命令参数、日志或工单。

## 2. 迁移、基线与启动

云托管容器执行 `start:cloud`：先监听健康检查端口，让 `/health` 报告进程存活；在创建目标库、执行 `prisma migrate deploy`、空库基线检查和系统回填完成前，`/ready` 以及所有业务和管理后台接口统一返回 `503 SERVICE_BOOTSTRAPPING`。全部启动任务成功后 `/ready` 才返回 `200` 并解除业务门禁。已有用户、题目、发布记录、目录或管理员中的任一数据存在时，基线导入都会拒绝。

云托管存活探针可以使用 `/health`，但就绪探针或流量健康检查必须使用 `/ready`。`/health=200` 不能证明数据库 Schema 已迁移完成，也不能作为放行业务流量的条件。

确需在本地新建空数据库时，必须显式确认：

```powershell
$env:QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT='IMPORT_EMPTY_BASELINE'
npm run server:db:bootstrap-baseline
Remove-Item Env:QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT
```

该命令只能用于新空库。已有数据库的新增、修订和停用必须通过 `/admin/` 的“草稿 → 复核 → 发布”流程，不能再次执行基线导入。

## 3. 备份

```bash
export QUIZIJIE_API_ENV_FILE=/secure/quzijie-mysql.env
export QUIZIJIE_BACKUP_DIR=/secure/backups
bash ops/backup-mysql.sh
```

脚本使用权限为 `600` 的临时 MySQL 客户端配置，密码不会出现在进程参数中；使用一致性快照导出并检查完整结束标记和 gzip 完整性，最后原子生成 `quzijie-YYYYMMDDTHHMMSSZ.sql.gz`。

## 4. 恢复演练

先在一次性数据库演练，不得把生产库伪装成 staging：

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

脚本会删除并重建指定目标库。生产恢复还必须把 `QUIZIJIE_TARGET_ENVIRONMENT` 设为 `production`，并额外设置 `QUIZIJIE_ALLOW_PRODUCTION_RESTORE=YES`；执行前必须停写、完成变更审批并再生成一份当前库备份。

## 5. 发布后

- 第一阶段以 `ADMIN_ENABLED=false` 部署迁移，等待 `/ready=200/database ok` 后先完成现有小程序业务冒烟；
- 第二阶段仅在稳定 `ADMIN_ENCRYPTION_KEY`、私有 COS 最小权限凭据和两个独立管理员均已准备后设置 `ADMIN_ENABLED=true`，再次等待 `/ready=200/database ok` 并验证 `/admin/`；
- `/health` 返回 200 仅证明进程存活；云托管就绪探针确认指向 `/ready`，启动期业务和后台接口曾保持 `503`；
- 目录数量、随机练习、填空/简答、408 组卷和题图抽查通过；
- 管理后台发布快照哈希与对象存储回读一致；
- 日志没有持续 5xx、迁移失败、容器重启或敏感值；
- 保留部署前数据库备份和上一健康云托管版本作为回滚基线。
