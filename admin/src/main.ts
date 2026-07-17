import "./style.css";

type Json = Record<string, unknown>;
type Page = "dashboard" | "catalog" | "questions" | "drafts" | "imports" | "releases" | "media" | "audit" | "users";

type CatalogChapter = Json & { id: string; subjectId: string; name: string; order: number; description: string | null; active: boolean };
type CatalogSubject = Json & { id: string; name: string; shortName: string; color: string; description: string | null; iconKey: string | null; order: number; active: boolean };
type CatalogModule = Json & { id: string; name: string; subtitle: string | null; color: string; type: string; order: number; active: boolean; subjects: Array<{ subjectId: string; order: number }> };
type CatalogPayload = { modules: CatalogModule[]; subjects: CatalogSubject[]; chapters: CatalogChapter[] };
type CatalogDraft = Json & { id: string; name: string; status: string; revision: number; payload?: CatalogPayload; baseCatalogHash?: string; contentHash?: string; validationErrors?: unknown[]; validationWarnings?: unknown[]; submittedById?: string | null; createdAt?: string; updatedAt?: string };
type ImportBatch = Json & { id: string; fileName: string; status: string; createdById?: string | null; submittedById?: string | null; contentHash?: string | null; revision?: number; reviews?: Json[]; rows?: Json[]; catalogOnly?: boolean; isCatalogOnly?: boolean; hasQuestionDrafts?: boolean; questionDraftCount?: number; catalogCandidateCount?: number };
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type QuestionFilters = { search: string; subjectId: string; chapterId: string; type: string; difficulty: string; status: string; publishedFrom: string; publishedTo: string; page: number };

