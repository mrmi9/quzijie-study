import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ADMIN_PREVIEW_URL || "http://127.0.0.1:4173/admin/";
const ownServer = !process.env.ADMIN_PREVIEW_URL;

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("没有找到可用于管理后台浏览器测试的 Chrome/Chromium；请设置 CHROME_PATH");
  return executable;
}

const server = ownServer
  ? spawn(process.execPath, [resolve(adminRoot, "../node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4173"], {
      cwd: adminRoot,
      stdio: "ignore"
    })
  : null;

if (server) {
  let available = false;
  for (let attempt = 0; attempt < 60 && !available; attempt += 1) {
    try { available = (await fetch(baseUrl)).ok; }
    catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); }
  }
  if (!available) {
    server.kill();
    throw new Error("无法启动管理后台预览服务");
  }
}

const owner = {
  id: "owner-1",
  username: "owner",
  displayName: "唯一所有者",
  roles: ["OWNER", "EDITOR", "REVIEWER", "PUBLISHER"]
};

function paged(items, pageSize = 30) {
  return { items, total: items.length, page: 1, pageSize };
}

function questionDraft(status = "IN_REVIEW") {
  return {
    id: "draft-1",
    questionId: "q-1",
    externalCode: "c001",
    subjectId: "c",
    chapterId: "c-pointer",
    type: "SINGLE",
    stem: "悬空指针通常指什么？",
    code: null,
    explanation: "指向生命周期已结束对象或已释放内存的指针。",
    difficulty: 2,
    tags: ["指针", "生命周期"],
    images: [],
    examScopes: [],
    correctOptionIds: ["B"],
    acceptedAnswers: [],
    answerConfig: {},
    referenceAnswer: null,
    options: [
      { id: "A", label: "A", text: "值为零的指针" },
      { id: "B", label: "B", text: "指向已释放内存的指针" }
    ],
    action: "UPSERT",
    status,
    revision: 2,
    contentHash: "a".repeat(64),
    validationErrors: [],
    validationWarnings: [],
    createdById: owner.id,
    submittedById: status === "IN_REVIEW" || status === "APPROVED" ? owner.id : null,
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-17T08:10:00.000Z"
  };
}

function createMockState() {
  return {
    draftStatus: "IN_REVIEW",
    reviewBodies: [],
    publishBodies: [],
    rollbackBodies: [],
    importUploads: 0,
    mediaUploads: 0,
    draftCreates: 0
  };
}

const catalog = {
  subjects: [{
    id: "c",
    name: "C/C++",
    shortName: "C",
    color: "#2563eb",
    active: true,
    chapters: [{ id: "c-pointer", subjectId: "c", name: "指针与动态内存", order: 1, active: true }]
  }],
  modules: []
};

