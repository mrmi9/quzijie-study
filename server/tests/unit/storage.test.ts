import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { loadConfig } from "../../src/config.js";
import { createQuestionBankStorage } from "../../src/services/question-bank-storage.js";

describe("题库对象存储运维", () => {
  it("本地实现只列出指定前缀并支持幂等删除", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quzijie-storage-"));
    try {
      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "mysql://unused:unused@127.0.0.1:3306/unused",
        JWT_ACCESS_SECRET: "storage-test-secret-with-more-than-thirty-two-characters",
        WECHAT_AUTH_MODE: "stub",
        QUESTION_BANK_STORAGE: "local",
        QUESTION_BANK_STORAGE_DIR: directory
      });
      const storage = createQuestionBankStorage(config);
      await storage.put("question-bank/releases/failed/a.json", Buffer.from("a"), "application/json");
      await storage.put("question-bank/releases/failed/nested/b.json", Buffer.from("b"), "application/json");
      await storage.put("question-bank/releases/published/c.json", Buffer.from("c"), "application/json");
      assert.deepEqual(await storage.checksum("question-bank/releases/published/c.json"), {
        size: 1,
        sha256: "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6"
      });
      assert.deepEqual(await storage.list("question-bank/releases/failed/"), [
        "question-bank/releases/failed/a.json",
        "question-bank/releases/failed/nested/b.json"
      ]);
      await storage.delete("question-bank/releases/failed/a.json");
      await storage.delete("question-bank/releases/failed/a.json");
      assert.deepEqual(await storage.list("question-bank/releases/failed/"), [
        "question-bank/releases/failed/nested/b.json"
      ]);
      assert.equal((await storage.get("question-bank/releases/published/c.json")).toString(), "c");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
