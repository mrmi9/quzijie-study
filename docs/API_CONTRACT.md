# 趣字节刷题通用 API 契约 v2

> 微信云托管生产模式通过 `wx.cloud.callContainer` 调用。平台注入 `X-WX-SOURCE`、`X-WX-OPENID`（以及可用时的 `X-WX-UNIONID`），后端据此识别用户，不要求客户端保存 JWT。`POST /auth/wechat/cloud-login` 创建或恢复业务用户。下文的 `wx.login + JWT` 仅用于旧自建服务和本地兼容模式。

## 1. 通用约定

- Base URL 由环境配置提供，路径前缀为 `/api/v1`。
- 除公共登录外，请求头携带 `Authorization: Bearer <token>`。
- 请求与响应使用 UTF-8 JSON；服务端时间使用 ISO 8601。Mock 为便于本地测试使用毫秒时间戳。
- 成功响应建议为 `{ "data": ... }`，前端也兼容直接返回业务对象。
- 错误响应为 `{ "code": "ERROR_CODE", "message": "用户可理解的信息", "details": {} }`。
- `subjectId` 必须来自当前 `GET /api/v1/catalog`；现有七学科 ID 保持兼容，但服务端允许发布新的动态学科。

公共错误码：`UNAUTHORIZED`、`FORBIDDEN`、`VALIDATION_ERROR`、`NOT_FOUND`、`NETWORK_ERROR`、`TIMEOUT`、`SERVER_ERROR`。401 时前端清除失效 Token，调用公共登录能力并保存回跳地址。

### 登录与令牌

- `POST /auth/wechat/login`：请求 `{ "code": "wx.login 临时凭证" }`，返回 `accessToken`、`refreshToken`、过期时间和用户摘要。
- `POST /auth/refresh`：请求 `{ "refreshToken": "..." }`；刷新令牌单次轮换，旧令牌再次使用返回 `401 UNAUTHORIZED`。
- `POST /auth/logout`：吊销当前刷新令牌，重复退出保持幂等。
- `GET /users/me`：返回当前业务用户摘要。
- `DELETE /users/me`：永久删除当前用户及其刷新令牌、练习、答题、错题、收藏和考试记录；成功返回 `{ "deleted": true }`。删除后既有访问令牌和刷新令牌均返回 `401 UNAUTHORIZED`。

访问令牌过期时，前端只发起一个并发刷新请求，并在刷新成功后重放原请求一次。网络失败保留现有令牌和页面选择；只有刷新明确返回 401 时才清除令牌并回到公共登录页。

开发环境允许受控 Stub OpenID；生产环境必须使用微信 `code2Session`，且 AppSecret 仅保存在服务端环境变量中。

## 2. 核心模型

### QuestionView

待答题模型禁止返回答案和解析：

```json
{
  "id": "ds001",
  "subjectId": "ds",
  "chapterId": "ds-basics",
  "chapterName": "概论与复杂度",
  "type": "single",
  "stem": "题干",
  "code": "可选只读代码",
  "images": [{ "src": "/assets/questions/ds001.png", "alt": "图示替代说明", "caption": "可选图注" }],
  "options": [{ "id": "A", "label": "A", "text": "选项" }],
  "difficulty": 2,
  "tags": ["复杂度"],
  "version": 1,
  "isFavorite": false
}
```

`images` 最多两张。未交普通答案和未交考试的题目不得包含 `correctOptionIds`、`explanation` 或任何可推导答案的字段。

### AnswerResult

```json
{
  "questionId": "ds001",
  "selectedOptionIds": ["A"],
  "correctOptionIds": ["A"],
  "isCorrect": true,
  "explanation": "解析",
  "pointsAwarded": 10,
  "unlockedAchievementKeys": ["first-step"],
  "submittedAt": "2026-07-13T08:00:00.000Z"
}
```

`pointsAwarded` 和 `unlockedAchievementKeys` 与首次成功提交一起持久化；同一幂等键重试必须返回完全相同的奖励，不得重复写积分。

### PracticeSession

```json
{
  "id": "practice-id",
  "scope": "subject",
  "subjectId": "ds",
  "subject": "ds",
  "mode": "chapter",
  "chapterId": "ds-tree",
  "status": "active",
  "answeredCount": 0,
  "totalCount": 10,
  "currentIndex": 0,
  "questions": [],
  "answers": {}
}
```

`scope` 为 `subject|all`；旧会话缺少该字段时按 `subject` 处理。全局收藏会话的 `scope="all"`，且 `subjectId` 与兼容字段 `subject` 均为 `null`。模式为 `chapter|random|wrong|favorite`，状态为 `active|completed|abandoned`。

