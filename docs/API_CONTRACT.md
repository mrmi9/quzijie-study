# 趣字节刷题通用 API 契约 v2

> 微信云托管生产模式通过 `wx.cloud.callContainer` 调用。平台注入 `X-WX-SOURCE`、`X-WX-OPENID`（以及可用时的 `X-WX-UNIONID`），后端据此识别用户，不要求客户端保存 JWT。`POST /auth/wechat/cloud-login` 创建或恢复业务用户。下文的 `wx.login + JWT` 仅用于旧自建服务和本地兼容模式。

## 1. 通用约定

- Base URL 由环境配置提供，路径前缀为 `/api/v1`。
- 除公共登录外，请求头携带 `Authorization: Bearer <token>`。
- 请求与响应使用 UTF-8 JSON；服务端时间使用 ISO 8601。Mock 为便于本地测试使用毫秒时间戳。
- 成功响应建议为 `{ "data": ... }`，前端也兼容直接返回业务对象。
- 错误响应为 `{ "code": "ERROR_CODE", "message": "用户可理解的信息", "details": {} }`。
- `subjectId` 只能为 `cpp|linux|os|ds|network|stl|co`。

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

`subjectId` 可省略以返回全局收藏。返回带答案与解析的复习视图。

### PUT /records/favorites/{subjectId}/{questionId}

加入收藏，重复 PUT 幂等。

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