async function installApiMock(page, state, { setup = false } = {}) {
  await page.route("**/api/v1/media/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  }));
  await page.route("**/api/v1/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(data) });

    if (path === "/api/v1/admin/auth/me") {
      if (setup) return json({ code: "ADMIN_UNAUTHORIZED", message: "管理员登录已失效" }, 401);
      return json({ data: { ...owner, user: owner, reviewPolicy: "single-owner" } });
    }
    if (path === "/api/v1/admin/setup/status") return setup ? json({ data: { available: true } }) : json({ code: "NOT_FOUND", message: "初始化入口不存在" }, 404);
    if (path === "/api/v1/admin/setup/prepare" && method === "POST") return json({ data: {
      setupToken: "encrypted-setup-token-which-is-long-enough",
      totpSecret: "JBSWY3DPEHPK3PXP",
      totpUri: "otpauth://totp/quzijie:owner?secret=JBSWY3DPEHPK3PXP",
      qrCodeDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    } });
    if (path === "/api/v1/admin/setup/complete" && method === "POST") return json({ code: "ADMIN_SETUP_TOTP_INVALID", message: "动态验证码不正确" }, 401);
    if (path === "/api/v1/admin/dashboard") return json({ data: {
      questions: 500,
      subjects: 7,
      chapters: 45,
      drafts: [{ status: state.draftStatus, _count: { _all: 1 } }],
      imports: [],
      releases: [],
      media: [],
      todoCounts: { pendingValidation: 0, pendingReview: state.draftStatus === "IN_REVIEW" ? 1 : 0, pendingPublish: state.draftStatus === "APPROVED" ? 1 : 0, failedRelease: 0 }
    } });
    if (path === "/api/v1/admin/catalog") return json({ data: catalog });
    if (path === "/api/v1/admin/questions") return json({ data: paged([{
      id: "q-1",
      externalCode: "c001",
      subjectId: "c",
      chapterId: "c-pointer",
      status: "ACTIVE",
      subject: { name: "C/C++" },
      chapter: { name: "指针与动态内存" },
      currentVersion: { ...questionDraft("PUBLISHED"), id: "version-1", version: 1, options: [{ optionId: "A", label: "A", text: "值为零的指针" }, { optionId: "B", label: "B", text: "指向已释放内存的指针" }] }
    }]) });
    if (path === "/api/v1/admin/drafts" && method === "GET") return json({ data: paged([questionDraft(state.draftStatus)]) });
    if (path === "/api/v1/admin/drafts/draft-1/review" && method === "POST") {
      const body = request.postDataJSON();
      state.reviewBodies.push(body);
      state.draftStatus = body.decision === "APPROVED" ? "APPROVED" : "REJECTED";
      return json({ data: { ...questionDraft(state.draftStatus), reviewMode: "SELF_APPROVED" } });
    }
    if (path === "/api/v1/admin/drafts/draft-1/withdraw" && method === "POST") {
      state.draftStatus = "DRAFT";
      return json({ data: questionDraft("DRAFT") });
    }
    if (path === "/api/v1/admin/drafts" && method === "POST") {
      state.draftCreates += 1;
      return json({ data: questionDraft("DRAFT") });
    }
    if (path === "/api/v1/admin/catalog-drafts") return json({ data: paged([]) });
    if (path === "/api/v1/admin/imports" && method === "GET") {
      if (url.searchParams.get("status") === "APPROVED") return json({ data: paged([]) });
      return json({ data: paged([{
        id: "import-1", fileName: "小批测试.xlsx", status: "IN_REVIEW", revision: 2, totalRows: 3,
        validRows: 3, errorRows: 0, warningRows: 0, submittedById: owner.id, createdById: owner.id, createdAt: "2026-07-17T08:00:00.000Z"
      }]) });
    }
    if (path === "/api/v1/admin/imports" && method === "POST") {
      state.importUploads += 1;
      return json({ data: { id: "import-uploaded", status: "VALID" } });
    }
    if (path === "/api/v1/admin/imports/import-1") return json({ data: {
      id: "import-1", fileName: "小批测试.xlsx", status: "IN_REVIEW", revision: 2, totalRows: 3,
      validRows: 3, errorRows: 0, warningRows: 0, submittedById: owner.id, reviews: []
    } });
    if (path === "/api/v1/admin/imports/import-1/rows") return json({ data: paged([{
      id: "row-1", entityType: "question", rowNumber: 2, errors: [], warnings: [], rawData: { externalCode: "new-1" }
    }]) });
    if (path === "/api/v1/admin/media" && method === "GET") return json({ data: paged([{
      id: "media-1", fileName: "pointer.png", objectKey: "question-bank/media/pointer.png", publicUrl: "/api/v1/media/media-1",
      mimeType: "image/png", size: 128, sha256: "b".repeat(64), status: "READY"
    }]) });
    if (path === "/api/v1/admin/media/upload" && method === "POST") {
      state.mediaUploads += 1;
      return json({ data: { id: "media-new", status: "READY" } });
    }
    if (path === "/api/v1/admin/releases/preview" && method === "POST") return json({ data: {
      candidateHash: "c".repeat(64),
      confirmationText: "发布新增0题、修订1题、停用0题",
      summary: { added: 0, revised: 1, disabled: 0, catalogChanged: false, qualityWarningCount: 0 }
    } });
    if (path === "/api/v1/admin/releases" && method === "POST") {
      state.publishBodies.push(request.postDataJSON());
      state.draftStatus = "PUBLISHED";
      return json({ data: { id: "release-new", status: "PUBLISHED" } });
    }
    if (path === "/api/v1/admin/releases" && method === "GET") return json({ data: paged([{
      id: "release-old", name: "500 题基线", kind: "BASELINE", questionCount: 500, snapshotHash: "d".repeat(64),
      status: "PUBLISHED", verificationStatus: "PASSED", verificationReport: { checks: [] }, qualityWarnings: [],
      qualitySummary: { configuredSubjectCount: 7 }, publishedAt: "2026-07-16T08:00:00.000Z"
    }]) });
    if (path === "/api/v1/admin/releases/release-old/rollback/preview" && method === "POST") return json({ data: {
      candidateHash: "e".repeat(64), confirmationText: "回滚到500 题基线（500题）",
      summary: { targetName: "500 题基线", questionCount: 500 }
    } });
    if (path === "/api/v1/admin/releases/release-old/rollback" && method === "POST") {
      state.rollbackBodies.push(request.postDataJSON());
      return json({ data: { id: "release-rollback", status: "PUBLISHED" } });
    }
    if (path === "/api/v1/admin/audit-logs") return json({ data: paged([]) });
    if (path === "/api/v1/admin/users") return json({ data: [{ ...owner, status: "ACTIVE", createdAt: "2026-07-17T08:00:00.000Z" }] });
    return json({ code: "MOCK_ROUTE_MISSING", message: `${method} ${path} 未配置测试响应` }, 404);
  });
}