### ExamView

```json
{
  "id": "exam-id",
  "type": "postgraduate-408-objective",
  "status": "active",
  "answeredCount": 2,
  "totalCount": 40,
  "createdAt": "2026-07-13T08:00:00.000Z",
  "expiresAt": "2026-07-13T09:00:00.000Z",
  "remainingSeconds": 3480,
  "questions": [],
  "answers": { "ds001": ["A"] }
}
```

前端显示倒计时必须每次用 `expiresAt - 当前时间` 计算，不能把 `remainingSeconds` 当作可暂停计时器。

## 3. 全局与学科接口

### GET /learning/overview

返回：`totalQuestions`、`attemptedCount`、`progressPercent`、`todayAttempts`、`totalAttempts`、`accuracy`、`unmasteredWrongCount`、`favoriteCount`、五个 `modules` 进度、可空 `activeSession` 和可空 `activeExam`。

### GET /subjects/{subjectId}/overview

返回学科题数、至少答过一次的题数、进度、累计答题、正确率、未掌握错题、收藏和仅属于该学科的可继续会话。

### GET /subjects/{subjectId}/chapters

返回章节数组，每项包含 `id`、`name`、`order`、`totalCount`、`attemptedCount`、`progressPercent` 和 `accuracy`。

## 4. 普通练习接口

### POST /practice-sessions

```json
{
  "scope": "subject",
  "subject": "ds",
  "mode": "chapter",
  "chapterId": "ds-tree",
  "count": 10
}
```

`scope` 可省略，默认 `subject`。单学科练习必须传 `subject`，`count` 只能为 5、10、20；章节模式必须传 `chapterId`，其他模式不能传 `chapterId`。创建成功后，同用户旧 active 普通会话改为 abandoned。候选不足时返回全部可用题；候选为空返回 `EMPTY_QUESTION_POOL`。

跨学科收藏重练使用：

```json
{
  "scope": "all",
  "mode": "favorite",
  "count": "all"
}
```

全局范围只允许 `mode="favorite"`，且不得传 `subject` 或 `chapterId`；`count` 可为 5、10、20 或 `"all"`。服务端从当前用户全部有效收藏中随机、不重复地建卷并保存题目快照。数字题量取指定值与收藏总数的较小值，`"all"` 取建卷时的全部收藏。

### GET /practice-sessions/{id}

返回当前会话、已提交答案反馈和待答题视图。已完成会话允许前端跳转结果页，abandoned 会话不可继续。

### POST /practice-sessions/{id}/answers

```json
{
  "questionId": "ds001",
  "selectedOptionIds": ["A"],
  "clientAnswerId": "客户端生成的全用户唯一 ID"
}
```

相同 `clientAnswerId` 重试同一道答题请求必须返回首次 `AnswerResult`，不能重复累计。同一用户把该 ID 用于其他会话或题目时返回 `IDEMPOTENCY_KEY_REUSED`。题目一旦成功提交，再用其他 ID 修改应返回 `ANSWER_ALREADY_SUBMITTED`。

### POST /practice-sessions/{id}/finish

只有全部题目均已提交时才能完成；重复完成返回同一汇总。返回 `scope`、可空 `subjectId`/`subject`、`totalCount`、`correctCount`、`wrongCount`、`accuracy`、`subjects` 和 `chapters` 表现。`subjects` 始终返回，按学科注册顺序排列；每项包含 `subjectId`、`totalCount`、`correctCount`、`wrongCount` 和 `accuracy`。章节项额外包含 `subjectId`，以避免跨学科章节标识冲突。

### GET /practice-sessions/{id}/result

仅 completed 会话可取结果；未完成返回 `SESSION_INCOMPLETE`。

## 5. 错题与收藏接口

### GET /records/wrong?subjectId={id}&mastered={true|false}

两个查询参数均可省略。返回 ReviewQuestion，包含正确答案、解析和 `wrong: { wrongCount, mastered, lastWrongAt, masteredAt }`。

### GET /records/favorites?subjectId={id}

`subjectId` 可省略以返回全局收藏。仅当用户已经作答过题目的当前版本时返回答案与解析，并标记 `answersAvailable=true`；历史遗留的未作答收藏只返回安全题面并标记 `answersAvailable=false`，不得借收藏接口提前取得待答答案。

### PUT /records/favorites/{subjectId}/{questionId}

加入收藏，重复 PUT 幂等。用户必须已经作答过题目的当前版本，否则返回 `409 QUESTION_NOT_ANSWERED`。

### DELETE /records/favorites/{subjectId}/{questionId}

取消收藏，重复 DELETE 幂等。