const app = document.querySelector<HTMLDivElement>("#app")!;
let csrfToken = sessionStorage.getItem("qz_admin_csrf") || "";
let currentUser: { id: string; username: string; displayName: string; roles: string[] } | null = null;
let page: Page = "dashboard";
let selectedCatalogDraftId = sessionStorage.getItem("qz_admin_catalog_draft") || "";
let catalogDraftPage = 1;
let questionFilters: QuestionFilters = { search: "", subjectId: "", chapterId: "", type: "", difficulty: "", status: "", publishedFrom: "", publishedTo: "", page: 1 };
let draftStatus = "";
let draftPage = 1;
let importPage = 1;
let releasePage = 1;
let mediaPageNumber = 1;
let auditPageNumber = 1;
const ADMIN_PAGE_SIZE = 30;

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.blob();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error((body as { message?: string }).message || `请求失败（${response.status}）`);
  }
  return body as T;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function formatTime(value: unknown): string {
  return value ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function statusTag(value: unknown): string {
  const status = String(value || "");
  const good = ["ACTIVE", "VALID", "APPROVED", "PUBLISHED", "READY"].includes(status);
  const bad = ["DISABLED", "REJECTED", "FAILED", "CANCELLED"].includes(status);
  return `<span class="tag ${good ? "good" : bad ? "bad" : "warn"}">${escapeHtml(status)}</span>`;
}

function hasRole(...roles: Array<"EDITOR" | "REVIEWER" | "PUBLISHER" | "OWNER">): boolean {
  const assigned = currentUser?.roles || [];
  return assigned.includes("OWNER") || roles.some((role) => assigned.includes(role));
}

function paged<T>(value: T[] | Partial<Paged<T>> | null | undefined, fallbackPage = 1, fallbackPageSize = ADMIN_PAGE_SIZE): Paged<T> {
  if (Array.isArray(value)) return { items: value, total: value.length, page: fallbackPage, pageSize: Math.max(1, value.length || fallbackPageSize) };
  const items = Array.isArray(value?.items) ? value.items : [];
  return {
    items,
    total: Number(value?.total ?? items.length),
    page: Math.max(1, Number(value?.page || fallbackPage)),
    pageSize: Math.max(1, Number(value?.pageSize || fallbackPageSize))
  };
}

function paginationHtml(result: Paged<unknown>, id: string): string {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (pages <= 1 && result.total <= result.pageSize) return `<div class="pagination-summary">共 ${result.total} 条</div>`;
  return `<div class="pagination" id="${escapeHtml(id)}"><span>共 ${result.total} 条 · 第 ${result.page} / ${pages} 页</span><div class="actions"><button class="secondary" data-pagination="prev" ${result.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary" data-pagination="next" ${result.page >= pages ? "disabled" : ""}>下一页</button></div></div>`;
}

function bindPagination(id: string, result: Paged<unknown>, change: (page: number) => void): void {
  const root = document.querySelector<HTMLElement>(`#${id}`);
  if (!root) return;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  root.querySelector<HTMLButtonElement>("[data-pagination=prev]")?.addEventListener("click", () => change(Math.max(1, result.page - 1)));
  root.querySelector<HTMLButtonElement>("[data-pagination=next]")?.addEventListener("click", () => change(Math.min(pages, result.page + 1)));
}

function notify(message: string, error = false): void {
  const element = document.createElement("div");
  element.className = error ? "error" : "notice";
  element.style.cssText = "position:fixed;right:28px;top:20px;z-index:99;max-width:460px;box-shadow:0 14px 35px rgba(15,23,42,.2)";
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function showLogin(message = ""): void {
  currentUser = null;
  app.innerHTML = `<main class="login-shell"><form class="login-card" id="login-form">
    <div class="brand">QUIZ ADMIN</div><h1>题库管理后台</h1><p class="muted">使用管理员账号与验证器动态码登录</p>
    <label class="field"><span>用户名</span><input name="username" autocomplete="username" required minlength="3"></label>
    <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
    <label class="field"><span>6 位动态验证码</span><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}<button class="primary wide">安全登录</button>
  </form></main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const result = await api<{ data: { user: typeof currentUser; csrfToken: string } }>("/api/v1/admin/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      currentUser = result.data.user;
      csrfToken = result.data.csrfToken;
      sessionStorage.setItem("qz_admin_csrf", csrfToken);
      renderShell();
    } catch (error) { showLogin(error instanceof Error ? error.message : String(error)); }
  });
}

const NAV: Array<[Page, string]> = [
  ["dashboard", "总览"], ["catalog", "学科与章节"], ["questions", "已发布题目"], ["drafts", "草稿与复核"],
  ["imports", "Excel 导入导出"], ["releases", "发布与回滚"], ["media", "媒体库"], ["audit", "操作审计"], ["users", "管理员"]
];

function renderShell(): void {
  if (!currentUser) return showLogin();
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand">QUIZ ADMIN</div><h2>趣刷题喽题库</h2>
    <nav class="nav">${NAV.filter(([key]) => !["audit", "users"].includes(key) || currentUser!.roles.includes("OWNER")).map(([key, label]) => `<button data-page="${key}" class="${page === key ? "active" : ""}">${label}</button>`).join("")}</nav>
    <div class="sidebar-footer"><strong>${escapeHtml(currentUser.displayName)}</strong><small>${escapeHtml(currentUser.roles.join(" · "))}</small><button id="logout" class="ghost" style="margin-top:10px;width:100%">退出登录</button></div>
  </aside><main class="main" id="content"><div class="empty">正在加载…</div></main></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => button.addEventListener("click", () => { page = button.dataset.page as Page; renderShell(); }));
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    try { await api("/api/v1/admin/auth/logout", { method: "POST", body: "{}" }); } finally { csrfToken = ""; sessionStorage.removeItem("qz_admin_csrf"); showLogin(); }
  });
  void renderPage();
}

function content(html: string): void { document.querySelector<HTMLDivElement>("#content")!.innerHTML = html; }

async function renderPage(): Promise<void> {
  try {
    if (page === "dashboard") await dashboardPage();
    else if (page === "catalog") await catalogPage();
    else if (page === "questions") await questionsPage();
    else if (page === "drafts") await draftsPage();
    else if (page === "imports") await importsPage();
    else if (page === "releases") await releasesPage();
    else if (page === "media") await mediaPage();
    else if (page === "audit") await auditPage();
    else await usersPage();
  } catch (error) { content(`<div class="error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`); }
}

async function dashboardPage(): Promise<void> {
  const result = await api<{ data: Json }>("/api/v1/admin/dashboard");
  const data = result.data;
  content(`<div class="page-head"><div><h1>题库总览</h1><div class="muted">当前生产目录与待办状态</div></div><button class="secondary" id="refresh">刷新</button></div>
    <div class="cards">${([[
      "questions", "已发布题目"
    ], ["subjects", "有效学科"], ["chapters", "有效章节"], ["drafts", "草稿状态组"]] as Array<[string, string]>).map(([key, label]) => `<div class="card"><div class="metric">${Array.isArray(data[key]) ? (data[key] as unknown[]).length : escapeHtml(data[key])}</div><div class="metric-label">${label}</div></div>`).join("")}</div>
    <div class="split"><section class="panel"><h3>最近发布</h3>${simpleList(data.releases as Json[], "name", "status")}</section><section class="panel"><h3>最近导入</h3>${simpleList(data.imports as Json[], "fileName", "status")}</section></div>`);
  document.querySelector("#refresh")?.addEventListener("click", () => void dashboardPage());
}

function simpleList(items: Json[] = [], title: string, status: string): string {
  if (!items.length) return `<div class="empty">暂无记录</div>`;
  return items.map((item) => `<div class="subject-card"><div><strong>${escapeHtml(item[title])}</strong><div class="muted">${formatTime(item.createdAt)}</div></div>${statusTag(item[status])}</div>`).join("");
}

function catalogDraftItems(value: unknown): CatalogDraft[] {
  return paged(value as CatalogDraft[] | Partial<Paged<CatalogDraft>>).items;
}

function catalogPayload(value: { subjects?: Json[]; modules?: Json[]; chapters?: Json[] } | CatalogPayload): CatalogPayload {
  const subjects = (value.subjects || []).map((subject, index) => ({
    ...subject,
    id: String(subject.id),
    name: String(subject.name || ""),
    shortName: String(subject.shortName || subject.name || ""),
    color: String(subject.color || "#2563eb"),
    description: subject.description ? String(subject.description) : null,
    iconKey: subject.iconKey ? String(subject.iconKey) : null,
    order: Number(subject.order ?? index + 1),
    active: subject.active !== false
  })) as CatalogSubject[];
  const nestedChapters: Json[] = (value.subjects || []).flatMap((subject) => ((subject.chapters as Json[]) || []).map((chapter) => ({ ...chapter, subjectId: String(subject.id) }) as Json));
  const chapterSource: Json[] = (value.chapters?.length ? value.chapters : nestedChapters) as Json[];
  const chapters = (chapterSource || []).map((chapter, index) => ({
    ...chapter,
    id: String(chapter.id),
    subjectId: String(chapter.subjectId),
    name: String(chapter.name || ""),
    description: chapter.description ? String(chapter.description) : null,
    order: Number(chapter.order ?? index + 1),
    active: chapter.active !== false
  })) as CatalogChapter[];
  const modules = (value.modules || []).map((module, index) => ({
    ...module,
    id: String(module.id),
    name: String(module.name || ""),
    subtitle: module.subtitle ? String(module.subtitle) : null,
    color: String(module.color || "#2563eb"),
    type: String(module.type || "GROUP").toUpperCase(),
    order: Number(module.order ?? index + 1),
    active: module.active !== false,
    subjects: ((module.subjects as Json[]) || []).map((link, linkIndex) => ({ subjectId: String(link.subjectId || link.id), order: Number(link.order ?? linkIndex) }))
  })) as CatalogModule[];
  return { modules, subjects, chapters };
}

function cloneCatalogPayload(payload: CatalogPayload): CatalogPayload {
  return JSON.parse(JSON.stringify(payload)) as CatalogPayload;
}

function catalogWithNestedChapters(payload: CatalogPayload): { subjects: Json[]; modules: Json[] } {
  return {
    subjects: payload.subjects.slice().sort((a, b) => a.order - b.order).map((subject) => ({
      ...subject,
      chapters: payload.chapters.filter((chapter) => chapter.subjectId === subject.id).sort((a, b) => a.order - b.order)
    })),
    modules: payload.modules.slice().sort((a, b) => a.order - b.order)
  };
}

function catalogDiffRows(live: CatalogPayload, candidate: CatalogPayload): string {
  const groups: Array<[string, Json[], Json[]]> = [
    ["学科", live.subjects, candidate.subjects], ["章节", live.chapters, candidate.chapters], ["首页模块", live.modules, candidate.modules]
  ];
  const rows: string[] = [];
  for (const [label, beforeItems, afterItems] of groups) {
    const before = new Map(beforeItems.map((item) => [String(item.id), item]));
    const after = new Map(afterItems.map((item) => [String(item.id), item]));
    for (const [id, item] of after) {
      const previous = before.get(id);
      if (!previous) rows.push(`<tr><td>${label}</td><td><code>${escapeHtml(id)}</code></td><td>${statusTag("ADDED")}</td><td>${escapeHtml(item.name)}</td></tr>`);
      else if (JSON.stringify(previous) !== JSON.stringify(item)) rows.push(`<tr><td>${label}</td><td><code>${escapeHtml(id)}</code></td><td>${statusTag("CHANGED")}</td><td>${escapeHtml(item.name)}</td></tr>`);
    }
    for (const [id, item] of before) if (!after.has(id)) rows.push(`<tr><td>${label}</td><td><code>${escapeHtml(id)}</code></td><td>${statusTag("REMOVED")}</td><td>${escapeHtml(item.name)}</td></tr>`);
  }
  return rows.join("") || '<tr><td colspan="4" class="muted">候选目录与当前线上目录无差异</td></tr>';
}

function canEditCatalogDraft(draft: CatalogDraft | null): draft is CatalogDraft {
  return Boolean(draft && ["DRAFT", "REJECTED"].includes(draft.status));
}

async function patchCatalogDraft(draft: CatalogDraft, payload: CatalogPayload): Promise<void> {
  await api(`/api/v1/admin/catalog-drafts/${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ revision: draft.revision, payload })
  });
}

async function catalogPage(): Promise<void> {
  const [liveResult, draftResult] = await Promise.all([
    api<{ data: { subjects: Json[]; modules: Json[]; chapters?: Json[] } }>("/api/v1/admin/catalog"),
    api<{ data: CatalogDraft[] | Paged<CatalogDraft> }>(`/api/v1/admin/catalog-drafts?page=${catalogDraftPage}&pageSize=${ADMIN_PAGE_SIZE}`)
  ]);
  const draftPageResult = paged(draftResult.data, catalogDraftPage);
  const drafts = draftPageResult.items;
  const selectedSummary = drafts.find((draft) => draft.id === selectedCatalogDraftId) || null;
  let selectedResult: { data: CatalogDraft } | null = null;
  if (selectedCatalogDraftId) {
    try { selectedResult = await api<{ data: CatalogDraft }>(`/api/v1/admin/catalog-drafts/${encodeURIComponent(selectedCatalogDraftId)}`); }
    catch { selectedCatalogDraftId = ""; sessionStorage.removeItem("qz_admin_catalog_draft"); }
  }
  const selectedDraft = selectedResult?.data || selectedSummary;
  const displayedDrafts = selectedDraft && !drafts.some((draft) => draft.id === selectedDraft.id) ? [selectedDraft, ...drafts] : drafts;
  const candidateResult = selectedDraft
    ? await api<{ data: { subjects: Json[]; modules: Json[]; chapters?: Json[] } }>(`/api/v1/admin/catalog?catalogDraftId=${encodeURIComponent(selectedDraft.id)}`)
    : null;
  const livePayload = catalogPayload(liveResult.data);
  const candidatePayload = selectedDraft?.payload ? catalogPayload(selectedDraft.payload) : candidateResult ? catalogPayload(candidateResult.data) : livePayload;
  const displayPayload = selectedDraft ? candidatePayload : livePayload;
  const displayCatalog = catalogWithNestedChapters(displayPayload);
  const editable = canEditCatalogDraft(selectedDraft) && hasRole("EDITOR");
  const errors = (selectedDraft?.validationErrors || []) as unknown[];
  const warnings = (selectedDraft?.validationWarnings || []) as unknown[];
  const selfSubmitted = Boolean(selectedDraft?.submittedById && selectedDraft.submittedById === currentUser?.id);

  content(`<div class="page-head"><div><h1>学科与章节</h1><div class="muted">线上目录只读；目录调整必须在变更集中完成复核并发布</div></div>${hasRole("EDITOR") ? '<button class="primary" id="new-catalog-draft">新建目录变更</button>' : ""}</div>
    <section class="panel catalog-workspace"><div class="catalog-draft-bar"><label class="field compact"><span>当前目录视图</span><select id="catalog-draft-select"><option value="">当前线上目录（只读）</option>${displayedDrafts.map((draft) => `<option value="${escapeHtml(draft.id)}" ${draft.id === selectedDraft?.id ? "selected" : ""}>${escapeHtml(draft.name)} · ${escapeHtml(draft.status)}</option>`).join("")}</select></label>
      <div class="catalog-draft-summary">${selectedDraft ? `<div><strong>${escapeHtml(selectedDraft.name)}</strong> ${statusTag(selectedDraft.status)}<div class="muted">修订 ${escapeHtml(selectedDraft.revision)} · 更新于 ${formatTime(selectedDraft.updatedAt || selectedDraft.createdAt)}</div></div><div class="actions"><button class="secondary" id="catalog-diff">查看线上差异</button>${editable ? `<button class="primary" id="catalog-submit">提交复核</button>` : ""}${selectedDraft.status === "IN_REVIEW" && hasRole("REVIEWER") ? `<button class="primary" data-catalog-review="APPROVED" ${selfSubmitted ? "disabled title=\"提交人不能复核自己的变更集\"" : ""}>复核通过</button><button class="danger" data-catalog-review="REJECTED" ${selfSubmitted ? "disabled title=\"提交人不能复核自己的变更集\"" : ""}>驳回</button>` : ""}${selectedDraft.status === "APPROVED" && hasRole("PUBLISHER") ? `<button class="primary" id="catalog-go-release">选择并发布</button>` : ""}</div>` : `<div><strong>当前线上目录</strong> ${statusTag("PUBLISHED")}<div class="muted">请选择或新建目录变更集后再编辑</div></div>`}</div></div>
      ${selectedDraft ? `<div class="catalog-meta"><span>基线 <code>${escapeHtml(String(selectedDraft.baseCatalogHash || "—").slice(0, 16))}</code></span><span>内容 <code>${escapeHtml(String(selectedDraft.contentHash || "未冻结").slice(0, 16))}</code></span><span class="tag ${errors.length ? "bad" : "good"}">错误 ${errors.length}</span><span class="tag warn">警告 ${warnings.length}</span></div>` : ""}
      ${errors.length || warnings.length ? `<details class="catalog-validation"><summary>查看校验结果</summary><pre>${escapeHtml(JSON.stringify({ errors, warnings }, null, 2))}</pre></details>` : ""}
      ${paginationHtml(draftPageResult, "catalog-draft-pagination")}
    </section>
    <div class="page-head catalog-list-head"><div><h2>${selectedDraft ? "候选目录" : "线上目录"}</h2><div class="muted">${editable ? "当前变更集可编辑；保存会整体更新候选目录并递增修订号" : "该视图不可编辑"}</div></div><div class="toolbar">${editable ? `<button class="secondary" id="new-module">新增首页模块</button><button class="primary" id="new-subject">新增学科</button>` : ""}</div></div>
    <div class="split"><section><h3>学科</h3>${displayCatalog.subjects.map((subject) => `<div class="card catalog-card"><div class="subject-card"><div><strong>${escapeHtml(subject.name)}</strong> <code>${escapeHtml(subject.id)}</code><div class="muted">${escapeHtml(subject.description || "暂无说明")}</div></div><span class="subject-dot" style="background:${escapeHtml(subject.color)}"></span></div><div class="actions">${editable ? `<button class="secondary" data-edit-subject="${escapeHtml(subject.id)}">编辑学科</button><button class="secondary" data-chapter-subject="${escapeHtml(subject.id)}">新增章节</button>` : ""}${statusTag(subject.active ? "ACTIVE" : "DISABLED")}</div><div class="catalog-chapters">${((subject.chapters as Json[]) || []).map((chapter) => editable ? `<button class="tag" data-edit-chapter="${escapeHtml(chapter.id)}" data-subject-id="${escapeHtml(subject.id)}">${escapeHtml(chapter.name)}</button>` : `<span class="tag">${escapeHtml(chapter.name)}</span>`).join("") || '<span class="muted">暂无章节</span>'}</div></div>`).join("") || '<div class="empty">暂无学科</div>'}</section>
    <section><h3>首页模块</h3>${displayCatalog.modules.map((module) => `<div class="card catalog-card" style="border-left-color:${escapeHtml(module.color)}"><div class="subject-card"><div><strong>${escapeHtml(module.name)}</strong><div class="muted">${escapeHtml(module.subtitle || "")}</div></div>${editable ? `<button class="secondary" data-edit-module="${escapeHtml(module.id)}">编辑</button>` : ""}</div><div class="catalog-chapters">${statusTag(module.active === false ? "DISABLED" : module.type)} ${((module.subjects as Json[]) || []).map((link) => `<span class="tag">${escapeHtml(link.subjectId)}</span>`).join("")}</div></div>`).join("") || '<div class="empty">暂无首页模块</div>'}</section></div>`);

  document.querySelector<HTMLSelectElement>("#catalog-draft-select")?.addEventListener("change", (event) => {
    selectedCatalogDraftId = (event.currentTarget as HTMLSelectElement).value;
    if (selectedCatalogDraftId) sessionStorage.setItem("qz_admin_catalog_draft", selectedCatalogDraftId);
    else sessionStorage.removeItem("qz_admin_catalog_draft");
    void catalogPage();
  });
  bindPagination("catalog-draft-pagination", draftPageResult, (nextPage) => { catalogDraftPage = nextPage; void catalogPage(); });
  document.querySelector("#new-catalog-draft")?.addEventListener("click", async () => {
    const name = prompt("目录变更集名称", `目录调整 ${new Date().toLocaleDateString("zh-CN")}`)?.trim();
    if (!name) return;
    try {
      const result = await api<{ data: CatalogDraft }>("/api/v1/admin/catalog-drafts", { method: "POST", body: JSON.stringify({ name }) });
      selectedCatalogDraftId = result.data.id;
      sessionStorage.setItem("qz_admin_catalog_draft", selectedCatalogDraftId);
      notify("目录变更集已创建");
      await catalogPage();
    } catch (error) { notify(String(error), true); }
  });
  document.querySelector("#catalog-diff")?.addEventListener("click", () => {
    const mask = modal("目录变更差异", `<div class="muted">以当前线上目录为基线，对比该变更集候选内容。</div><table class="catalog-diff-table"><thead><tr><th>类型</th><th>ID</th><th>变化</th><th>名称</th></tr></thead><tbody>${catalogDiffRows(livePayload, candidatePayload)}</tbody></table><div class="toolbar"><button class="secondary" data-close>关闭</button></div>`);
    mask.querySelector("[data-close]")?.addEventListener("click", () => mask.remove());
  });
  document.querySelector("#catalog-submit")?.addEventListener("click", async () => {
    if (!selectedDraft || !confirm("提交后候选目录将冻结，后续修改需先被驳回。确定提交复核？")) return;
    try { await api(`/api/v1/admin/catalog-drafts/${encodeURIComponent(selectedDraft.id)}/submit`, { method: "POST", body: "{}" }); notify("目录变更集已提交复核"); await catalogPage(); } catch (error) { notify(String(error), true); }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-catalog-review]").forEach((button) => button.addEventListener("click", async () => {
    if (!selectedDraft) return;
    const decision = button.dataset.catalogReview!;
    const comment = prompt(decision === "APPROVED" ? "复核说明（可选）" : "驳回原因") || "";
    if (decision === "REJECTED" && !comment.trim()) return notify("驳回时请填写原因", true);
    try { await api(`/api/v1/admin/catalog-drafts/${encodeURIComponent(selectedDraft.id)}/review`, { method: "POST", body: JSON.stringify({ decision, comment }) }); notify(decision === "APPROVED" ? "目录变更集复核通过" : "目录变更集已驳回"); await catalogPage(); } catch (error) { notify(String(error), true); }
  }));
  document.querySelector("#catalog-go-release")?.addEventListener("click", () => { page = "drafts"; renderShell(); });
  if (!editable || !selectedDraft) return;
  document.querySelector("#new-subject")?.addEventListener("click", () => subjectModal(selectedDraft, candidatePayload));
  document.querySelector("#new-module")?.addEventListener("click", () => moduleModal(selectedDraft, candidatePayload));
  document.querySelectorAll<HTMLButtonElement>("[data-chapter-subject]").forEach((button) => button.addEventListener("click", () => chapterModal(selectedDraft, candidatePayload, button.dataset.chapterSubject!)));
  document.querySelectorAll<HTMLButtonElement>("[data-edit-subject]").forEach((button) => button.addEventListener("click", () => subjectModal(selectedDraft, candidatePayload, candidatePayload.subjects.find((subject) => subject.id === button.dataset.editSubject))));
  document.querySelectorAll<HTMLButtonElement>("[data-edit-chapter]").forEach((button) => button.addEventListener("click", () => chapterModal(selectedDraft, candidatePayload, button.dataset.subjectId!, candidatePayload.chapters.find((chapter) => chapter.id === button.dataset.editChapter))));
  document.querySelectorAll<HTMLButtonElement>("[data-edit-module]").forEach((button) => button.addEventListener("click", () => moduleModal(selectedDraft, candidatePayload, candidatePayload.modules.find((module) => module.id === button.dataset.editModule))));
}

function modal(title: string, body: string): HTMLDivElement {
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="ghost close-modal">关闭</button></div>${body}</div>`;
  mask.querySelector(".close-modal")?.addEventListener("click", () => mask.remove());
  document.body.appendChild(mask);
  return mask;
}

function subjectModal(draft: CatalogDraft, currentPayload: CatalogPayload, existing: Json = {}): void {
  const qualityPolicy = existing.qualityPolicy ? JSON.stringify(existing.qualityPolicy, null, 2) : "";
  const mask = modal(existing.id ? "编辑学科" : "新增学科", `<form id="subject-form" class="grid-2"><label class="field"><span>学科 ID</span><input name="id" placeholder="database" value="${escapeHtml(existing.id)}" ${existing.id ? "readonly" : ""} required></label><label class="field"><span>名称</span><input name="name" value="${escapeHtml(existing.name)}" required></label><label class="field"><span>简称</span><input name="shortName" value="${escapeHtml(existing.shortName)}" required></label><label class="field"><span>主题色</span><input name="color" value="${escapeHtml(existing.color || "#2563eb")}"></label><label class="field" style="grid-column:1/-1"><span>说明</span><input name="description" value="${escapeHtml(existing.description)}"></label><label class="field" style="grid-column:1/-1"><span>质量目标 JSON（普通偏差仅产生发布警告）</span><textarea name="qualityPolicyJson" rows="8" placeholder='{"questionTypes":{"SINGLE":{"min":20}},"difficulties":{"1":{"min":5}},"chapters":{"chapter-id":{"min":5,"max":100}}}'>${escapeHtml(qualityPolicy)}</textarea></label>${existing.id ? `<label><input type="checkbox" name="active" ${existing.active ? "checked" : ""}> 启用学科</label>` : ""}<button class="primary">${existing.id ? "保存" : "创建并加入首页"}</button></form>`);
  mask.querySelector<HTMLFormElement>("#subject-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const raw = Object.fromEntries(form);
    try {
      const { qualityPolicyJson, ...subjectFields } = raw;
      const policyText = String(qualityPolicyJson || "").trim();
      const next = cloneCatalogPayload(currentPayload);
      const subject = {
        ...subjectFields,
        id: String(subjectFields.id), name: String(subjectFields.name), shortName: String(subjectFields.shortName),
        color: String(subjectFields.color || "#2563eb"), description: subjectFields.description ? String(subjectFields.description) : null,
        iconKey: existing.iconKey ? String(existing.iconKey) : null,
        order: Number(existing.order || Math.max(0, ...next.subjects.map((item) => item.order)) + 1),
        active: existing.id ? form.has("active") : true,
        qualityPolicy: policyText ? JSON.parse(policyText) : null
      } as CatalogSubject;
      const index = next.subjects.findIndex((item) => item.id === subject.id);
      if (index >= 0) next.subjects[index] = subject;
      else {
        next.subjects.push(subject);
        if (!next.modules.some((item) => item.id === subject.id)) next.modules.push({ id: subject.id, name: subject.name, subtitle: subject.description || "专项练习", color: subject.color, type: "SUBJECT", order: Math.max(0, ...next.modules.map((item) => item.order)) + 1, active: true, subjects: [{ subjectId: subject.id, order: 0 }] });
      }
      await patchCatalogDraft(draft, next);
      mask.remove();
      await catalogPage();
    } catch (error) { notify(error instanceof SyntaxError ? "质量目标不是合法 JSON" : String(error), true); }
  });
}

function chapterModal(draft: CatalogDraft, currentPayload: CatalogPayload, subjectId: string, existing: Json = {}): void {
  const mask = modal(existing.id ? "编辑章节" : "新增章节", `<form id="chapter-form"><label class="field"><span>章节 ID</span><input name="id" value="${escapeHtml(existing.id)}" ${existing.id ? "readonly" : ""} required></label><label class="field"><span>章节名称</span><input name="name" value="${escapeHtml(existing.name)}" required></label><label class="field"><span>说明</span><input name="description" value="${escapeHtml(existing.description)}"></label>${existing.id ? `<label><input type="checkbox" name="active" ${existing.active ? "checked" : ""}> 启用章节</label>` : ""}<button class="primary wide">${existing.id ? "保存章节" : "创建章节"}</button></form>`);
  mask.querySelector<HTMLFormElement>("#chapter-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const raw = Object.fromEntries(form); try { const next = cloneCatalogPayload(currentPayload); const chapter = { ...existing, id: String(raw.id), subjectId, name: String(raw.name), description: raw.description ? String(raw.description) : null, order: Number(existing.order || Math.max(0, ...next.chapters.filter((item) => item.subjectId === subjectId).map((item) => item.order)) + 1), active: existing.id ? form.has("active") : true } as CatalogChapter; const index = next.chapters.findIndex((item) => item.id === chapter.id); if (index >= 0) next.chapters[index] = chapter; else next.chapters.push(chapter); await patchCatalogDraft(draft, next); mask.remove(); await catalogPage(); } catch (error) { notify(String(error), true); } });
}

function moduleModal(draft: CatalogDraft, currentPayload: CatalogPayload, existing: Json = {}): void {
  const subjects = currentPayload.subjects;
  const selected = new Set(((existing.subjects as Json[]) || []).map((link) => String(link.subjectId)));
  const mask = modal(existing.id ? "编辑首页模块" : "新增首页模块", `<form id="module-form"><div class="grid-2"><label class="field"><span>模块 ID</span><input name="id" value="${escapeHtml(existing.id)}" ${existing.id ? "readonly" : ""} required></label><label class="field"><span>名称</span><input name="name" value="${escapeHtml(existing.name)}" required></label><label class="field"><span>副标题</span><input name="subtitle" value="${escapeHtml(existing.subtitle)}"></label><label class="field"><span>主题色</span><input name="color" value="${escapeHtml(existing.color || "#2563eb")}"></label><label class="field"><span>类型</span><select name="type">${["SUBJECT","GROUP","EXAM"].map((type) => `<option ${type === String(existing.type || "GROUP") ? "selected" : ""}>${type}</option>`).join("")}</select></label></div><div class="field"><span>包含学科（显示顺序按勾选顺序）</span><div class="toolbar">${subjects.map((subject) => `<label><input type="checkbox" name="subjectIds" value="${escapeHtml(subject.id)}" ${selected.has(String(subject.id)) ? "checked" : ""}> ${escapeHtml(subject.name)}</label>`).join("")}</div></div>${existing.id ? `<label><input type="checkbox" name="active" ${existing.active !== false ? "checked" : ""}> 启用首页模块</label>` : ""}<button class="primary wide">保存模块</button></form>`);
  mask.querySelector<HTMLFormElement>("#module-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const id = String(form.get("id") || "");
    const subjectIds = form.getAll("subjectIds").map(String);
    try { const next = cloneCatalogPayload(currentPayload); const candidate = { ...existing, id, name: String(form.get("name") || ""), subtitle: form.get("subtitle") ? String(form.get("subtitle")) : null, color: String(form.get("color") || "#2563eb"), type: String(form.get("type") || "GROUP"), order: Number(existing.order || Math.max(0, ...next.modules.map((item) => item.order)) + 1), active: existing.id ? form.has("active") : true, subjects: subjectIds.map((subjectId, order) => ({ subjectId, order })) } as CatalogModule; const index = next.modules.findIndex((item) => item.id === id); if (index >= 0) next.modules[index] = candidate; else next.modules.push(candidate); await patchCatalogDraft(draft, next); mask.remove(); await catalogPage(); } catch (error) { notify(String(error), true); }
  });
}

async function questionsPage(): Promise<void> {
  const params = new URLSearchParams({ page: String(questionFilters.page), pageSize: String(ADMIN_PAGE_SIZE) });
  for (const key of ["search", "subjectId", "chapterId", "type", "difficulty", "status"] as const) if (questionFilters[key]) params.set(key, questionFilters[key]);
  if (questionFilters.publishedFrom) params.set("publishedFrom", `${questionFilters.publishedFrom}T00:00:00.000+08:00`);
  if (questionFilters.publishedTo) params.set("publishedTo", `${questionFilters.publishedTo}T23:59:59.999+08:00`);
  const [questionResult, catalogResult] = await Promise.all([
    api<{ data: Paged<Json> }>(`/api/v1/admin/questions?${params.toString()}`),
    api<{ data: { subjects: Json[] } }>("/api/v1/admin/catalog")
  ]);
  const data = paged(questionResult.data, questionFilters.page);
  const subjects = catalogResult.data.subjects || [];
  const selectedSubject = subjects.find((subject) => subject.id === questionFilters.subjectId);
  const chapters = ((selectedSubject?.chapters as Json[]) || []);
  const option = (value: string, label: string, current: string) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
  content(`<div class="page-head"><div><h1>已发布题目</h1><div class="muted">按题库字段组合筛选，共 ${data.total} 道</div></div>${hasRole("EDITOR") ? '<button class="primary" id="new-question">新建题目</button>' : ""}</div>
    <form class="panel filter-panel" id="question-filters"><div class="filter-grid"><label class="field"><span>关键词</span><input name="search" placeholder="题号、题干或标签" value="${escapeHtml(questionFilters.search)}"></label><label class="field"><span>学科</span><select name="subjectId"><option value="">全部学科</option>${subjects.map((subject) => option(String(subject.id), String(subject.name), questionFilters.subjectId)).join("")}</select></label><label class="field"><span>章节</span><select name="chapterId"><option value="">全部章节</option>${chapters.map((chapter) => option(String(chapter.id), String(chapter.name), questionFilters.chapterId)).join("")}</select></label><label class="field"><span>题型</span><select name="type"><option value="">全部题型</option>${["SINGLE","MULTIPLE","JUDGE","FILL_BLANK","SHORT_ANSWER"].map((value) => option(value, value, questionFilters.type)).join("")}</select></label><label class="field"><span>难度</span><select name="difficulty"><option value="">全部难度</option>${["1","2","3"].map((value) => option(value, `难度 ${value}`, questionFilters.difficulty)).join("")}</select></label><label class="field"><span>状态</span><select name="status"><option value="">全部状态</option>${["ACTIVE","DISABLED"].map((value) => option(value, value, questionFilters.status)).join("")}</select></label><label class="field"><span>发布起始日</span><input name="publishedFrom" type="date" value="${escapeHtml(questionFilters.publishedFrom)}"></label><label class="field"><span>发布截止日</span><input name="publishedTo" type="date" value="${escapeHtml(questionFilters.publishedTo)}"></label></div><div class="toolbar filter-actions"><button class="primary">应用筛选</button><button class="ghost" type="button" id="reset-question-filters">重置</button></div></form>
    <div class="panel table-panel"><table><thead><tr><th>题号</th><th>学科 / 章节</th><th>题型</th><th>难度</th><th>状态</th><th>题干</th><th>版本</th><th>操作</th></tr></thead><tbody>${data.items.map((item) => { const version = item.currentVersion as Json | null; const subject = item.subject as Json; const chapter = item.chapter as Json; return `<tr><td><code>${escapeHtml(item.externalCode || item.id)}</code></td><td>${escapeHtml(subject?.name)}<br><span class="muted">${escapeHtml(chapter?.name)}</span></td><td>${statusTag(version?.type)}</td><td>${escapeHtml(version?.difficulty)}</td><td>${statusTag(item.status)}</td><td>${escapeHtml(String(version?.stem || "").slice(0, 90))}</td><td>v${escapeHtml(version?.version)}</td><td class="actions">${hasRole("EDITOR") ? `<button class="secondary" data-revise="${escapeHtml(item.id)}">创建修订</button>${item.status === "ACTIVE" ? `<button class="danger" data-disable-question="${escapeHtml(item.id)}">创建停用草稿</button>` : ""}` : "—"}</td></tr>`; }).join("") || '<tr><td colspan="8" class="empty">没有符合条件的题目</td></tr>'}</tbody></table>${paginationHtml(data, "question-pagination")}</div>`);
  const filterForm = document.querySelector<HTMLFormElement>("#question-filters")!;
  filterForm.querySelector<HTMLSelectElement>("[name=subjectId]")?.addEventListener("change", (event) => {
    const subject = subjects.find((item) => item.id === (event.currentTarget as HTMLSelectElement).value);
    const chapterSelect = filterForm.querySelector<HTMLSelectElement>("[name=chapterId]")!;
    chapterSelect.innerHTML = `<option value="">全部章节</option>${(((subject?.chapters as Json[]) || []).map((chapter) => `<option value="${escapeHtml(chapter.id)}">${escapeHtml(chapter.name)}</option>`).join(""))}`;
  });
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(filterForm);
    questionFilters = { search: String(form.get("search") || "").trim(), subjectId: String(form.get("subjectId") || ""), chapterId: String(form.get("chapterId") || ""), type: String(form.get("type") || ""), difficulty: String(form.get("difficulty") || ""), status: String(form.get("status") || ""), publishedFrom: String(form.get("publishedFrom") || ""), publishedTo: String(form.get("publishedTo") || ""), page: 1 };
    void questionsPage();
  });
  document.querySelector("#reset-question-filters")?.addEventListener("click", () => { questionFilters = { search: "", subjectId: "", chapterId: "", type: "", difficulty: "", status: "", publishedFrom: "", publishedTo: "", page: 1 }; void questionsPage(); });
  bindPagination("question-pagination", data, (nextPage) => { questionFilters.page = nextPage; void questionsPage(); });
  document.querySelector("#new-question")?.addEventListener("click", () => void questionEditor());
  document.querySelectorAll<HTMLButtonElement>("[data-revise]").forEach((button) => button.addEventListener("click", () => {
    const item = data.items.find((candidate) => candidate.id === button.dataset.revise)!;
    const version = item.currentVersion as Json;
    void questionEditor({ questionId: String(item.id), externalCode: item.externalCode, subjectId: item.subjectId, chapterId: item.chapterId, ...version, options: (version.options as Json[]).map((option) => ({ id: option.optionId, label: option.label, text: option.text })) });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-disable-question]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("停用也必须经过复核和发布，确定创建停用草稿？")) return;
    const item = data.items.find((candidate) => candidate.id === button.dataset.disableQuestion)!;
    const version = item.currentVersion as Json;
    const payload = {
      questionId: item.id, externalCode: item.externalCode, subjectId: item.subjectId, chapterId: item.chapterId,
      type: version.type, stem: version.stem, code: version.code, explanation: version.explanation, difficulty: version.difficulty,
      tags: version.tags, images: version.images, examScopes: version.examScopes, correctOptionIds: version.correctOptionIds,
      acceptedAnswers: version.acceptedAnswers, answerConfig: version.answerConfig, referenceAnswer: version.referenceAnswer,
      options: (version.options as Json[]).map((option) => ({ id: option.optionId, label: option.label, text: option.text })), action: "DISABLE"
    };
    try { await api("/api/v1/admin/drafts", { method: "POST", body: JSON.stringify(payload) }); notify("停用草稿已创建"); page = "drafts"; renderShell(); } catch (error) { notify(String(error), true); }
  }));
}

