# 趣字节刷题 API 部署说明

## 1. 部署边界

`Dockerfile` 只构建 API 和独立迁移镜像；`compose.api.yaml` 不包含 PostgreSQL。开发机继续使用已安装的数据库，正式环境应连接独立 PostgreSQL 17 服务。

## 2. 生产环境变量

从 `server/.env.example` 创建一个不会提交 Git 的环境文件，例如 `server/.env.production`，至少设置：

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@DB_HOST:5432/DB_NAME?schema=public
JWT_ACCESS_SECRET=不少于32字符且不可使用示例值
WECHAT_AUTH_MODE=real
WECHAT_APP_ID=正式小程序AppID
WECHAT_APP_SECRET=正式AppSecret
```

Windows Docker 连接本机 PostgreSQL 时，`DB_HOST` 使用 `host.docker.internal`，并确保 PostgreSQL 已允许来自 Docker 网络的连接。正式部署使用内网数据库地址，不使用该 Windows 专用主机名。

## 3. 构建、迁移和启动

```powershell
$env:QUIZIJIE_API_ENV_FILE='server/.env.production'
docker compose -f compose.api.yaml build api migrate
docker compose -f compose.api.yaml --profile tools run --rm migrate
docker compose -f compose.api.yaml run --rm api npm run db:seed:compiled --workspace server
docker compose -f compose.api.yaml up -d api
```

迁移必须在新 API 启动前独立执行；API 容器不会在启动时修改数据库。题库导入是幂等操作，但生产发布只有题库内容或版本变化时才需要执行。

## 4. 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ready
```

`/health` 只证明进程存活，`/ready` 同时验证数据库连接。反向代理和编排平台应使用 `/ready` 决定是否接收流量。

## 5. 发布和回滚

1. 发布前备份数据库并验证备份文件可读取。
2. 构建带提交 SHA 的不可变镜像标签。
3. 先运行迁移镜像，再启动新 API 镜像。
4. 验证健康检查、登录、普通练习和一场408考试。
5. 应用回滚使用上一版本镜像；数据库 Schema 采用向前兼容迁移，不自动执行破坏性回滚。

任何日志、CI变量、镜像层和故障截图都不得包含数据库密码、JWT、微信 code、OpenID 或 AppSecret。
