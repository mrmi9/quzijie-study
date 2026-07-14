# 趣字节刷题预发布与生产运行手册

本手册用于 Linux + Docker Compose + 外部 PostgreSQL 17。API 容器仅绑定 `127.0.0.1:3000`，公网入口必须由 Caddy、Nginx 或云负载均衡提供 HTTPS 443。

## 1. 镜像发布

在 GitHub Actions 手动运行 `publish release images`。不填写 tag 时使用 `sha-<commit>`；也可以填写审核版本对应的不可变标签。工作流会先执行全量验证和发布配置门禁，再向 GHCR 推送：

```text
ghcr.io/<owner>/<repository>-api:<tag>
ghcr.io/<owner>/<repository>-api-migrate:<tag>
```

服务器如无法拉取私有 GHCR 包，需要由负责人执行一次 `docker login ghcr.io`；不要把访问令牌写入仓库、脚本参数或聊天。

## 2. 服务器目录与环境

建议目录：

```text
/opt/quzijie-study/
├── compose.release.yaml
├── ops/
├── tools/
├── project.config.json
├── server/.env.production  # chmod 600，不提交 Git
├── .release/               # 当前/上一镜像引用
└── backups/                # chmod 700，不提交 Git
```

复制 `server/.env.example` 为 `server/.env.production`，替换全部开发值后执行预检：

```bash
chmod 600 server/.env.production
node tools/check-deployment-env.js server/.env.production
```

预检只输出变量名称相关的错误，不输出数据库密码、JWT 或微信 Secret。

## 3. 首次部署

```bash
export QUIZIJIE_API_ENV_FILE=/opt/quzijie-study/server/.env.production
export QUIZIJIE_API_IMAGE=ghcr.io/<owner>/<repository>-api:<tag>
export QUIZIJIE_MIGRATE_IMAGE=ghcr.io/<owner>/<repository>-api-migrate:<tag>
export QUIZIJIE_API_PORT=3000
export QUIZIJIE_IMPORT_QUESTIONS=true
bash ops/deploy.sh
```

脚本依次执行环境预检、镜像拉取、独立迁移、可选的 500 题幂等导入、API 启动和 `/ready` 检查。只有健康检查通过后才记录当前镜像。

反向代理应转发到 `http://127.0.0.1:3000`，并保留 `X-Request-Id`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。完成 DNS 与证书后，从外部验证：

```bash
node tools/verify-deployment.js https://api.example.com
```

## 4. 日常升级

升级前必须备份并验证备份：

```bash
export QUIZIJIE_API_ENV_FILE=/opt/quzijie-study/server/.env.production
export QUIZIJIE_BACKUP_DIR=/opt/quzijie-study/backups
bash ops/backup-postgres.sh
```

然后设置新的两个镜像引用并执行 `bash ops/deploy.sh`。只有题库内容变化时才设置 `QUIZIJIE_IMPORT_QUESTIONS=true`。

## 5. 应用回滚

部署脚本会把上一镜像记录在 `.release/previous.env`。新版本出现业务故障时：

```bash
export QUIZIJIE_API_ENV_FILE=/opt/quzijie-study/server/.env.production
bash ops/rollback.sh
```

应用回滚不会回滚数据库 Schema，因此所有迁移必须保持向前兼容。若迁移具有破坏性，不得直接发布。

## 6. 数据库恢复演练

恢复会清理目标数据库中的既有对象，只能在确认目标后执行。预发布演练示例：

```bash
docker compose -f compose.release.yaml stop api
export QUIZIJIE_API_ENV_FILE=/opt/quzijie-study/server/.env.production
export QUIZIJIE_RESTORE_FILE=/opt/quzijie-study/backups/quzijie-YYYYMMDDTHHMMSSZ.dump
export QUIZIJIE_TARGET_ENVIRONMENT=staging
export QUIZIJIE_ALLOW_RESTORE=YES
bash ops/restore-postgres.sh
docker compose -f compose.release.yaml up -d api
```

生产恢复还要求显式设置 `QUIZIJIE_ALLOW_PRODUCTION_RESTORE=YES`，并必须先完成变更审批和停机通知。

## 7. 小程序上传

在 Windows 微信开发者工具已登录且开启“设置 → 安全设置 → 服务端口”后执行：

```powershell
.\ops\upload-miniprogram.ps1 -Version 2.1.0 -Description '预发布真实 API 验收版'
```

脚本先运行 `npm run verify:release`；门禁未通过时不会上传。上传是向微信平台传输代码的外部操作，正式执行前仍需负责人确认版本号和备注。

## 8. 每次发布后的核对

- `/health`、`/ready` 与公网 HTTPS 验证通过。
- 微信真实登录、普通练习、408、错题、收藏和账户删除至少各抽查一次。
- 日志中没有 code、OpenID、Token、AppSecret 或数据库连接信息。
- 数据库备份已生成并通过 `pg_restore --list`。
- 当前镜像、上一镜像、Git SHA、小程序版本号和发布时间已记录。
- 观察期结束前不删除上一镜像或最近备份。
