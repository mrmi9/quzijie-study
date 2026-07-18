# 标准化题库管理手册

## 1. 系统边界

正式题库以 MySQL 为唯一工作数据源。`content/*-questions.json` 与 `miniprogram/data/questions.js` 仅用于首次基线导入和开发 Mock，不是生产编辑入口。正式发布后，小程序通过 `GET /api/v1/catalog` 和现有练习接口读取当前数据库版本，新增或修订题目不需要重新上传小程序。

系统设计上限为 10 万道有效题。题目 ID 和外部题号全局唯一；题目已发布版本、发布批次、审计记录及发布快照不可变且永久保留。所谓“删除”一律通过停用草稿发布，不物理删除历史题目。

## 2. 生产环境配置

在微信云托管服务的加密环境变量中配置：

```text
ADMIN_ENABLED=true
ADMIN_ENCRYPTION_KEY=<至少 32 位、随机且长期稳定的密钥>
ADMIN_SESSION_TTL_HOURS=12
ADMIN_REVIEW_POLICY=single-owner
ADMIN_BOOTSTRAP_TOKEN_HASH=<首次网页建号令牌的 SHA-256；建号后删除该变量>
QUESTION_BANK_STORAGE=cos
COS_SECRET_ID=<只授予目标存储桶必要权限的密钥>
COS_SECRET_KEY=<加密环境变量>
COS_BUCKET=<存储桶名-APPID>
COS_REGION=<例如 ap-shanghai>
COS_PUBLIC_BASE_URL=<生产环境必须留空并由 API 代理读取；仅非生产调试可选>
```

`ADMIN_ENCRYPTION_KEY` 用于加密 TOTP 种子，不能随意更换；更换前必须为全部管理员重置 TOTP。数据库密码、COS 密钥、管理员密码和 TOTP 种子不得进入 Git、Excel、截图或应用日志。

生产发布前先使用 `ops/backup-mysql.sh` 生成并校验 MySQL 一致性备份；定期使用 `ops/restore-mysql.sh` 恢复到一次性数据库演练，具体确认变量见 [生产运行手册](OPERATIONS_RUNBOOK.md)。对象存储应为 `question-bank/releases/` 与 `question-bank/media/sha256/` 配置永久保留策略，为 `question-bank/imports/` 原始工作簿和 `question-bank/media/uploads/` 未完成临时对象配置 30 天生命周期；已被发布快照引用的对象不得清理。先运行 `npm run storage:lifecycle --workspace server` 查看合并后的托管规则，再由运营者显式追加 `-- --apply`；脚本会保留桶内非本系统规则，且绝不会给永久前缀配置过期。发布失败遗留的快照对象使用 `npm run storage:cleanup --workspace server` 预览，确认后追加 `-- --apply`；命令只处理超过保留期且数据库状态为 `FAILED` 的发布，并拒绝删除当前或任何已发布快照，不能对整个 `releases/` 前缀设置过期规则。

## 3. 管理员与权限

管理后台地址为当前云托管 HTTPS 域名的 `/admin/`。权限分为：

- `OWNER`：管理员、审计和全部操作；
- `EDITOR`：学科、章节、题目草稿、Excel 和媒体；
- `REVIEWER`：复核或驳回已提交草稿；
- `PUBLISHER`：发布和回滚。

`ADMIN_REVIEW_POLICY=two-person`（默认）时，系统强制禁止提交人复核自己的草稿；`single-owner` 时仅允许 `OWNER` 对自己已经冻结的内容执行自检，普通角色仍不能自审。两种模式都强制至少保留一个启用的所有者。所有非 GET 管理请求均验证安全 Cookie 和 CSRF；登录同时验证 Argon2id 密码与 6 位 TOTP，连续失败会触发锁定。无论采用哪种复核策略，发布和回滚都必须再次输入当前 TOTP，并核对服务端生成的变更摘要与确认文字。

生产首次启用可在 `/admin/setup` 创建第一个所有者。先在可信环境生成至少 32 字节随机令牌，只把令牌的 SHA-256 十六进制值写入 `ADMIN_BOOTSTRAP_TOKEN_HASH`；原令牌仅在设置页输入，不放入 URL、Git、日志或截图。设置页只在管理员表为空时开放，完成密码和 TOTP 验证后自动创建拥有四种权限的所有者并永久关闭。建号成功后应删除该环境变量。命令行工具继续用于应急重置。

首次建号和后续重置使用交互式 CLI：