## 6. 408 考试接口

### POST /exams

```json
{ "type": "postgraduate-408-objective" }
```

生成 40 道单选题，分布严格为 `ds=12, co=12, os=9, network=7`，同卷不重复。若存在未到期 active 试卷，返回 `ACTIVE_EXAM_EXISTS`；题池不足返回 `EXAM_POOL_INSUFFICIENT`。

### GET /exams/{id}

返回 ExamView。`createdAt`、`updatedAt`、`expiresAt` 和 `submittedAt` 均使用 Unix 毫秒时间戳。若试卷已到期，服务端先幂等自动交卷，再返回 completed 状态。ExamView 无论状态如何均不返回正确答案和解析，完整复盘只能通过结果接口获取。

### PUT /exams/{id}/draft

```json
{
  "answers": {
    "ds001": ["A"],
    "co008": ["C"]
  }
}
```

`answers` 是当前整份草稿的原子替换，不是增量补丁：请求中省略的旧答案会被删除，空对象表示清空全部答案，同一题最多一个选项。接口可重复覆盖且不计分。若保存时已经到期，服务端幂等自动交卷并直接返回首次 ExamResult。

### POST /exams/{id}/submit

提前或自动交卷。空题计错，错误题进入所属底层学科错题本，所有 40 题计入所属学科答题统计。考试答对不会自动把旧错题标记为已掌握。并发或重复提交必须返回第一次结果且不重复计数。

### GET /exams/{id}/result

返回 `score`、`maxScore=80`、总题数、作答数、正确数、错误数、正确率、`pointsAwarded`、`unlockedAchievementKeys`、`submitReason=manual|expired`、四科 `subjects` 和逐题 `reviews`。每个 review 来自建卷时冻结的完整题目版本快照，包含用户选择、正确答案、解析和正误；后续修改题库不会改变历史报告。重复交卷及重复读取只返回持久化奖励。

### GET /exams?type=postgraduate-408-objective

按创建时间倒序返回当前用户历史摘要，包括状态、作答数、到期时间和已完成分数。

## 7. 积分、排行与成就接口

### GET /gamification/me

返回公开身份、总积分、今日/本周积分、日/周/总榜当前排名、不同题作答/答对数、佩戴称号及成就解锁数量。默认身份格式为 `刷题者#A7K9`；公开编号稳定且不暴露内部用户 ID。

### PUT /gamification/profile

```json
{ "displayName": "每日一练" }
```

昵称先执行 NFKC 规范化，只接受 2–12 位中文、字母、数字和下划线，并过滤联系方式、系统保留词和内置敏感词。首次设置立即生效，此后 30 天内再次修改返回 `NICKNAME_COOLDOWN`。

### GET /gamification/leaderboard?period=daily|weekly|all&limit=100

日榜按北京时间自然日，周榜按北京时间周一 00:00 起算，总榜统计全部积分流水。同分依次按达到当前积分的时间和公开编号排序。响应包含 `podium`（前三名）、`rankings`（第 4–100 名）及不受 `limit` 影响的 `currentUser`；排行项只包含排名、积分、昵称、公开编号和佩戴称号。

### GET /gamification/achievements

返回固定 12 个成就的条件、当前进度、稀有度、解锁时间和佩戴状态。成就一旦解锁不回收。

### PUT /gamification/equipped-title

```json
{ "achievementKey": "first-step" }
```

只能佩戴已解锁称号；传 `null` 取消佩戴。

积分规则：首次作答同一题 `+2`，首次答对同一题额外 `+8`；已经答对过的题目再次答对，每道题每天最多 `+1` 复习分，且每天最多 20 道不同题。普通练习与 408 共用题目掌握状态和积分账户。

## 8. 关键业务错误码

- 普通练习：`SUBJECT_NOT_FOUND`、`SUBJECT_REQUIRED`、`INVALID_SCOPE`、`INVALID_GLOBAL_SESSION`、`INVALID_MODE`、`INVALID_COUNT`、`CHAPTER_REQUIRED`、`CHAPTER_NOT_ALLOWED`、`EMPTY_QUESTION_POOL`、`SESSION_NOT_FOUND`、`SESSION_FINISHED`、`SESSION_INCOMPLETE`、`ANSWER_REQUIRED`、`INVALID_OPTION`、`ANSWER_ALREADY_SUBMITTED`。
- 记录：`QUESTION_NOT_FOUND`。
- 考试：`INVALID_EXAM_TYPE`、`ACTIVE_EXAM_EXISTS`、`EXAM_POOL_INSUFFICIENT`、`EXAM_NOT_FOUND`、`EXAM_FINISHED`、`EXAM_INCOMPLETE`、`QUESTION_NOT_IN_EXAM`、`INVALID_OPTION`。
- 积分与成就：`INVALID_LEADERBOARD_PERIOD`、`INVALID_DISPLAY_NAME`、`RESERVED_DISPLAY_NAME`、`UNSAFE_DISPLAY_NAME`、`NICKNAME_COOLDOWN`、`ACHIEVEMENT_NOT_FOUND`、`ACHIEVEMENT_LOCKED`。
# 动态题库补充

