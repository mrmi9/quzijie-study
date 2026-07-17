import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAdvancedQualityPolicyJson,
  createQualityPolicyEditorState,
  qualityPolicyStateFromJson,
  qualityPolicyStateToJson,
  removeQualityTarget,
  serializeAdvancedQualityPolicyJson,
  upsertQualityTarget,
  validateQualityPolicyEditorState
} from "../src/quality-policy-editor-model.ts";

test("quality targets round-trip between structured state and JSON", () => {
  const policy = {
    questionTypes: { SINGLE: { min: 20, max: 200 }, FILL_BLANK: { min: 5 } },
    difficulties: { 1: { min: 10 }, 3: { max: 50 } },
    chapters: { "network-http": { min: 8, max: 80 } }
  };
  const state = qualityPolicyStateFromJson(policy);
  assert.deepEqual(qualityPolicyStateToJson(state), policy);
  assert.deepEqual(JSON.parse(serializeAdvancedQualityPolicyJson(state)), policy);
});

test("empty structured state serializes to null", () => {
  const state = createQualityPolicyEditorState();
  assert.equal(validateQualityPolicyEditorState(state).valid, true);
  assert.equal(qualityPolicyStateToJson(state), null);
  assert.equal(serializeAdvancedQualityPolicyJson(state), "null");
});

test("structured updates normalize keys and remove targets", () => {
  let state = createQualityPolicyEditorState();
  state = upsertQualityTarget(state, "questionTypes", "single", { min: 5 });
  state = upsertQualityTarget(state, "chapters", " Network-HTTP ", { min: 2, max: 30 });
  assert.deepEqual(qualityPolicyStateToJson(state), {
    questionTypes: { SINGLE: { min: 5 } },
    chapters: { "network-http": { min: 2, max: 30 } }
  });
  state = removeQualityTarget(state, "questionTypes", "SINGLE");
  assert.deepEqual(qualityPolicyStateToJson(state), { chapters: { "network-http": { min: 2, max: 30 } } });
});

test("quality validation rejects duplicate, invalid and inverted targets", () => {
  const state = createQualityPolicyEditorState({
    questionTypes: { UNKNOWN: { min: 1 } },
    difficulties: { 4: { min: 1 } },
    chapters: { "bad chapter": { min: 10, max: 2 } }
  });
  const validation = validateQualityPolicyEditorState(state);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("；"), /不是支持的题型/);
  assert.match(validation.errors.join("；"), /不是支持的难度/);
  assert.match(validation.errors.join("；"), /合法章节 ID/);
  assert.match(validation.errors.join("；"), /最小值不能大于最大值/);
});

test("advanced policy JSON reports syntax and unknown-field errors", () => {
  assert.equal(applyAdvancedQualityPolicyJson("{").ok, false);
  const unknown = applyAdvancedQualityPolicyJson('{"total":{"min":1}}');
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join("；"), /未知字段/);
  const wrongShape = applyAdvancedQualityPolicyJson('{"questionTypes":[]}');
  assert.equal(wrongShape.ok, false);
  assert.match(wrongShape.errors.join("；"), /必须是 JSON 对象/);

  const valid = applyAdvancedQualityPolicyJson('{"questionTypes":{"single":{"min":2}}}');
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok && valid.policy, { questionTypes: { SINGLE: { min: 2 } } });
});

test("advanced null or blank clears the quality policy", () => {
  for (const text of ["", "null"]) {
    const result = applyAdvancedQualityPolicyJson(text);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.policy, null);
  }
});