```powershell
npm run admin:manage --workspace server -- create
npm run admin:manage --workspace server -- reset-password
npm run admin:manage --workspace server -- reset-totp
npm run admin:manage --workspace server -- disable
```

从已构建的 CloudRun 镜像交互执行时改用 `admin:manage:compiled`；创建账号与重置 TOTP 必须同时连接真实 stdin/stdout TTY，命令会拒绝管道和重定向，避免密码或种子进入日志。

CLI 只在交互终端运行，密码输入不回显；禁止通过参数、重定向或管道传入密码。新 TOTP 密钥只显示一次，应立即录入验证器并从终端历史、录屏和工单中排除。重置密码、TOTP 或停用账号会撤销该账号全部管理会话，并写入审计日志；CLI 和 Web 后台都禁止停用最后一个启用的 `OWNER`。

## 4. 标准内容流程

1. 编辑者在“已发布题目”中新建/修订，或从“Excel 导入导出”下载标准模板并批量导入。
2. Excel 的学科、章节、题目、选项、填空答案和媒体行全部进入导入报告；相同文件由同一管理员重复导入时返回原批次，不重复建题。原始 XLSX 存入题库对象存储并保留 30 天，错误行不会被丢弃。
3. 编辑者处理全部阻断错误；警告需人工确认。点击“重新校验”后，只有错误数为零的批次才能“提交复核”。
4. 提交后内容冻结。双人模式由非提交人复核；单管理员模式由所有者查看发布前/候选字段差异、答题预览和校验结论，完成自检清单并填写说明。任何后续修改都会使批准失效。
5. 发布者勾选已批准草稿，先查看服务端重新计算的新增、修订、停用、目录变化和质量警告摘要，再输入确认文字与当前 TOTP。系统校验候选哈希未变化后生成完整快照、计算 SHA-256、上传并回读校验，再在发布锁和单个 MySQL 串行事务中创建不可变版本、切换题目指针和当前发布指针。
6. 当前发布指针切换后，服务会立即校验快照对象与 SHA-256、目录投影、题量、当前题目版本、媒体对象和 408 组卷结构，并把报告固化在发布记录。任一检查失败都会将该发布标为“验证失败”并自动冻结后续普通发布；回滚仍然可用。所有者修复外部对象或临时故障后，可调用 `POST /api/v1/admin/releases/:id/retry-verification` 重试当前活动发布，只有全项通过才自动解除冻结。
7. 单题内容异常时创建“停用”草稿走同一复核发布流程；整批异常时从“发布与回滚”选择历史发布。回滚本身会产生新的发布记录和快照，不修改旧记录，不影响历史答题快照。

在线维护学科、章节和首页模块时，必须先在“学科与章节”创建目录变更集。编辑只更新该变更集的完整候选目录，不直接修改线上目录表；提交时内容以 SHA-256 冻结，并按当前复核策略完成独立复核或所有者自检。发布者只能选择批准且仍基于当前线上目录哈希的变更集，线上目录已变化时必须重新创建、提交和复核。目录变更可单独发布，也可与题目草稿同批发布；在线新建的学科和章节需先发布目录后再创建题目。Excel 批次中的目录候选随整批题目完成同一次复核或自检，不再重复创建目录变更集，但仍必须整批发布且不能与在线目录候选发生冲突。

尚未发布的目录草稿可在“学科与章节”中执行“作废草稿”。作废是保留内容和审计记录的软删除，只允许 `DRAFT`、`IN_REVIEW`、`APPROVED` 和 `REJECTED` 状态执行；作废后不能继续编辑、复核或发布，且不会影响线上目录。普通列表默认隐藏已作废草稿，需要追溯时可勾选“显示已作废”。已经发布的目录变更不能作废，内容回退必须从“发布与回滚”创建新的回滚发布记录。

## 5. Excel 规则

标准工作簿和“导出当前题库”均严格包含“学科、章节、题目、选项、填空答案、媒体”六张数据工作表，并保留第七张“说明”辅助表，可按同一结构往返编辑。题目通过 `external_code` 或已有 `question_id` 与选项/填空答案的 `question_ref` 稳定关联；已有外部题号会创建新草稿版本，新外部题号会生成稳定内部 ID。填空答案按 `blank_index`（从 1 开始连续编号）逐行维护，一个空可配置多个可接受答案；为兼容旧文件仍接受 `accepted_answers_json`，两处同时填写时内容必须一致。媒体表的 `asset_id`、`object_url`、`sha256` 至少填写一个，且必须指向媒体库中处于 `READY` 状态的同一资源；`alt` 必填。

