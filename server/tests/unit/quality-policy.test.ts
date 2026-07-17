import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSubjectQualityPolicies,
  normalizeSubjectQualityPolicy,
  QualityPolicyValidationError
} from "../../src/domain/quality-policy.js";

describe("学科质量目标", () => {
  it("严格规范化题型、难度和章节计数目标", () => {
    assert.deepEqual(normalizeSubjectQualityPolicy({
      questionTypes: { single: { min: 10, max: 20 }, FILL_BLANK: { min: 2 } },
      difficulties: { "1": { min: 3 }, "3": { max: 8 } },
      chapters: { "CPP-BASIC": { min: 5, max: 50 } }
    }), {
      questionTypes: { SINGLE: { min: 10, max: 20 }, FILL_BLANK: { min: 2 } },
      difficulties: { "1": { min: 3 }, "3": { max: 8 } },
      chapters: { "cpp-basic": { min: 5, max: 50 } }
    });
    assert.equal(normalizeSubjectQualityPolicy({}), null);
  });

  it("拒绝未知字段和非法范围", () => {
    assert.throws(
      () => normalizeSubjectQualityPolicy({ unknown: {} }),
      (error) => error instanceof QualityPolicyValidationError && /未知字段/.test(error.message)
    );
    assert.throws(() => normalizeSubjectQualityPolicy({ questionTypes: { PROGRAMMING: { min: 1 } } }), /未知题型/);
    assert.throws(() => normalizeSubjectQualityPolicy({ difficulties: { "4": { min: 1 } } }), /未知难度/);
    assert.throws(() => normalizeSubjectQualityPolicy({ chapters: { "cpp-basic": { min: 4, max: 3 } } }), /不能大于/);
    assert.throws(() => normalizeSubjectQualityPolicy({ chapters: { "cpp-basic": { target: 3 } } }), /未知字段/);
    assert.throws(() => normalizeSubjectQualityPolicy({ chapters: { "非法 章节": { min: 1 } } }), /非法章节/);
  });

  it("目标偏差生成结构化警告但保留完整计数摘要", () => {
    const report = evaluateSubjectQualityPolicies([{
      id: "cpp",
      name: "C/C++",
      qualityPolicy: {
        questionTypes: { SINGLE: { min: 2 }, MULTIPLE: { max: 0 } },
        difficulties: { "1": { min: 1 } },
        chapters: { "cpp-basic": { min: 2 } }
      }
    }, { id: "db", name: "数据库", qualityPolicy: null }], [{
      subjectId: "cpp", type: "SINGLE", difficulty: 1, chapterId: "cpp-basic"
    }]);

    assert.equal(report.configuredSubjectCount, 1);
    assert.equal(report.warningCount, 2);
    assert.deepEqual(report.warnings.map((warning) => [warning.dimension, warning.key, warning.actual]), [
      ["questionTypes", "SINGLE", 1],
      ["chapters", "cpp-basic", 1]
    ]);
    assert.equal(report.subjects[0]?.metrics.questionTypes.MULTIPLE?.status, "PASS");
    assert.equal(report.subjects[0]?.metrics.difficulties["1"]?.status, "PASS");
  });
});