## 公开目录

`GET /api/v1/catalog` 返回当前发布哈希、动态模块、学科展示配置、题量、章节数及当前发布中的章节目录。目录正文与 `version` 均来自同一不可变发布投影；后台尚未发布的学科、章节或展示配置不会提前出现在公开接口。客户端不得再把七学科或 500 题作为正式运行时常量。

## 判别式答案

原有 `selectedOptionIds` 继续兼容。新客户端优先发送：

```json
{ "questionId": "q_xxx", "clientAnswerId": "unique-id", "answer": { "kind": "choice", "optionIds": ["A"] } }
```

```json
{ "questionId": "q_xxx", "clientAnswerId": "unique-id", "answer": { "kind": "fill", "values": ["答案一", "答案二"] } }
```

```json
{ "questionId": "q_xxx", "clientAnswerId": "unique-id", "answer": { "kind": "short", "value": "用户简答" } }
```

简答提交后响应 `evaluationRequired=true` 并展示参考答案，再调用 `POST /api/v1/practice-sessions/:id/answers/:questionId/self-assessment`，请求体为 `{ "assessment": "mastered" | "unmastered" }`。待答题响应绝不返回 `correctOptionIds`、`acceptedAnswers`、`referenceAnswer` 或 `explanation`。

管理 API 统一位于 `/api/v1/admin/*`，只供同源 `/admin/` 后台使用。登录后使用 HttpOnly 管理会话 Cookie；所有写请求还必须携带登录响应中的 CSRF Token。管理响应禁止缓存，密码、一次性启动令牌和 TOTP 不得进入日志或审计正文。完整流程、环境变量和接口用途见 `docs/QUESTION_BANK_MANAGEMENT.md`。

目录变更集或 Excel 学科行可携带 `qualityPolicy`，规范结构为 `{ questionTypes?, difficulties?, chapters? }`，各目标项仅允许整数 `min`/`max`。未知字段、跨学科/停用章节引用或非法范围会阻止提交。`GET /api/v1/admin/releases` 的每条记录包含不可变的 `qualityWarnings` 和 `qualitySummary`，分别记录候选发布的普通质量偏差及逐学科策略/实际计数；这些警告不阻止发布，结构与 408 题池约束仍会阻断。

## 管理端目录、导入与发布

- 目录调整必须通过 `POST /api/v1/admin/catalog-drafts` 创建完整目录变更集，使用带 `revision` 的 PATCH 更新，随后提交复核。旧学科、章节和首页模块直写接口固定返回 `CATALOG_DRAFT_REQUIRED`。
- Excel 批次通过 `POST /api/v1/admin/imports/:id/submit` 冻结内容哈希，再调用 `POST /api/v1/admin/imports/:id/review` 整批批准或驳回；导入题目不能绕过批次单独提交或复核。只包含学科/章节的目录型工作簿同样支持该流程。
- `ADMIN_REVIEW_POLICY=two-person` 时提交人不得复核自己的目录、题目或导入批次；`single-owner` 时只有同时具有 `OWNER` 权限的提交人可以自审。自审批准必须提交 `checklist` 和非空 `selfReviewNote`，返回及审计记录中的 `reviewMode` 为 `SELF_APPROVED`；独立复核为 `INDEPENDENT`。
- 处于 `IN_REVIEW` 的目录、题目和导入批次，可由原提交人分别调用 `POST /api/v1/admin/catalog-drafts/:id/withdraw`、`POST /api/v1/admin/drafts/:id/withdraw`、`POST /api/v1/admin/imports/:id/withdraw` 撤回。目录/题目回到 `DRAFT`，导入批次回到 `VALID`；批准后再修改会使既有批准失效，必须重新提交。
- 发布先调用 `POST /api/v1/admin/releases/preview`，再把预览返回的 `candidateHash`、`confirmationText` 与当前 `confirmationTotp` 原样提交给 `POST /api/v1/admin/releases`。目录变更集、题目草稿和 Excel 目录批次在同一事务中生效，任一内容哈希、revision、复核记录或活动基线不一致都会阻止发布。
- 发布切换后立即执行快照、目录投影、题目版本、题型内容、媒体和 408 题池自检。失败时返回 `RELEASE_VERIFICATION_FAILED` 并冻结新发布；所有者可调用 `POST /api/v1/admin/releases/:id/retry-verification`，回滚接口在冻结期间仍可用。
- `GET /api/v1/admin/questions`、`/drafts`、`/catalog-drafts`、`/imports`、`/releases`、`/media` 和 `/audit-logs` 使用 `page`/`pageSize` 分页；列表响应统一包含 `{ page, pageSize, total, items }`。题目列表还支持 `search`、`subjectId`、`chapterId`、`type`、`difficulty`、`status`、`publishedFrom` 和 `publishedTo`。

