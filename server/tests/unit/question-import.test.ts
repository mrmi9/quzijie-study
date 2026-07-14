import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { readQuestionSources } from "../../src/scripts/import-questions.js";

const contentDirectory = fileURLToPath(new URL("../../../../content", import.meta.url));

describe("题库导入源", () => {
  it("包含 500 道全局唯一且分科数量正确的题目", async () => {
    const questions = await readQuestionSources(contentDirectory);
    const ids = new Set(questions.map((question) => question.id));
    const counts = questions.reduce<Record<string, number>>((result, question) => {
      result[question.subjectId] = (result[question.subjectId] || 0) + 1;
      return result;
    }, {});

    assert.equal(questions.length, 500);
    assert.equal(ids.size, 500);
    assert.deepEqual(counts, {
      cpp: 100,
      linux: 50,
      os: 50,
      ds: 100,
      network: 50,
      stl: 50,
      co: 100
    });
  });
});
