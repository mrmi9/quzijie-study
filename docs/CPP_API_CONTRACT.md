# C/C++ 模块 API 契约 v1

> 历史兼容文档：当前全模块接口以 `API_CONTRACT.md` v2 为准；本文仅保留用于核对旧 C/C++ 接口迁移。

## 1. 通用约定

- Base URL 由环境配置提供，接口前缀为 `/api/v1`。
- 除公共登录接口外，请求头携带 `Authorization: Bearer <token>`。
- 请求和响应使用 UTF-8 JSON，时间字段使用 ISO 8601 字符串；Mock 中使用毫秒时间戳仅用于本地演示。
- 成功响应统一为 `{ "data": ... }`，前端请求层也兼容直接返回业务对象。
- 错误响应统一为 `{ "code": "ERROR_CODE", "message": "用户可理解的信息", "details": {} }`。
- 提交答案必须携带客户端生成且在该用户范围内唯一的 `clientAnswerId`；相同 ID 重试返回第一次结果，不重复计分。

## 2. 核心模型

### QuestionView

待答题目只允许返回：

```json
{
  "id": "cpp001",
  "chapterId": "c-basics",
  "chapterName": "C 基础与运算",
  "type": "single",
  "stem": "题干",
  "code": "可选代码字符串",
  "options": [{ "id": "A", "label": "A", "text": "选项" }],
  "difficulty": 1,
  "tags": ["标识符"],
  "version": 1,
  "isFavorite": false
}
```

该模型禁止包含 `correctOptionIds` 和 `explanation`。

### AnswerResult

```json
{
  "questionId": "cpp001",
  "selectedOptionIds": ["C"],
  "correctOptionIds": ["C"],
  "isCorrect": true,
  "explanation": "答案解析",
  "submittedAt": "2026-07-13T08:00:00.000Z"
}
```

### PracticeSession

```json
{
  "id": "session-id",
  "subject": "cpp",
  "mode": "chapter",
  "chapterId": "c-basics",
  "status": "active",
  "answeredCount": 0,
  "totalCount": 10,
  "currentIndex": 0,
  "questions": [],
  "answers": {}
}
```

状态取值为 `active`、`completed` 或 `abandoned`；模式取值为 `chapter`、`random`、`wrong` 或 `favorite`。

## 3. 接口定义

### GET /subjects/cpp/overview

返回 `totalQuestions`、`attemptedCount`、`progressPercent`、`totalAttempts`、`accuracy`、`unmasteredWrongCount`、`favoriteCount` 和可空的 `activeSession`。

### GET /subjects/cpp/chapters

返回章节数组。每章包含 `id`、`name`、`order`、`totalCount`、`attemptedCount`、`progressPercent` 和 `accuracy`。

### POST /practice-sessions

请求：

```json
{
  "subject": "cpp",
  "mode": "chapter",
  "chapterId": "c-basics",
  "count": 10
}
```

`chapterId` 只在章节模式必填。`count` 只接受 5、10、20；可用题不足时实际 `totalCount` 小于请求值。创建成功返回 PracticeSession。

### GET /practice-sessions/{sessionId}

恢复会话并返回 PracticeSession。已提交题目的 `answers` 可包含 AnswerResult，未提交题目仍不得泄露答案。

### POST /practice-sessions/{sessionId}/answers

请求：

```json
{
  "questionId": "cpp001",
  "selectedOptionIds": ["C"],
  "clientAnswerId": "uuid-or-equivalent"
}
```

成功返回 AnswerResult。第一次成功提交后，同一题不能使用新的 `clientAnswerId` 修改答案。

### POST /practice-sessions/{sessionId}/finish

所有题目已提交后完成会话并返回结果。重复调用已完成会话必须幂等返回同一结果；题目未完成时返回 `SESSION_INCOMPLETE`。

### GET /practice-sessions/{sessionId}/result

返回 `sessionId`、`mode`、`status`、`totalCount`、`correctCount`、`wrongCount`、`accuracy` 和分章节统计 `chapters`。

### GET /users/me/wrong-questions?subject=cpp&mastered=true|false

`mastered` 可省略表示全部。返回可复盘题目以及 `wrongCount`、`mastered`、`lastWrongAt`、`masteredAt`。复盘列表允许返回答案和解析。

### GET /users/me/favorites?subject=cpp

返回用户收藏的可复盘题目列表。

### PUT|DELETE /users/me/favorites/{questionId}

PUT 收藏，DELETE 取消收藏。重复执行相同目标状态必须幂等。

## 4. 错误码

- `UNAUTHORIZED`：Token 缺失或失效，对应 HTTP 401。
- `SESSION_NOT_FOUND`：会话不存在或不属于当前用户，对应 404。
- `SESSION_FINISHED`：已结束会话不接受新答案，对应 409。
- `SESSION_INCOMPLETE`：尚有题目未提交，对应 409。
- `ANSWER_ALREADY_SUBMITTED`：同一题尝试修改已提交答案，对应 409。
- `ANSWER_REQUIRED`、`INVALID_OPTION`、`INVALID_COUNT`、`INVALID_MODE`、`CHAPTER_REQUIRED`：请求校验失败，对应 400。
- `EMPTY_QUESTION_POOL`：筛选后无可用题，对应 422。
- `REQUEST_TIMEOUT`、`NETWORK_ERROR`：由前端请求层生成的网络错误。

## 5. 后端一致性要求

- 创建会话、提交答案、更新错题、更新进度应在事务或等效原子边界内完成。
- 服务端负责抽题和判题，不信任前端传入的题目答案、正确性或得分。
- `clientAnswerId` 至少在“用户 + 会话”范围内建立唯一约束。
- 只有错题模式中的正确提交可把既有错题标记为 mastered；任意模式错误提交都会标记为未掌握。
- 完成会话后结果保持不可变，重复 finish 不得重复累计统计。
