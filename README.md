# 趣字节刷题

> 当前分支面向微信云托管：小程序通过 `wx.cloud.callContainer` 调用环境 `prod-d4gnnimmh1d0677fc` 中的 `express-tfts` 服务，后端使用 Fastify、Prisma 和 MySQL。部署步骤见 [微信云托管部署说明](docs/WXCLOUDRUN_DEPLOYMENT.md)。

原生微信小程序，包含 500 道唯一题目、七个底层学科和考研 408 客观题专项模拟。项目默认使用 Mock 仓储，可在没有后端的情况下完整演示；仓库同时包含 MySQL + Fastify/Prisma 后端，普通练习可切换到真实 API，页面代码不变。

## 已实现范围

- 五个首页入口：C/C++、Linux/操作系统、数据结构、计网/STL、考研 408。
- 七个独立学科：`cpp`、`linux`、`os`、`ds`、`network`、`stl`、`co`。
- 通用普通练习：章节、随机、错题、收藏，支持 5/10/20 题、即时解析、收藏、结果统计和会话恢复。
- 全局学习中心：首页聚合、全局错题、全局收藏及按学科筛选。
- 408 客观题模拟：40 道单选、60 分钟、80 分，固定 12/12/9/7 配比，答题卡、草稿恢复、自动交卷、历史成绩和四科分析。
- Mock v2：保存跨学科进度、错题、收藏、普通会话和考试；首次运行自动迁移 `cpp_mock_state_v1`。
- Mock/API 双实现：页面只依赖通用仓储，不直接调用 `wx.request`。
- 真实后端：微信登录适配、访问/刷新令牌、七学科普通练习、错题收藏、聚合统计、408 考试闭环及账户数据删除。
- 游戏化学习：普通练习与 408 共用积分账户，提供日/周/总榜、公开昵称与编号、12 个成就徽章及可佩戴称号。

## 立即运行

1. 在微信开发者工具中选择“导入项目”，目录选择本仓库根目录。
2. 没有正式 AppID 时可使用测试号；项目配置的源码目录为 `miniprogram/`。
3. 编译后点击“使用演示账号登录”，即可体验全部模块。
4. 真实后端联调请先按 [server/README.md](server/README.md) 初始化数据库，再通过开发者工具存储项切换 API；无需修改页面源码。

## 开发命令

```powershell
npm run generate:data  # 根据知识事实表生成六个新增题库，并规范 C/C++ 元数据
npm run build:data     # 将七个源题库生成唯一的压缩运行时注册表
npm run validate:data  # 校验 500 题、章节、题型、难度、答案、408 题池和图片预算
npm run verify         # 数据、语法、路由、包体积、Mock 状态机全部验证
npm run verify:server  # Prisma 生成、TypeScript 检查和服务端单元测试
npm run verify:integration # 独立 MySQL 测试库迁移与真实 API 集成测试
npm run verify:all     # 小程序、后端和数据库集成门禁
npm run verify:release # 在全量门禁后检查云托管配置、隐私信息和题库人工复核
```

运行时题库只保留一份：`miniprogram/data/questions.js`。不要在分包中复制题库。修改 `content/*-questions.json` 后必须重新执行 `npm run build:data` 和 `npm run verify`。

## 关键接入点

- 小程序首页：`/pages/index/index`
- C/C++ 兼容入口：`/modules/cpp/pages/home/index`
- 通用学科入口：`/modules/cpp/pages/home/index?subjectId=ds`
- 组合方向页：`/modules/cpp/pages/tracks/index?groupId=linux-os`
- 408 入口：`/modules/cpp/pages/exam-home/index`
- 公共 Token：API 登录成功后调用 `auth.setTokens(accessToken, refreshToken)`
- 学科注册表：`miniprogram/config/subjectRegistry.js`
- 通用仓储：`miniprogram/services/practiceRepository.js`
- Mock 核心：`miniprogram/services/mock/practiceCore.js`

## 项目文档

- [全模块需求](docs/ALL_MODULE_REQUIREMENTS.md)
- [通用 API 契约](docs/API_CONTRACT.md)
- [架构与数据流](docs/ARCHITECTURE.md)
- [微信开发者工具验收清单](docs/MANUAL_TEST_CHECKLIST.md)
- [题库复核状态](content/REVIEW_STATUS.md)
- [通用题库 Schema](schemas/question.schema.json)
- [生产开发与部署路线图](docs/PRODUCTION_DEPLOYMENT_ROADMAP.md)
- [发布候选版清单](docs/RELEASE_CHECKLIST.md)
- [预发布与生产运行手册](docs/OPERATIONS_RUNBOOK.md)
- [后端本地开发说明](server/README.md)
- [微信云托管部署说明](docs/WXCLOUDRUN_DEPLOYMENT.md)

## 发布边界

真实微信登录、普通练习、408、积分成就、账户删除和微信云托管部署基线均已完成。体验版与正式版会强制使用 `miniprogram/config/release.js` 中的云环境和服务配置，不接受本地 Storage 覆盖。正式发布前仍需同步公众平台隐私指引，并完成 iOS/Android 真机验收。在线编程判题、主观题评分、评论、搜索和管理后台仍不在当前范围。
