# 趣字节刷题通用 API 契约 v2

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
  "submittedAt": "2026-07-13T08:00:00.000Z"
}
```

### PracticeSession

```json
{
  "id": "practice-id",
  "subjectId": "ds",
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

模式为 `chapter|random|wrong|favorite`，状态为 `active|completed|abandoned`。

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
  "subject": "ds",
  "mode": "chapter",
  "chapterId": "ds-tree",
  "count": 10
}
```

`count` 只能为 5、10、20。章节模式必须有 `chapterId`。创建成功后，同用户旧 active 普通会话改为 abandoned。候选不足时返回全部可用题；候选为空返回 `EMPTY_QUESTION_POOL`。

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

只有全部题目均已提交时才能完成；重复完成返回同一汇总。返回 `totalCount`、`correctCount`、`wrongCount`、`accuracy` 和 `chapters` 表现。

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

返回 `score`、`maxScore=80`、总题数、作答数、正确数、错误数、正确率、`submitReason=manual|expired`、四科 `subjects` 和逐题 `reviews`。每个 review 来自建卷时冻结的完整题目版本快照，包含用户选择、正确答案、解析和正误；后续修改题库不会改变历史报告。

### GET /exams?type=postgraduate-408-objective

按创建时间倒序返回当前用户历史摘要，包括状态、作答数、到期时间和已完成分数。

## 7. 关键业务错误码

- 普通练习：`SUBJECT_NOT_FOUND`、`INVALID_MODE`、`INVALID_COUNT`、`CHAPTER_REQUIRED`、`EMPTY_QUESTION_POOL`、`SESSION_NOT_FOUND`、`SESSION_FINISHED`、`SESSION_INCOMPLETE`、`ANSWER_REQUIRED`、`INVALID_OPTION`、`ANSWER_ALREADY_SUBMITTED`。
- 记录：`QUESTION_NOT_FOUND`。
- 考试：`INVALID_EXAM_TYPE`、`ACTIVE_EXAM_EXISTS`、`EXAM_POOL_INSUFFICIENT`、`EXAM_NOT_FOUND`、`EXAM_FINISHED`、`EXAM_INCOMPLETE`、`QUESTION_NOT_IN_EXAM`、`INVALID_OPTION`。