async function openAdmin(browser, viewport, state) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => sessionStorage.setItem("qz_admin_csrf", "browser-test-csrf"));
  await installApiMock(page, state);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "题库总览" }).waitFor();
  return page;
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert.ok(Math.max(metrics.documentWidth, metrics.bodyWidth) <= metrics.viewport + 1, `${label} 出现页面整体横向滚动：${JSON.stringify(metrics)}`);
}

async function mobileNavigate(page, target) {
  await page.locator("#mobile-menu").click();
  await page.locator(`[data-page="${target}"]`).click();
}

const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
const sizes = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 }
];

try {
  for (const viewport of sizes) {
    const page = await openAdmin(browser, viewport, createMockState());
    await assertNoHorizontalOverflow(page, `${viewport.width}px 总览`);
    if (viewport.width <= 720) {
      await page.locator("#mobile-menu").click();
      assert.ok(await page.locator(".app-shell").evaluate((node) => node.classList.contains("drawer-open")), `${viewport.width}px 手机抽屉未打开`);
      await page.locator("#sidebar-backdrop").click({ position: { x: viewport.width - 4, y: 20 } });
      assert.equal(await page.locator(".app-shell").evaluate((node) => node.classList.contains("drawer-open")), false, `${viewport.width}px 手机抽屉未关闭`);
    }
    await page.close();
  }

  const state = createMockState();
  const page = await openAdmin(browser, { width: 390, height: 844 }, state);

  await mobileNavigate(page, "questions");
  await page.getByRole("heading", { name: "已发布题目" }).waitFor();
  await page.locator("#open-question-filters").click();
  assert.ok(await page.locator(".main").evaluate((node) => node.classList.contains("filter-open")), "移动筛选抽屉未打开");
  await page.waitForTimeout(300);
  const filterBox = await page.locator("#question-filters").boundingBox();
  assert.ok(filterBox && filterBox.x >= 0 && filterBox.x + filterBox.width <= 391, `移动筛选抽屉超出视口：${JSON.stringify(filterBox)}`);
  await page.locator("#close-question-filters").click();

  await page.locator("#new-question").click();
  await page.getByRole("heading", { name: "新建题目" }).waitFor();
  const editorBox = await page.locator(".modal-mask .modal").last().boundingBox();
  assert.ok(editorBox && editorBox.width <= 390 && editorBox.height <= 844, "手机题目编辑器未全屏约束");
  await page.locator("details.advanced-json summary").click();
  await page.locator("#question-advanced-json").fill("{");
  await page.locator("#apply-question-json").click();
  await page.locator("#question-json-errors .error").waitFor();
  assert.equal(await page.getByRole("heading", { name: "新建题目" }).isVisible(), true, "非法高级 JSON 不应关闭编辑器");
  await page.locator("#question-form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await page.getByText("高级 JSON 尚未成功应用，不能保存草稿。").waitFor();
  assert.equal(state.draftCreates, 0, "未校验应用的高级 JSON 不得保存草稿");

  await page.locator("#pick-question-image").click();
  await page.locator("[data-media-id=media-1]").click();
  const altDialog = page.locator(".modal-mask").last();
  await altDialog.locator("[name=value]").fill("悬空指针示意图");
  await altDialog.locator("form button.primary").click();
  await page.locator("#question-image-editor [data-image-alt]").waitFor();
  assert.equal(await page.locator("#question-image-editor [data-image-alt]").inputValue(), "悬空指针示意图");
  await page.locator(".close-editor").click();

  await mobileNavigate(page, "drafts");
  await page.getByRole("heading", { name: "草稿与复核" }).waitFor();
  assert.equal(await page.locator("[data-review=draft-1][data-decision=APPROVED]").isDisabled(), true, "自检前必须先查看完整差异");
  await page.locator("[data-diff-draft=draft-1]").click();
  await page.getByRole("heading", { name: "题目完整字段差异" }).waitFor();
  await page.locator(".modal-mask").last().locator("[data-close]").click();
  assert.equal(await page.locator("[data-review=draft-1][data-decision=APPROVED]").isEnabled(), true, "查看完整差异后应允许自检");
  await page.locator("[data-review=draft-1][data-decision=APPROVED]").click();
  const reviewDialog = page.locator(".modal-mask").last();
  await reviewDialog.locator("[name=comment]").fill("已逐项核对题干、答案、解析和质量警告");
  for (const checkbox of await reviewDialog.locator("input[type=checkbox]").all()) await checkbox.check();
  await reviewDialog.getByRole("button", { name: "确认通过" }).click();
  await page.locator("span.tag", { hasText: "已批准" }).first().waitFor();
  assert.deepEqual(state.reviewBodies[0].checklist, ["DIFF", "CONTENT", "WARNINGS"]);
  assert.equal(state.reviewBodies[0].selfReviewNote.includes("逐项核对"), true);

  await page.locator("#release-name").fill("浏览器小批测试");
  await page.locator(".release-check[value=draft-1]").check();
  await page.locator("#publish-selected").click();
  const publishDialog = page.locator(".modal-mask").last();
  await publishDialog.locator("[name=confirmationTotp]").fill("123456");
  await publishDialog.locator("[name=checkedPreview]").check();
  await publishDialog.locator("[name=confirmationText]").fill("发布新增0题、修订1题、停用0题");
  await publishDialog.getByRole("button", { name: "立即原子发布" }).click();
  await page.getByText("题库批次已原子发布").waitFor();
  assert.equal(state.publishBodies[0].candidateHash, "c".repeat(64));
  assert.equal(state.publishBodies[0].confirmationTotp, "123456");

  await mobileNavigate(page, "releases");
  await page.getByRole("heading", { name: "发布与回滚" }).waitFor();
  await page.locator("[data-rollback=release-old]").click();
  const rollbackDialog = page.locator(".modal-mask").last();
  await rollbackDialog.locator("[name=confirmationTotp]").fill("654321");
  await rollbackDialog.locator("[name=checkedRollback]").check();
  await rollbackDialog.locator("[name=confirmationText]").fill("回滚到500 题基线（500题）");
  await rollbackDialog.getByRole("button", { name: "创建回滚发布" }).click();
  await page.getByText("回滚发布完成").waitFor();
  assert.equal(state.rollbackBodies[0].confirmationTotp, "654321");

  await mobileNavigate(page, "imports");
  await page.getByRole("heading", { name: "Excel 导入导出" }).waitFor();
  await page.locator("[data-import-detail=import-1]").click();
  await page.locator("#report-rows table").waitFor();
  await page.locator(".modal-mask").last().locator(".close-modal").click();
  await page.locator("#import-form input[type=file]").setInputFiles({ name: "small-test.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("xlsx-browser-test") });
  await page.locator("#import-form button.primary").click();
  await page.getByText("导入完成，请查看校验结果").waitFor();
  assert.equal(state.importUploads, 1);

  await mobileNavigate(page, "media");
  await page.getByRole("heading", { name: "媒体库" }).waitFor();
  await page.locator("#media-form input[type=file]").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
  await page.locator("#media-form button.primary").click();
  await page.getByText("媒体上传完成").waitFor();
  assert.equal(state.mediaUploads, 1);
  await assertNoHorizontalOverflow(page, "390px 完整管理流程");
  await page.close();

  const setupPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installApiMock(setupPage, createMockState(), { setup: true });
  await setupPage.goto(new URL("setup", baseUrl).toString(), { waitUntil: "networkidle" });
  await setupPage.getByRole("heading", { name: "初始化题库管理员" }).waitFor();
  await setupPage.locator("[name=username]").fill("owner");
  await setupPage.locator("[name=bootstrapToken]").fill("x".repeat(32));
  await setupPage.getByRole("button", { name: "验证令牌并配置验证器" }).click();
  await setupPage.getByRole("heading", { name: "绑定验证器并建号" }).waitFor();
  await setupPage.locator("[name=displayName]").fill("唯一所有者");
  await setupPage.locator("[name=password]").fill("Secure-Owner-Password-2026");
  await setupPage.locator("[name=confirmPassword]").fill("Secure-Owner-Password-2026");
  await setupPage.locator("[name=totp]").fill("000000");
  await setupPage.getByRole("button", { name: "创建唯一所有者" }).click();
  await setupPage.getByText("动态验证码不正确").waitFor();
  assert.equal(await setupPage.getByRole("heading", { name: "绑定验证器并建号" }).isVisible(), true, "初始化 TOTP 错误不应销毁 setup 页面");
  assert.equal(await setupPage.locator(".secret-code").isVisible(), true, "初始化 TOTP 错误后应保留当前 TOTP 密钥");
  await assertNoHorizontalOverflow(setupPage, "390px 首次初始化");
  await setupPage.close();

  console.log(`admin browser flows passed at ${sizes.map((item) => item.width).join(", ")}px`);
} finally {
  await browser.close();
  server?.kill();
}
