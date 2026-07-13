# 趣字节刷题

原生微信小程序项目，当前已实现 C/C++ 刷题分包及可独立演示的 Mock 数据层。

## 立即运行

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本仓库根目录，AppID 可先使用测试号。
3. 编译后在主页进入“C/C++”，点击“使用演示账号登录”。
4. 可体验章节练习、随机练习、即时解析、结果统计、错题重做、收藏和中断恢复。

项目默认在 `miniprogram/config/env.js` 中使用 `repositoryMode: 'mock'`。团队后端就绪后，将其改为 `api` 并配置 `apiBaseUrl`；页面代码无需修改。

## 团队接入点

- 主页入口：`/modules/cpp/pages/home/index`
- 认证令牌：公共登录层登录成功后调用 `auth.setToken(token)`。
- 题库导入源：`content/cpp-questions.json`
- API 约定：`docs/CPP_API_CONTRACT.md`
- 模块需求：`docs/CPP_MODULE_REQUIREMENTS.md`

当前主包主页和登录页是空仓库下的演示占位。合并到团队工程时可以移除，但须保留上述分包入口、Token 适配和 `app.json` 分包注册。

## 开发命令

```powershell
npm run build:data
npm run validate:data
npm run verify
```

修改题库 JSON 后必须运行 `npm run build:data`，生成小程序运行时数据模块，再运行 `npm run verify`。

## 首版边界

题库只覆盖 C/C++ 语言本身，不包含 STL、数据结构、Linux、操作系统、计算机网络和考研专题。首版不提供在线编译、代码输入、模拟考试、排行榜、评论、搜索、游客答题或管理后台。