async function questionEditor(existing: Json = {}): Promise<void> {
  const catalog = await api<{ data: { subjects: Array<Json> } }>("/api/v1/admin/catalog");
  const subjects = catalog.data.subjects;
  const defaultSubject = String(existing.subjectId || subjects[0]?.id || "");
  const chapterOptions = (subjects.find((subject) => subject.id === defaultSubject)?.chapters as Json[] || []);
  const value = (key: string, fallback = "") => escapeHtml(existing[key] ?? fallback);
  const mask = modal(existing.id ? "编辑草稿" : existing.questionId ? "创建题目修订" : "新建题目", `<form id="question-form">
    <div class="grid-3"><label class="field"><span>外部题号</span><input name="externalCode" value="${value("externalCode")}"></label><label class="field"><span>学科</span><select name="subjectId">${subjects.map((subject) => `<option value="${escapeHtml(subject.id)}" ${subject.id === defaultSubject ? "selected" : ""}>${escapeHtml(subject.name)}</option>`).join("")}</select></label><label class="field"><span>章节</span><select name="chapterId">${chapterOptions.map((chapter) => `<option value="${escapeHtml(chapter.id)}" ${chapter.id === existing.chapterId ? "selected" : ""}>${escapeHtml(chapter.name)}</option>`).join("")}</select></label>
    <label class="field"><span>题型</span><select name="type">${["SINGLE","MULTIPLE","JUDGE","FILL_BLANK","SHORT_ANSWER"].map((type) => `<option ${type === String(existing.type || "SINGLE") ? "selected" : ""}>${type}</option>`).join("")}</select></label><label class="field"><span>难度</span><select name="difficulty">${[1,2,3].map((difficulty) => `<option ${difficulty === Number(existing.difficulty || 1) ? "selected" : ""}>${difficulty}</option>`).join("")}</select></label><label class="field"><span>标签（| 分隔）</span><input name="tags" value="${escapeHtml(Array.isArray(existing.tags) ? existing.tags.join("|") : "")}"></label></div>
    <label class="field"><span>题干</span><textarea name="stem" required>${value("stem")}</textarea></label><label class="field"><span>代码（可选）</span><textarea name="code">${value("code")}</textarea></label>
    <label class="field"><span>选项 JSON</span><textarea name="options">${escapeHtml(JSON.stringify(existing.options || [{id:"A",label:"A",text:""},{id:"B",label:"B",text:""}], null, 2))}</textarea></label>
    <div class="grid-2"><label class="field"><span>正确选项（| 分隔）</span><input name="correctOptionIds" value="${escapeHtml(Array.isArray(existing.correctOptionIds) ? existing.correctOptionIds.join("|") : "")}"></label><label class="field"><span>填空可接受答案 JSON</span><input name="acceptedAnswers" value="${escapeHtml(JSON.stringify(existing.acceptedAnswers || []))}"></label></div><div class="toolbar"><label><input type="checkbox" name="caseSensitive" ${(existing.answerConfig as Json)?.caseSensitive ? "checked" : ""}> 填空区分大小写</label><label><input type="checkbox" name="punctuationSensitive" ${(existing.answerConfig as Json)?.punctuationSensitive ? "checked" : ""}> 填空区分标点</label></div>
    <label class="field"><span>简答参考答案</span><textarea name="referenceAnswer">${value("referenceAnswer")}</textarea></label><label class="field"><span>答案解析</span><textarea name="explanation" required>${value("explanation")}</textarea></label>
    <div class="grid-2"><label class="field"><span>考试范围（| 分隔）</span><input name="examScopes" value="${escapeHtml(Array.isArray(existing.examScopes) ? existing.examScopes.join("|") : "")}"></label><label class="field"><span>题图 JSON</span><input name="images" value="${escapeHtml(JSON.stringify(existing.images || []))}"></label></div>
    <button class="primary wide">保存草稿</button></form>`);
  const subjectSelect = mask.querySelector<HTMLSelectElement>("[name=subjectId]")!;
  subjectSelect.addEventListener("change", () => { const chapters = subjects.find((subject) => subject.id === subjectSelect.value)?.chapters as Json[] || []; mask.querySelector<HTMLSelectElement>("[name=chapterId]")!.innerHTML = chapters.map((chapter) => `<option value="${escapeHtml(chapter.id)}">${escapeHtml(chapter.name)}</option>`).join(""); });
  mask.querySelector<HTMLFormElement>("#question-form")!.addEventListener("submit", async (event) => {
    event.preventDefault(); const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
    try {
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const payload = { ...raw, questionId: existing.questionId, difficulty: Number(raw.difficulty), tags: String(raw.tags).split("|").filter(Boolean), correctOptionIds: String(raw.correctOptionIds).split("|").filter(Boolean), examScopes: String(raw.examScopes).split("|").filter(Boolean), options: JSON.parse(String(raw.options)), acceptedAnswers: JSON.parse(String(raw.acceptedAnswers)), images: JSON.parse(String(raw.images)), answerConfig: { caseSensitive: form.has("caseSensitive"), punctuationSensitive: form.has("punctuationSensitive") } };
      if (existing.id) await api(`/api/v1/admin/drafts/${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, revision: existing.revision }) });
      else await api("/api/v1/admin/drafts", { method: "POST", body: JSON.stringify(payload) });
      mask.remove(); notify("草稿已保存"); page = "drafts"; renderShell();
    } catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
  });
}

function importReviews(batch: ImportBatch): Json[] {
  return Array.isArray(batch.reviews) ? batch.reviews : [];
}

function importBatchMeta(batch: ImportBatch): string {
  const reviews = importReviews(batch);
  const latest = reviews[reviews.length - 1];
  const parts = [
    batch.revision !== undefined ? `修订 ${escapeHtml(batch.revision)}` : "",
    batch.contentHash ? `内容 <code>${escapeHtml(batch.contentHash.slice(0, 12))}</code>` : "",
    batch.submittedById ? `提交人 <code>${escapeHtml(batch.submittedById)}</code>` : "",
    latest ? `最近复核 ${statusTag(latest.decision)}` : ""
  ].filter(Boolean);
  return parts.length ? `<div class="import-meta">${parts.join("<span> · </span>")}</div>` : "";
}

function diffValue(key: string, value: unknown): string {
  if (key === "options" && Array.isArray(value)) {
    value = value.map((item) => { const option = item as Json; return { id: option.id || option.optionId, label: option.label, text: option.text }; });
  }
  if (value === undefined || value === null || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function questionDraftDiffRows(draft: Json): string {
  const base = draft.baseVersion as Json | null;
  const baseQuestion = (draft.question as Json | null) || {};
  const fields: Array<{ label: string; key: string; before?: unknown; after?: unknown }> = [
    { label: "操作", key: "action", before: base ? "UPSERT" : "（新题）", after: draft.action || "UPSERT" },
    { label: "外部题号", key: "externalCode", before: draft.baseExternalCode || baseQuestion.externalCode, after: draft.externalCode },
    { label: "学科", key: "subjectId", before: draft.baseSubjectId || baseQuestion.subjectId || base?.subjectId, after: draft.subjectId },
    { label: "章节", key: "chapterId", before: draft.baseChapterId || baseQuestion.chapterId || base?.chapterId, after: draft.chapterId },
    { label: "题型", key: "type", before: base?.type, after: draft.type },
    { label: "题干", key: "stem", before: base?.stem, after: draft.stem },
    { label: "代码", key: "code", before: base?.code, after: draft.code },
    { label: "难度", key: "difficulty", before: base?.difficulty, after: draft.difficulty },
    { label: "标签", key: "tags", before: base?.tags, after: draft.tags },
    { label: "选项", key: "options", before: base?.options, after: draft.options },
    { label: "正确选项", key: "correctOptionIds", before: base?.correctOptionIds, after: draft.correctOptionIds },
    { label: "填空答案", key: "acceptedAnswers", before: base?.acceptedAnswers, after: draft.acceptedAnswers },
    { label: "答案配置", key: "answerConfig", before: base?.answerConfig, after: draft.answerConfig },
    { label: "简答参考答案", key: "referenceAnswer", before: base?.referenceAnswer, after: draft.referenceAnswer },
    { label: "解析", key: "explanation", before: base?.explanation, after: draft.explanation },
    { label: "题图", key: "images", before: base?.images, after: draft.images },
    { label: "考试范围", key: "examScopes", before: base?.examScopes, after: draft.examScopes }
  ];
  return fields.map((field) => {
    const before = diffValue(field.key, field.before);
    const after = diffValue(field.key, field.after);
    const changed = before !== after;
    return `<tr class="${changed ? "diff-changed" : ""}"><th>${escapeHtml(field.label)} ${changed ? '<span class="tag warn">变更</span>' : ""}</th><td><pre>${escapeHtml(before)}</pre></td><td><pre>${escapeHtml(after)}</pre></td></tr>`;
  }).join("");
}

async function draftsPage(): Promise<void> {
  const statusQuery = draftStatus ? `&status=${encodeURIComponent(draftStatus)}` : "";
  const emptyCatalogDrafts: { data: Paged<CatalogDraft> } = { data: { items: [], total: 0, page: 1, pageSize: ADMIN_PAGE_SIZE } };
  const emptyImports: { data: Paged<ImportBatch> } = { data: { items: [], total: 0, page: 1, pageSize: ADMIN_PAGE_SIZE } };
  const [draftResult, catalogDraftResult, importResult] = await Promise.all([
    api<{ data: Paged<Json> }>(`/api/v1/admin/drafts?page=${draftPage}&pageSize=${ADMIN_PAGE_SIZE}${statusQuery}`),
    hasRole("PUBLISHER") ? api<{ data: Paged<CatalogDraft> }>(`/api/v1/admin/catalog-drafts?status=APPROVED&page=1&pageSize=${ADMIN_PAGE_SIZE}`) : Promise.resolve(emptyCatalogDrafts),
    hasRole("PUBLISHER") ? api<{ data: Paged<ImportBatch> }>(`/api/v1/admin/imports?status=APPROVED&page=1&pageSize=${ADMIN_PAGE_SIZE}`) : Promise.resolve(emptyImports)
  ]);
  const data = paged(draftResult.data, draftPage);
  const approvedCatalogDrafts = paged(catalogDraftResult.data).items;
  if (selectedCatalogDraftId && !approvedCatalogDrafts.some((draft) => draft.id === selectedCatalogDraftId)) {
    try {
      const selected = (await api<{ data: CatalogDraft }>(`/api/v1/admin/catalog-drafts/${encodeURIComponent(selectedCatalogDraftId)}`)).data;
      if (selected.status === "APPROVED") approvedCatalogDrafts.unshift(selected);
    } catch { /* stale selection is ignored in the release picker */ }
  }
  const approvedImportSummaries = paged(importResult.data).items;
  const approvedImportDetails = await Promise.all(approvedImportSummaries.map(async (batch) => {
    if (Array.isArray(batch.rows) || batch.catalogOnly !== undefined || batch.isCatalogOnly !== undefined || batch.hasQuestionDrafts !== undefined || batch.questionDraftCount !== undefined) return batch;
    try { return (await api<{ data: ImportBatch }>(`/api/v1/admin/imports/${encodeURIComponent(batch.id)}`)).data; }
    catch { return batch; }
  }));
  const approvedImports = approvedImportDetails;
  const preferredCatalogDraft = approvedCatalogDrafts.some((draft) => draft.id === selectedCatalogDraftId) ? selectedCatalogDraftId : "";
  content(`<div class="page-head"><div><h1>草稿与复核</h1><div class="muted">编辑、跨人复核和发布权限相互独立</div></div><label class="inline-filter"><span>状态</span><select id="draft-status-filter"><option value="">全部状态</option>${["DRAFT","IN_REVIEW","APPROVED","REJECTED","PUBLISHED","CANCELLED"].map((status) => `<option value="${status}" ${status === draftStatus ? "selected" : ""}>${status}</option>`).join("")}</select></label></div>
    ${hasRole("PUBLISHER") ? `<section class="panel release-panel"><div class="release-toolbar"><input id="release-name" placeholder="发布批次名称"><select id="release-catalog-draft"><option value="">不发布目录变更</option>${approvedCatalogDrafts.map((draft) => `<option value="${escapeHtml(draft.id)}" ${draft.id === preferredCatalogDraft ? "selected" : ""}>目录：${escapeHtml(draft.name)}</option>`).join("")}</select><button class="primary" id="publish-selected">发布所选</button></div><div class="muted release-help">当前页可单独选择题目；选择 Excel 批次时，服务端会自动纳入该批次全部已批准题目，不受分页限制。目录候选最多展示最近 ${ADMIN_PAGE_SIZE} 条，可在目录页选择目标变更集后返回。</div></section><div class="notice release-notice">仅列出已复核通过的目录变更集和 Excel 批次。可以只发布目录、只发布题目，或将它们放入同一个原子发布批次。</div>${approvedImports.length ? `<section class="panel import-release-picker"><h3>待发布的 Excel 批次</h3><div class="import-batch-options">${approvedImports.map((batch) => `<label><input type="checkbox" class="release-import-check" value="${escapeHtml(batch.id)}"> <span><strong>${escapeHtml(batch.fileName)}</strong>${importBatchMeta(batch)}</span></label>`).join("")}</div></section>` : ""}` : ""}
    <div class="panel table-panel"><table><thead><tr><th>${hasRole("PUBLISHER") ? "选择" : ""}</th><th>题号</th><th>题型</th><th>题干</th><th>校验</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.items.map((draft) => { const selfSubmitted = Boolean(draft.submittedById && draft.submittedById === currentUser?.id); return `<tr><td>${hasRole("PUBLISHER") ? `<input type="checkbox" class="release-check" value="${escapeHtml(draft.id)}" ${draft.status === "APPROVED" ? "" : "disabled"}>` : ""}</td><td><code>${escapeHtml(draft.externalCode || draft.questionId)}</code></td><td>${escapeHtml(draft.type)}</td><td>${escapeHtml(String(draft.stem).slice(0,70))}</td><td><span class="tag ${((draft.validationErrors as unknown[]) || []).length ? "bad" : "good"}">错误 ${((draft.validationErrors as unknown[]) || []).length}</span><span class="tag warn">警告 ${((draft.validationWarnings as unknown[]) || []).length}</span></td><td>${statusTag(draft.status)}</td><td class="actions"><button class="secondary" data-diff-draft="${draft.id}">完整差异</button>${["DRAFT","REJECTED"].includes(String(draft.status)) && hasRole("EDITOR") ? `<button class="secondary" data-edit-draft="${draft.id}">编辑</button><button class="primary" data-submit-draft="${draft.id}">提交</button>` : ""}${draft.status === "IN_REVIEW" && hasRole("REVIEWER") ? `<button class="primary" data-review="${draft.id}" data-decision="APPROVED" ${selfSubmitted ? 'disabled title="提交人不能复核自己的草稿"' : ""}>通过</button><button class="danger" data-review="${draft.id}" data-decision="REJECTED" ${selfSubmitted ? 'disabled title="提交人不能复核自己的草稿"' : ""}>驳回</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="7" class="empty">当前状态下暂无草稿</td></tr>'}</tbody></table>${paginationHtml(data, "draft-pagination")}</div>`);
  document.querySelector<HTMLSelectElement>("#draft-status-filter")?.addEventListener("change", (event) => { draftStatus = (event.currentTarget as HTMLSelectElement).value; draftPage = 1; void draftsPage(); });
  bindPagination("draft-pagination", data, (nextPage) => { draftPage = nextPage; void draftsPage(); });
  document.querySelectorAll<HTMLButtonElement>("[data-edit-draft]").forEach((button) => button.addEventListener("click", () => void questionEditor(data.items.find((item) => item.id === button.dataset.editDraft)!)));
  document.querySelectorAll<HTMLButtonElement>("[data-submit-draft]").forEach((button) => button.addEventListener("click", async () => {
    const draft = data.items.find((item) => item.id === button.dataset.submitDraft)!;
    const warnings = ((draft.validationWarnings as unknown[]) || []).length;
    if (warnings && !confirm(`该题有 ${warnings} 条警告。确认已人工检查并提交复核？`)) return;
    try { await api(`/api/v1/admin/drafts/${button.dataset.submitDraft}/submit`, { method: "POST", body: JSON.stringify({ acknowledgeWarnings: warnings > 0 }) }); await draftsPage(); } catch (error) { notify(String(error), true); }
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-review]").forEach((button) => button.addEventListener("click", async () => { const comment = prompt(button.dataset.decision === "APPROVED" ? "复核说明（可选）" : "驳回原因") || ""; try { await api(`/api/v1/admin/drafts/${button.dataset.review}/review`, { method: "POST", body: JSON.stringify({ decision: button.dataset.decision, comment }) }); await draftsPage(); } catch (error) { notify(String(error), true); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-diff-draft]").forEach((button) => button.addEventListener("click", () => {
    const draft = data.items.find((item) => item.id === button.dataset.diffDraft)!;
    const mask = modal("题目完整字段差异", `<div class="muted">展示目录归属、题型、答案、媒体和发布动作等全部题目字段；橙色行表示发生变化。</div><div class="diff-scroll"><table><thead><tr><th>字段</th><th>发布前</th><th>候选内容</th></tr></thead><tbody>${questionDraftDiffRows(draft)}</tbody></table></div><div class="toolbar"><button class="secondary" data-close>关闭</button></div>`);
    mask.querySelector("[data-close]")?.addEventListener("click", () => mask.remove());
  }));
  document.querySelector("#publish-selected")?.addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>(".release-check:checked")).map((item) => item.value);
    const importBatchIds = Array.from(document.querySelectorAll<HTMLInputElement>(".release-import-check:checked")).map((item) => item.value);
    const name = document.querySelector<HTMLInputElement>("#release-name")!.value.trim();
    const catalogDraftId = document.querySelector<HTMLSelectElement>("#release-catalog-draft")!.value;
    if (!name) return notify("请填写发布批次名称", true);
    if (!ids.length && !catalogDraftId && !importBatchIds.length) return notify("请选择题目草稿、目录变更集或 Excel 批次", true);
    if (!confirm(`确定发布 ${ids.length} 个单独题目草稿、${catalogDraftId ? 1 : 0} 个目录变更集和 ${importBatchIds.length} 个完整 Excel 批次？`)) return;
    try { await api("/api/v1/admin/releases", { method: "POST", body: JSON.stringify({ name, draftIds: ids, catalogDraftId: catalogDraftId || undefined, importBatchIds }) }); notify("题库批次已原子发布"); if (catalogDraftId === selectedCatalogDraftId) { selectedCatalogDraftId = ""; sessionStorage.removeItem("qz_admin_catalog_draft"); } await draftsPage(); } catch (error) { notify(String(error), true); }
  });
}

async function importsPage(): Promise<void> {
  const result = await api<{ data: ImportBatch[] | Paged<ImportBatch> }>(`/api/v1/admin/imports?page=${importPage}&pageSize=${ADMIN_PAGE_SIZE}`);
  const data = paged(result.data, importPage);
  content(`<div class="page-head"><div><h1>Excel 导入导出</h1><div class="muted">错误行保留在暂存区，阻断错误未清零前不能提交复核</div></div><div class="toolbar"><a class="secondary" style="display:grid;place-items:center;text-decoration:none" href="/api/v1/admin/imports/template">下载标准模板</a><a class="secondary" style="display:grid;place-items:center;text-decoration:none" href="/api/v1/admin/exports/current.xlsx">导出当前题库</a></div></div>
    ${hasRole("EDITOR") ? '<section class="panel"><h3>上传工作簿</h3><form id="import-form" class="toolbar"><input type="file" name="file" accept=".xlsx" required><button class="primary">进入暂存校验</button></form></section>' : ""}
    <section class="panel table-panel"><h3>导入记录</h3><table><thead><tr><th>文件 / 冻结信息</th><th>行数</th><th>有效</th><th>错误</th><th>警告</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${data.items.map((batch) => { const selfSubmitted = Boolean(batch.submittedById && batch.submittedById === currentUser?.id); return `<tr><td><strong>${escapeHtml(batch.fileName)}</strong>${importBatchMeta(batch)}</td><td>${escapeHtml(batch.totalRows)}</td><td>${escapeHtml(batch.validRows)}</td><td>${escapeHtml(batch.errorRows)}</td><td>${escapeHtml(batch.warningRows)}</td><td>${statusTag(batch.status)}</td><td>${formatTime(batch.createdAt)}</td><td class="actions"><button class="secondary" data-import-detail="${batch.id}">查看报告</button>${["STAGING","VALID","REJECTED"].includes(String(batch.status)) && hasRole("EDITOR") ? `<button class="secondary" data-import-revalidate="${batch.id}">重新校验</button>` : ""}${batch.status === "VALID" && hasRole("EDITOR") ? `<button class="primary" data-import-submit="${batch.id}">提交复核</button>` : ""}${batch.status === "IN_REVIEW" && hasRole("REVIEWER") ? `<button class="primary" data-import-review="${batch.id}" data-decision="APPROVED" ${selfSubmitted ? 'disabled title="提交人不能复核自己的导入批次"' : ""}>通过</button><button class="danger" data-import-review="${batch.id}" data-decision="REJECTED" ${selfSubmitted ? 'disabled title="提交人不能复核自己的导入批次"' : ""}>驳回</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="8" class="empty">暂无导入记录</td></tr>'}</tbody></table>${paginationHtml(data, "import-pagination")}</section>`);
  document.querySelector<HTMLFormElement>("#import-form")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/v1/admin/imports", { method: "POST", body: new FormData(event.currentTarget as HTMLFormElement) }); notify("导入完成，请查看校验结果"); importPage = 1; await importsPage(); } catch (error) { notify(String(error), true); } });
  bindPagination("import-pagination", data, (nextPage) => { importPage = nextPage; void importsPage(); });
  document.querySelectorAll<HTMLButtonElement>("[data-import-revalidate]").forEach((button) => button.addEventListener("click", async () => { try { await api(`/api/v1/admin/imports/${button.dataset.importRevalidate}/revalidate`, { method: "POST", body: "{}" }); notify("批次已重新校验"); await importsPage(); } catch (error) { notify(String(error), true); } }));
  document.querySelectorAll<HTMLButtonElement>("[data-import-submit]").forEach((button) => button.addEventListener("click", async () => {
    const batch = data.items.find((item) => item.id === button.dataset.importSubmit)!;
    const warnings = Number(batch.warningRows || 0);
    if (warnings && !confirm(`批次有 ${warnings} 行警告。确认已人工检查全部警告？`)) return;
    try { await api(`/api/v1/admin/imports/${button.dataset.importSubmit}/submit`, { method: "POST", body: JSON.stringify({ acknowledgeWarnings: warnings > 0 }) }); notify("Excel 导入批次已冻结并提交复核"); await importsPage(); } catch (error) { notify(String(error), true); }
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-import-review]").forEach((button) => button.addEventListener("click", async () => {
    const decision = button.dataset.decision!;
    const comment = prompt(decision === "APPROVED" ? "整批复核说明（可选）" : "整批驳回原因") || "";
    if (decision === "REJECTED" && !comment.trim()) return notify("驳回时请填写原因", true);
    try { await api(`/api/v1/admin/imports/${button.dataset.importReview}/review`, { method: "POST", body: JSON.stringify({ decision, comment }) }); notify(decision === "APPROVED" ? "Excel 导入批次已复核通过" : "Excel 导入批次已驳回"); await importsPage(); } catch (error) { notify(String(error), true); }
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-import-detail]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await api<{ data: Json }>(`/api/v1/admin/imports/${button.dataset.importDetail}`);
      const detail = result.data as ImportBatch;
      const rows = detail.rows || [];
      const visibleRows = rows.slice(0, 500);
      const reviews = importReviews(detail);
      const mask = modal("导入校验与复核报告", `<div class="page-head"><div><div class="muted">合法行、错误行和警告均永久保留${rows.length > visibleRows.length ? `；当前仅展示前 ${visibleRows.length} / ${rows.length} 行` : ""}</div>${importBatchMeta(detail)}</div><button class="secondary" data-close>关闭</button></div>${reviews.length ? `<section class="review-history"><h3>复核记录</h3>${reviews.map((review) => `<div class="review-item"><div>${statusTag(review.decision)} <code>${escapeHtml(review.reviewerId || review.adminUserId || "—")}</code> <span class="muted">${formatTime(review.createdAt)}</span></div><div>${escapeHtml(review.comment || "无说明")}</div></div>`).join("")}</section>` : ""}<div style="max-height:55vh;overflow:auto"><table><thead><tr><th>工作表</th><th>行号</th><th>错误</th><th>警告</th></tr></thead><tbody>${visibleRows.map((row) => `<tr><td>${escapeHtml(row.entityType)}</td><td>${escapeHtml(row.rowNumber)}</td><td class="bad-text">${escapeHtml(((row.errors as unknown[]) || []).join("；") || "—")}</td><td>${escapeHtml(((row.warnings as unknown[]) || []).join("；") || "—")}</td></tr>`).join("")}</tbody></table></div>`);
      mask.querySelector("[data-close]")?.addEventListener("click", () => mask.remove());
    } catch (error) { notify(String(error), true); }
  }));
}

async function releasesPage(): Promise<void> {
  const result = await api<{ data: Json[] | Paged<Json> }>(`/api/v1/admin/releases?page=${releasePage}&pageSize=${ADMIN_PAGE_SIZE}`);
  const data = paged(result.data, releasePage);
  const failedCount = data.items.filter((release) => release.verificationStatus === "FAILED").length;
  content(`<div class="page-head"><div><h1>发布与回滚</h1><div class="muted">发布后自检失败会冻结后续发布；回滚会生成新记录，不修改历史版本</div></div></div>${failedCount ? `<div class="release-freeze-banner"><strong>当前页有 ${failedCount} 个发布自检失败</strong><span>失败的活动版本会冻结发布，请由 OWNER 查看报告并重试，或由 PUBLISHER 回滚。</span></div>` : ""}<div class="panel table-panel"><table><thead><tr><th>批次</th><th>类型 / 题量</th><th>质量目标</th><th>快照哈希</th><th>发布状态</th><th>发布后自检</th><th>异常计数</th><th>发布时间</th><th>操作</th></tr></thead><tbody>${data.items.map((release) => { const warnings = (release.qualityWarnings as Json[]) || []; const summary = release.qualitySummary as Json | null; const report = (release.verificationReport as Json | null) || {}; const verification = String(release.verificationStatus || "PENDING"); const validationErrors = Number(release.validationErrorCount ?? report.validationErrorCount ?? 0); const missingVersions = Number(release.missingVersionCount ?? report.missingVersionCount ?? 0); const uploadFailures = Number(release.objectUploadFailureCount ?? report.objectUploadFailureCount ?? 0); const api5xx = Number(release.api5xxCount || 0); const failed = verification === "FAILED" || release.status === "FAILED"; return `<tr class="${failed ? "release-failed" : ""}"><td><strong>${escapeHtml(release.name)}</strong>${failed ? '<div class="bad-text">自检或发布失败；活动版本会冻结后续发布</div>' : ""}</td><td>${escapeHtml(release.kind)}<br><span class="muted">${escapeHtml(release.questionCount)} 题</span></td><td><button class="secondary" data-release-quality="${release.id}">${warnings.length ? `警告 ${warnings.length}` : `通过（${escapeHtml(summary?.configuredSubjectCount || 0)} 学科）`}</button></td><td><code>${escapeHtml(String(release.snapshotHash || "").slice(0,16))}</code></td><td>${statusTag(release.status)}${release.failureReason ? `<div class="bad-text">${escapeHtml(String(release.failureReason).slice(0, 120))}</div>` : ""}</td><td><button class="verification-button ${verification.toLowerCase()}" data-verification-report="${release.id}">${escapeHtml(verification)}</button><div class="muted">${escapeHtml(release.verificationDurationMs || report.durationMs || 0)} ms</div></td><td><div class="counter-grid"><span class="${validationErrors ? "bad-text" : ""}">校验 ${validationErrors}</span><span class="${missingVersions ? "bad-text" : ""}">缺版 ${missingVersions}</span><span class="${uploadFailures ? "bad-text" : ""}">对象 ${uploadFailures}</span><span class="${api5xx ? "bad-text" : ""}">5xx ${api5xx}</span></div></td><td>${formatTime(release.publishedAt)}</td><td class="actions">${verification === "FAILED" && hasRole("OWNER") && release.status === "PUBLISHED" ? `<button class="primary" data-retry-verification="${release.id}">重试自检</button>` : ""}${release.status === "PUBLISHED" && hasRole("PUBLISHER") ? `<button class="danger" data-rollback="${release.id}">回滚至此</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="9" class="empty">暂无发布记录</td></tr>'}</tbody></table>${paginationHtml(data, "release-pagination")}</div>`);
  bindPagination("release-pagination", data, (nextPage) => { releasePage = nextPage; void releasesPage(); });
  document.querySelectorAll<HTMLButtonElement>("[data-release-quality]").forEach((button) => button.addEventListener("click", () => {
    const release = data.items.find((item) => item.id === button.dataset.releaseQuality)!;
    const warnings = (release.qualityWarnings as Json[]) || [];
    const summary = release.qualitySummary as Json | null;
    const warningRows = warnings.length
      ? `<table><thead><tr><th>学科</th><th>维度</th><th>目标项</th><th>实际</th><th>说明</th></tr></thead><tbody>${warnings.map((warning) => `<tr><td>${escapeHtml(warning.subjectId)}</td><td>${escapeHtml(warning.dimension)}</td><td>${escapeHtml(warning.key)}</td><td>${escapeHtml(warning.actual)}</td><td>${escapeHtml(warning.message)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="tag good">全部已配置质量目标均满足</div>`;
    modal("发布质量报告", `<div class="muted">已评估 ${escapeHtml(summary?.configuredSubjectCount || 0)} 个学科；普通目标偏差仅告警，不阻止发布。408 组卷约束仍为阻断项。</div><div style="margin-top:16px;max-height:55vh;overflow:auto">${warningRows}</div><details style="margin-top:16px"><summary>查看策略与计数摘要</summary><pre>${escapeHtml(JSON.stringify(summary || {}, null, 2))}</pre></details>`);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-verification-report]").forEach((button) => button.addEventListener("click", () => {
    const release = data.items.find((item) => item.id === button.dataset.verificationReport)!;
    const report = (release.verificationReport as Json | null) || {};
    const checks = (report.checks as Json[]) || [];
    modal("发布后自检报告", `<div class="verification-summary"><div>${statusTag(release.verificationStatus || "PENDING")}</div><div>开始：${formatTime(release.verificationStartedAt)}</div><div>完成：${formatTime(release.verificationCompletedAt)}</div><div>耗时：${escapeHtml(release.verificationDurationMs || report.durationMs || 0)} ms</div></div>${release.verificationStatus === "FAILED" ? '<div class="release-freeze-banner compact"><strong>自检失败，活动发布可能已被冻结</strong><span>请修复报告中的问题后由 OWNER 重试自检，或由 PUBLISHER 回滚。</span></div>' : ""}<table><thead><tr><th>检查项</th><th>结果</th><th>详情</th></tr></thead><tbody>${checks.map((check) => `<tr><td>${escapeHtml(check.name)}</td><td>${statusTag(check.ok ? "PASSED" : "FAILED")}</td><td>${escapeHtml(check.detail || "—")}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">尚无检查明细</td></tr>'}</tbody></table><details style="margin-top:16px"><summary>查看原始报告</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>`);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-retry-verification]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("确定重新执行该发布版本的完整发布后自检？通过后会解除相应发布冻结。")) return;
    try { await api(`/api/v1/admin/releases/${button.dataset.retryVerification}/retry-verification`, { method: "POST", body: "{}" }); notify("发布后自检已重新执行"); await releasesPage(); } catch (error) { notify(String(error), true); }
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-rollback]").forEach((button) => button.addEventListener("click", async () => { if (!confirm("确定创建回滚发布？历史答题不受影响。")) return; try { await api(`/api/v1/admin/releases/${button.dataset.rollback}/rollback`, { method: "POST", body: "{}" }); notify("回滚发布完成"); await releasesPage(); } catch (error) { notify(String(error), true); } }));
}

async function mediaPage(): Promise<void> {
  const result = await api<{ data: Json[] | Paged<Json> }>(`/api/v1/admin/media?page=${mediaPageNumber}&pageSize=${ADMIN_PAGE_SIZE}`);
  const data = paged(result.data, mediaPageNumber);
  content(`<div class="page-head"><div><h1>媒体库</h1><div class="muted">PNG、JPEG、WebP，单图不超过 1MB，按 SHA-256 去重</div></div></div>${hasRole("EDITOR") ? '<section class="panel"><form id="media-form" class="toolbar"><input name="file" type="file" accept="image/png,image/jpeg,image/webp" required><button class="primary">上传并校验</button></form></section>' : ""}<section class="panel table-panel"><table><thead><tr><th>预览</th><th>对象键</th><th>类型</th><th>大小</th><th>哈希</th><th>状态</th></tr></thead><tbody>${data.items.map((asset) => `<tr><td>${asset.publicUrl ? `<img src="${escapeHtml(asset.publicUrl)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:8px">` : "—"}</td><td><code>${escapeHtml(asset.objectKey)}</code></td><td>${escapeHtml(asset.mimeType)}</td><td>${Math.round(Number(asset.size)/1024)} KB</td><td><code>${escapeHtml(String(asset.sha256 || "").slice(0,12))}</code></td><td>${statusTag(asset.status)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">暂无媒体资源</td></tr>'}</tbody></table>${paginationHtml(data, "media-pagination")}</section>`);
  document.querySelector<HTMLFormElement>("#media-form")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/v1/admin/media/upload", { method: "POST", body: new FormData(event.currentTarget as HTMLFormElement) }); notify("媒体上传完成"); mediaPageNumber = 1; await mediaPage(); } catch (error) { notify(String(error), true); } });
  bindPagination("media-pagination", data, (nextPage) => { mediaPageNumber = nextPage; void mediaPage(); });
}

async function auditPage(): Promise<void> {
  const result = await api<{ data: Paged<Json> }>(`/api/v1/admin/audit-logs?page=${auditPageNumber}&pageSize=${ADMIN_PAGE_SIZE}`);
  const data = paged(result.data, auditPageNumber);
  content(`<div class="page-head"><div><h1>操作审计</h1><div class="muted">发布、复核、导入和权限变更永久留痕</div></div></div><div class="panel table-panel"><table><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>对象</th><th>请求 ID</th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${formatTime(item.createdAt)}</td><td>${escapeHtml((item.adminUser as Json)?.displayName || "系统")}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entityType)} / ${escapeHtml(item.entityId || "—")}</td><td><code>${escapeHtml(item.requestId || "—")}</code></td></tr>`).join("") || '<tr><td colspan="5" class="empty">暂无审计记录</td></tr>'}</tbody></table>${paginationHtml(data, "audit-pagination")}</div>`);
  bindPagination("audit-pagination", data, (nextPage) => { auditPageNumber = nextPage; void auditPage(); });
}

async function usersPage(): Promise<void> {
  const { data } = await api<{ data: Json[] }>("/api/v1/admin/users");
  content(`<div class="page-head"><div><h1>管理员</h1><div class="muted">新账号和 TOTP 重置通过服务器交互式 CLI 完成；权限或状态变更会撤销该账号现有会话</div></div></div><div class="notice">OWNER 拥有全部权限；EDITOR、REVIEWER、PUBLISHER 分别负责编辑提交、跨人复核和发布回滚。修改后目标管理员必须重新登录。</div><div class="panel"><table><thead><tr><th>账号</th><th>显示名称</th><th>权限</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${data.map((user) => `<tr><td><code>${escapeHtml(user.username)}</code>${user.id === currentUser?.id ? ' <span class="tag good">当前账号</span>' : ""}</td><td>${escapeHtml(user.displayName)}</td><td>${((user.roles as string[]) || []).map((role) => `<span class="tag">${escapeHtml(role)}</span>`).join("")}</td><td>${statusTag(user.status)}</td><td>${formatTime(user.lastLoginAt)}</td><td><button class="secondary" data-edit-user="${escapeHtml(user.id)}">编辑权限与状态</button></td></tr>`).join("")}</tbody></table></div>`);
  document.querySelectorAll<HTMLButtonElement>("[data-edit-user]").forEach((button) => button.addEventListener("click", () => {
    const user = data.find((item) => item.id === button.dataset.editUser)!;
    const selected = new Set((user.roles as string[]) || []);
    const mask = modal("编辑管理员权限", `<form id="user-access-form"><div class="notice"><strong>${escapeHtml(user.displayName)}</strong>（${escapeHtml(user.username)}）保存后，其全部现有管理会话会立即撤销，需要重新登录。</div><div class="field"><span>角色</span><div class="role-grid">${["OWNER","EDITOR","REVIEWER","PUBLISHER"].map((role) => `<label><input type="checkbox" name="roles" value="${role}" ${selected.has(role) ? "checked" : ""}> <strong>${role}</strong></label>`).join("")}</div></div><label class="field"><span>账号状态</span><select name="status"><option value="ACTIVE" ${user.status === "ACTIVE" ? "selected" : ""}>ACTIVE</option><option value="DISABLED" ${user.status === "DISABLED" ? "selected" : ""}>DISABLED</option></select></label><button class="danger wide">保存并撤销该账号会话</button></form>`);
    mask.querySelector<HTMLFormElement>("#user-access-form")!.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const roles = form.getAll("roles").map(String);
      const status = String(form.get("status") || "ACTIVE");
      if (!roles.length) return notify("管理员至少需要一个角色", true);
      const affectsSelf = user.id === currentUser?.id;
      const warning = affectsSelf ? "你正在修改当前登录账号，保存后本会话也可能立即失效。确定继续？" : "保存会撤销该管理员的全部现有会话。确定继续？";
      if (!confirm(warning)) return;
      try {
        await api(`/api/v1/admin/users/${encodeURIComponent(String(user.id))}`, { method: "PATCH", body: JSON.stringify({ roles, status }) });
        mask.remove();
        if (affectsSelf) { csrfToken = ""; sessionStorage.removeItem("qz_admin_csrf"); showLogin("权限已更新，请重新登录"); }
        else { notify("管理员权限已更新，现有会话已撤销"); await usersPage(); }
      } catch (error) { notify(String(error), true); }
    });
  }));
}

async function boot(): Promise<void> {
  try {
    const result = await api<{ data: typeof currentUser }>("/api/v1/admin/auth/me");
    currentUser = result.data;
    if (!csrfToken) return showLogin("管理会话需要重新验证");
    renderShell();
  } catch { showLogin(); }
}

void boot();