## 管理员首次建号与认证

`ADMIN_ENABLED=true`、数据库中不存在管理员且设置了 `ADMIN_BOOTSTRAP_TOKEN_HASH` 时，才开放一次性网页初始化；任一条件不满足时以下 setup 接口统一返回 404。原始启动令牌至少 32 字节，只在操作者本地保存，服务端配置和数据库只使用其 SHA-256。

- `GET /api/v1/admin/setup/status`：可初始化时返回 `{ "data": { "available": true } }`；完成首次建号后永久返回 404。
- `POST /api/v1/admin/setup/prepare`：请求 `{ "bootstrapToken": "...", "username": "owner" }`。成功返回有效期 10 分钟的 `setupToken`、`totpSecret`、`totpUri`、`qrCodeDataUrl` 和 `expiresAt`；令牌错误返回 `ADMIN_BOOTSTRAP_TOKEN_INVALID`。
- `POST /api/v1/admin/setup/complete`：请求 `{ "bootstrapToken", "setupToken", "username", "displayName", "password", "totp" }`。密码至少 12 位，`totp` 为 6 位；成功原子创建具有 `OWNER/EDITOR/REVIEWER/PUBLISHER` 全部权限的首个账号和一次性完成标记，返回 `{ user, completed: true }`。并发重复初始化或初始化完成后返回 404。
- `POST /api/v1/admin/auth/login`：请求 `{ username, password, totp }`，成功设置安全会话 Cookie，并返回 `{ user, csrfToken, expiresAt }`。
- `GET /api/v1/admin/auth/me`：返回当前管理员摘要、兼容字段 `user` 和 `reviewPolicy: "two-person" | "single-owner"`。
- `POST /api/v1/admin/auth/logout`：撤销当前会话并返回 `{ "loggedOut": true }`。

## 自审、导入报告与高风险确认

三类复核接口的批准请求结构相同：

```json
{
  "decision": "APPROVED",
  "comment": "可选的普通复核说明",
  "checklist": ["DIFF", "CONTENT", "WARNINGS"],
  "selfReviewNote": "单所有者模式下的自检说明"
}
```

`single-owner` 自审时三个检查项必须齐全且说明不少于 4 个规范化字符；`two-person` 独立复核无需 `selfReviewNote`。驳回仍使用 `decision="REJECTED"` 和原因说明。

- `GET /api/v1/admin/imports/:id/rows?page=1&pageSize=50&status=error&entityType=question` 返回 `{ page, pageSize, total, items }`。`pageSize` 最大 200；`status` 为 `all|error|warning|valid`，`entityType` 可省略。
- `GET /api/v1/admin/imports/:id/report.xlsx` 下载包含实体类型、行号、状态、错误、警告和原始数据的完整校验报告。
- `POST /api/v1/admin/releases/preview` 的选择请求为 `{ name, draftIds, catalogDraftId?, importBatchIds? }`，返回 `{ candidateHash, confirmationText, summary, name }`；`summary` 包含新增、修订、停用、目录变化、导入批次数和质量警告数。
- `POST /api/v1/admin/releases` 请求为 `{ name, draftIds, catalogDraftId?, importBatchIds?, candidateHash, confirmationText, confirmationTotp }`。候选已变化返回 `409 RELEASE_CANDIDATE_STALE`；缺少动态码返回 `ADMIN_STEP_UP_REQUIRED`。
- `POST /api/v1/admin/releases/:id/rollback/preview` 返回目标版本摘要、`candidateHash` 和 `confirmationText`；随后调用 `POST /api/v1/admin/releases/:id/rollback`，请求 `{ candidateHash, confirmationText, confirmationTotp }`。活动版本或目标快照发生变化时返回 `409 ROLLBACK_CANDIDATE_STALE`。
- 发布/回滚 TOTP 失败计数会持久化到数据库；达到失败阈值后当前管理会话立即被撤销。客户端必须重新登录，不得自动重放高风险操作。