“学科”表的 `quality_policy_json` 可配置发布质量目标。它只允许 `questionTypes`、`difficulties`、`chapters` 三个对象，每一项只允许 0–100000 的整数 `min`/`max`，且 `min` 不得大于 `max`；未知字段、未知题型、非 1–3 的难度或非法章节 ID 会阻断导入。规范示例：

```json
{
  "questionTypes": { "SINGLE": { "min": 20, "max": 200 } },
  "difficulties": { "1": { "min": 5 }, "3": { "max": 50 } },
  "chapters": { "cpp-pointer": { "min": 5, "max": 100 } }
}
```

导入中的学科策略与其他目录字段一样只作为候选保存，复核通过并发布前不会进入公开目录。发布时系统按候选题库逐学科统计题型、难度和章节数量；普通目标偏差只写入该发布记录的质量警告与计数摘要，不阻止发布，结构错误和 408 题池不足仍会阻断。后台“发布与回滚”可查看每次发布固化的策略、实际计数和警告；“导出当前题库”从当前发布快照回写同一 `quality_policy_json`，可以往返维护。

题型值为 `single`、`multiple`、`judge`、`fill_blank`、`short_answer`：

- 选择/判断题填写 `correct_option_ids`；
- 填空题的 `accepted_answers_json` 是二维数组，每个内层数组是一空的可接受答案；
- 填空判定默认执行 NFKC、首尾空白和连续空白规范化，可通过大小写/标点字段调整；
- 简答题必须填写 `reference_answer`，用户提交后自评“掌握/未掌握”；
- `exam_scopes` 目前只允许 `408`，且 408 只接受四学科单选题。

导入会阻断缺失字段、引用错误、题型答案结构错误、重复题号/选项、未完成媒体及 408 题池不足。近似题干、解析偏短和分布质量目标作为警告展示。服务先完成整本工作簿预校验；只要任一行存在阻断错误，学科、章节和题目草稿都不会落库。全表通过后，目录变更和草稿生成才会在同一个 MySQL 事务内原子执行；并发冲突或落库失败会整体回滚并回写暂存报告。“重新校验”会重新计算每行错误、警告及批次统计，不沿用已经失效的旧报告。

## 6. 媒体与快照

题图支持 PNG、JPEG、WebP，单图不超过 1MB，宽高不超过 4096×4096。服务端校验文件头、MIME、真实尺寸和 SHA-256，并按哈希去重。未处于 `READY` 的媒体不能被草稿发布。

发布快照包含模块、学科、章节、题目、选项、答案和版本 ID，存放于：

```text
question-bank/releases/<release-id>/<sha256>.json
```

数据库的 `question_releases.snapshot_hash` 必须与对象回读内容一致。发布失败不会切换线上指针；失败对象按 30 天生命周期清理。

## 7. 验证命令

必须使用独立测试数据库，数据库名建议分别以 `_test` 和 `_migration_test` 结尾，禁止把生产 URL 传入测试命令。

```powershell
npm run verify:miniprogram
npm run verify:server
$env:MIGRATION_TEST_DATABASE_URL='mysql://.../quzijie_migration_test'
npm run verify:migration
$env:TEST_DATABASE_URL='mysql://.../quzijie_test'
npm run verify:integration
npm run admin:build
npm run check:release
```

`verify:migration` 从旧三版迁移构造 7 学科、45 章节、500 题和代表性的历史会话、错题、收藏、积分数据，再执行管理系统迁移并逐项核对数量、JSON 回填、全文索引与外键。

确需更新离线开发演示包时，可从当前发布或指定发布重新生成 Mock：

```powershell
$env:RELEASE_ID='<可选发布 ID>'
npm run db:export-mock --workspace server
npm run verify:miniprogram
```

该命令只写开发 Mock 文件，不影响数据库和线上发布指针。

## 8. 监控与故障处置

每次发布记录发布耗时、成功/失败、题量、校验错误/警告、快照键和哈希。重点告警：发布失败、对象上传/回读失败、当前版本缺失、408 题池不足、持续 API 5xx 和容器重启。

故障时先停止后续发布，再保留请求 ID、发布 ID 和日志；不要直接改生产表。能定位到批次时执行整批回滚，单题问题走停用草稿。确认 `/ready=200`、目录与随机练习恢复后再解除发布冻结。
