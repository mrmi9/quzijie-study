import test from "node:test";
import assert from "node:assert/strict";
import {
  addAcceptedAnswerGroup,
  addQuestionOption,
  applyAdvancedQuestionJson,
  buildQuestionPreview,
  createQuestionEditorState,
  enforceQuestionType,
  questionStateFromApiPayload,
  questionStateToApiPayload,
  removeQuestionOption,
  serializeAdvancedQuestionJson,
  toggleCorrectOption,
  updateAcceptedAnswerGroup,
  validateQuestionEditorState
} from "../src/question-editor-model.ts";

function base(type) {
  return createQuestionEditorState({
    subjectId: "network",
    chapterId: "network-http",
    type,
    stem: "HTTP 默认端口是什么？",
    explanation: "HTTP 明文服务的默认端口是 80。",
    difficulty: 1,
    tags: ["HTTP"]
  });
}

test("single choice state round-trips through the API payload", () => {
  let state = base("SINGLE");
  state = toggleCorrectOption({ ...state, options: state.options.map((item, index) => ({ ...item, text: String(80 + index) })) }, "A");
  state = { ...state, includeIn408: true, images: [{ src: "https://example.test/http.png", alt: "HTTP 请求示意图" }] };
  const payload = questionStateToApiPayload(state);
  assert.deepEqual(payload.examScopes, ["408"]);
  assert.deepEqual(payload.correctOptionIds, ["A"]);
  assert.deepEqual(payload.images, [{ src: "https://example.test/http.png", alt: "HTTP 请求示意图" }]);
  assert.deepEqual(questionStateToApiPayload(questionStateFromApiPayload(payload)), payload);
  assert.equal(validateQuestionEditorState(state).valid, true);
});

test("multiple choice keeps several correct options and clears removed answers", () => {
  let state = base("MULTIPLE");
  state = { ...state, options: state.options.map((item) => ({ ...item, text: `选项 ${item.id}` })) };
  state = toggleCorrectOption(toggleCorrectOption(state, "A"), "C");
  assert.deepEqual(state.correctOptionIds, ["A", "C"]);
  state = removeQuestionOption(state, "C");
  assert.deepEqual(state.correctOptionIds, ["A"]);
  assert.match(validateQuestionEditorState(state).errors.join("；"), /至少需要两个正确选项/);
  assert.equal(addQuestionOption(state).options.length, 4);
});

test("judge type has fixed correct/error options", () => {
  let state = enforceQuestionType(base("SINGLE"), "JUDGE");
  state = toggleCorrectOption(state, "B");
  assert.deepEqual(state.options.map((item) => item.text), ["正确", "错误"]);
  assert.deepEqual(state.correctOptionIds, ["B"]);
  assert.equal(questionStateToApiPayload(state).type, "JUDGE");
});

test("fill blank state maps answer groups and sensitivity config", () => {
  let state = base("FILL_BLANK");
  state = addAcceptedAnswerGroup(addAcceptedAnswerGroup(state));
  state = updateAcceptedAnswerGroup(updateAcceptedAnswerGroup(state, 0, ["80", "八十"]), 1, ["HTTP"]);
  state = { ...state, answerConfig: { caseSensitive: true, punctuationSensitive: false } };
  const payload = questionStateToApiPayload(state);
  assert.deepEqual(payload.acceptedAnswers, [["80", "八十"], ["HTTP"]]);
  assert.equal(payload.options.length, 0);
  assert.equal(validateQuestionEditorState(state).valid, true);
  assert.match(buildQuestionPreview(state).answerSummary, /第 2 空：HTTP/);
});

test("short answer maps the reference answer and preview", () => {
  const state = { ...base("SHORT_ANSWER"), referenceAnswer: "客户端向服务端发送请求并接收响应。" };
  const payload = questionStateToApiPayload(state);
  assert.equal(payload.referenceAnswer, "客户端向服务端发送请求并接收响应。");
  assert.deepEqual(payload.correctOptionIds, []);
  const preview = buildQuestionPreview(state);
  assert.equal(preview.typeLabel, "简答题");
  assert.equal(preview.answerSummary, payload.referenceAnswer);
  assert.equal(validateQuestionEditorState(state).valid, true);
});

test("advanced JSON changes nothing until it validates and applies", () => {
  let state = base("SINGLE");
  state = toggleCorrectOption({ ...state, options: state.options.map((item) => ({ ...item, text: `选项 ${item.id}` })) }, "A");
  const text = serializeAdvancedQuestionJson(state);
  const parsed = JSON.parse(text);
  parsed.stem = "修改后的题干内容";
  const applied = applyAdvancedQuestionJson(JSON.stringify(parsed));
  assert.equal(applied.ok, true);
  assert.equal(applied.ok && applied.state.stem, "修改后的题干内容");
  assert.equal(state.stem, "HTTP 默认端口是什么？");

  const syntaxError = applyAdvancedQuestionJson("{");
  assert.equal(syntaxError.ok, false);
  assert.match(syntaxError.errors[0], /JSON 格式错误/);
  const schemaError = applyAdvancedQuestionJson(JSON.stringify({ ...parsed, type: "PROGRAMMING" }));
  assert.equal(schemaError.ok, false);
  assert.match(schemaError.errors.join("；"), /type 必须是/);

  const lossyShape = applyAdvancedQuestionJson(JSON.stringify({ ...parsed, tags: "HTTP", extra: true }));
  assert.equal(lossyShape.ok, false);
  assert.match(lossyShape.errors.join("；"), /未知字段/);
  assert.match(lossyShape.errors.join("；"), /tags 必须是数组/);
});

test("preview exposes correct flags without changing editor state", () => {
  let state = base("SINGLE");
  state = toggleCorrectOption({ ...state, options: state.options.map((item) => ({ ...item, text: `选项 ${item.id}` })) }, "B");
  const preview = buildQuestionPreview(state);
  assert.equal(preview.options.find((item) => item.id === "B").correct, true);
  assert.equal(preview.includeIn408, false);
  assert.deepEqual(state.correctOptionIds, ["B"]);
});
