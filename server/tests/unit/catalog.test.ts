import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPublicCatalog } from "../../src/services/catalog.js";
import { canCancelCatalogDraftStatus, catalogPayloadHash, normalizeCatalogDraftPayload, validateCatalogDraftPayload } from "../../src/services/question-bank.js";

describe("发布目录投影", () => {
  it("只公开活动发布中有题目的学科、章节和非空模块", () => {
    const catalog = buildPublicCatalog({
      modules: [
        { id: "main", name: "主模块", subtitle: null, color: "#2563eb", type: "GROUP", order: 1, active: true, subjects: [{ subjectId: "alpha", order: 0 }, { subjectId: "empty", order: 1 }] },
        { id: "hidden", name: "隐藏模块", subtitle: null, color: "#999999", type: "SUBJECT", order: 2, active: false, subjects: [{ subjectId: "alpha", order: 0 }] }
      ],
      subjects: [
        { id: "alpha", name: "学科甲", shortName: "甲", color: "#2563eb", description: null, iconKey: null, order: 1, active: true },
        { id: "empty", name: "空学科", shortName: "空", color: "#64748b", description: null, iconKey: null, order: 2, active: true }
      ],
      chapters: [
        { id: "alpha-1", subjectId: "alpha", name: "第一章", order: 1, description: null, active: true },
        { id: "alpha-off", subjectId: "alpha", name: "停用章", order: 2, description: null, active: false }
      ],
      questions: [{ subjectId: "alpha", status: "ACTIVE" }, { subjectId: "alpha", status: "DISABLED" }]
    }, "sha256-version");

    assert.equal(catalog.version, "sha256-version");
    assert.deepEqual(catalog.modules.map((module) => module.id), ["main"]);
    assert.deepEqual(catalog.modules[0]?.subjects.map((subject) => [subject.id, subject.totalQuestions]), [["alpha", 1]]);
    assert.deepEqual(catalog.chapters.map((chapter) => chapter.id), ["alpha-1"]);
  });

  it("可投影十万题容量且不生成重复题目内容", () => {
    const questions = Array.from({ length: 100_000 }, () => ({ subjectId: "scale", status: "ACTIVE" }));
    const catalog = buildPublicCatalog({
      modules: [{ id: "scale", name: "容量验证", subtitle: null, color: "#2563eb", type: "SUBJECT", order: 1, active: true, subjects: [{ subjectId: "scale", order: 0 }] }],
      subjects: [{ id: "scale", name: "容量验证", shortName: "容量", color: "#2563eb", description: null, iconKey: null, order: 1, active: true }],
      chapters: [{ id: "scale-1", subjectId: "scale", name: "第一章", order: 1, description: null, active: true }],
      questions
    }, "capacity");
    assert.equal(catalog.modules[0]?.subjects[0]?.totalQuestions, 100_000);
  });
});

describe("目录变更集", () => {
  const payload = {
    modules: [{ id: "main", name: "主模块", subtitle: null, color: "#2563eb", type: "GROUP", order: 1, active: true, subjects: [{ subjectId: "alpha", order: 0 }] }],
    subjects: [{ id: "alpha", name: "学科甲", shortName: "甲", order: 1, color: "#2563eb", description: null, iconKey: null, qualityPolicy: null, active: true }],
    chapters: [{ id: "alpha-1", subjectId: "alpha", name: "第一章", order: 1, active: true, description: null }]
  };

  it("规范化完整候选目录并生成稳定哈希", () => {
    const normalized = normalizeCatalogDraftPayload(payload);
    const reordered = normalizeCatalogDraftPayload({
      chapters: [...payload.chapters].reverse(),
      subjects: [...payload.subjects].reverse(),
      modules: [...payload.modules].reverse()
    });
    assert.deepEqual(normalized, reordered);
    assert.equal(catalogPayloadHash(normalized), catalogPayloadHash(reordered));
    assert.notEqual(catalogPayloadHash(normalized), catalogPayloadHash({ ...normalized, subjects: normalized.subjects.map((subject) => ({ ...subject, name: "改名后" })) }));
    assert.deepEqual(validateCatalogDraftPayload(normalized), { errors: [], warnings: [] });
  });

  it("阻止重复顺序和无效引用进入复核", () => {
    const invalid = normalizeCatalogDraftPayload({
      ...payload,
      subjects: [...payload.subjects, { ...payload.subjects[0], id: "beta", name: "学科乙" }],
      chapters: [{ ...payload.chapters[0], subjectId: "missing" }]
    });
    const validation = validateCatalogDraftPayload(invalid);
    assert(validation.errors.some((error) => error.includes("学科顺序重复")));
    assert(validation.errors.some((error) => error.includes("不存在的学科")));
    assert(validation.warnings.some((warning) => warning.includes("beta")));
  });

  it("阻止活动子项引用停用父项以及跨学科质量目标", () => {
    const invalid = normalizeCatalogDraftPayload({
      modules: [
        { ...payload.modules[0], subjects: [{ subjectId: "beta", order: 0 }] }
      ],
      subjects: [
        { ...payload.subjects[0], qualityPolicy: { chapters: { "beta-1": { min: 1 }, "missing-1": { max: 2 }, "alpha-off": { min: 1 } } } },
        { ...payload.subjects[0], id: "beta", name: "学科乙", shortName: "乙", order: 2, active: false }
      ],
      chapters: [
        ...payload.chapters,
        { id: "alpha-off", subjectId: "alpha", name: "停用章", order: 2, active: false, description: null },
        { id: "beta-1", subjectId: "beta", name: "乙第一章", order: 1, active: true, description: null }
      ]
    });
    const validation = validateCatalogDraftPayload(invalid);
    assert(validation.errors.some((error) => error.includes("启用章节 beta-1") && error.includes("停用学科 beta")));
    assert(validation.errors.some((error) => error.includes("启用模块 main") && error.includes("停用学科 beta")));
    assert(validation.errors.some((error) => error.includes("其他学科章节 beta-1")));
    assert(validation.errors.some((error) => error.includes("不存在的章节 missing-1")));
    assert(validation.errors.some((error) => error.includes("停用章节 alpha-off")));
  });

  it("只允许作废尚未发布的目录草稿", () => {
    for (const status of ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"]) {
      assert.equal(canCancelCatalogDraftStatus(status), true, `${status} 应允许作废`);
    }
    for (const status of ["PUBLISHED", "CANCELLED"]) {
      assert.equal(canCancelCatalogDraftStatus(status), false, `${status} 不应允许再次作废`);
    }
  });
});
