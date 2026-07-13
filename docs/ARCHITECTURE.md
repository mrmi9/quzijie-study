# 架构与数据流

## 1. 分层

全局页面和考试调用 `services/practiceRepository.js`，学科页面通过 `services/subjectRepository.js` 将 `subjectId` 绑定为同一组仓储方法。入口先执行统一登录守卫，再根据 `config/env.js` 选择 Mock 或 API 实现。Mock 与 API 暴露相同方法，因此切换环境不修改页面。

主包保存 TabBar 页面、登录、学科注册表、公共请求层、仓储和唯一运行时题库。`modules/cpp` 是历史命名的业务分包，实际承载所有通用学科页面、组合方向页和 408 页面；保留该 root 是为了兼容既有主页路由。

## 2. 配置驱动页面

`config/subjectRegistry.js` 是模块唯一注册入口，描述五个产品入口和七个底层学科。通用页面读取 `subjectId`，不复制七套业务代码。无参数访问旧路径时默认使用 `cpp`。

## 3. 题库流水线

`content/*-questions.json` 是七份可评审源文件。`tools/generate-question-banks.js` 从事实表生成六个新增题库并规范 C/C++ 元数据；`tools/build-question-module.js` 合并成 `miniprogram/data/questions.js`。全局页、普通练习和考试都引用这一份运行时注册表。

`tools/validate-questions.js` 校验 500 题数量、全局 ID、题干唯一、章节配额、题型和难度、选项答案、解析、标签、408 资格及图片资源。`tools/check-project.js` 校验路由、页面完整性、页面不直接请求、运行时题库一致性及包体积。

## 4. Mock v2 状态

状态键为 `practice_mock_state_v2`，核心结构如下：

```text
version
sessions / activeSessionId / submissions
subjects.{subjectId}.attemptedQuestions
subjects.{subjectId}.wrongQuestions
subjects.{subjectId}.favorites
subjects.{subjectId}.totals
dailyAttempts
exams / activeExamId
```

首次读取 v2 状态时，如果只存在 `cpp_mock_state_v1`，迁移器把旧 sessions、activeSession、submissions、进度、错题、收藏和 totals 放入 `subjects.cpp`，并为旧会话补上 `subject=cpp`。

## 5. 普通练习状态机

`active → completed` 表示全部题目提交后完成；创建新普通会话会把旧 active 会话改为 `abandoned`。逐题答案以 `clientAnswerId` 去重。待答视图通过 `publicQuestion` 去除答案与解析，提交后只返回该题反馈。

## 6. 408 状态机

试卷创建后记录随机题目 ID、草稿、`createdAt` 和 `expiresAt`。获取到期试卷时 Mock 核心立即执行幂等自动交卷。完成后结果保存每题完整快照、选择、正误、总分和四科统计；再次提交直接返回首次结果。

## 7. 真实 API 接入

公共请求层统一处理 Base URL、Bearer Token、超时、业务错误和 401。真实后端必须严格遵守 `docs/API_CONTRACT.md`，尤其是待答题不泄露答案、普通提交幂等、试卷草稿可覆盖、交卷幂等和历史快照不可变。
