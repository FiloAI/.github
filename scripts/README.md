# FiloAI org 自动化脚本

## pr-merge-sweep.mjs — owner 侧 PR 合并 sweep

2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人（zqchris / jerboy / GaoWeiLiuXD 等）的定时任务执行本脚本。

```bash
node scripts/pr-merge-sweep.mjs --dry-run   # 只看决策不合并
node scripts/pr-merge-sweep.mjs --dry-run --publish-status # 同步把未合并原因直接写到 PR
node scripts/pr-merge-sweep.mjs --dry-run --repo FiloAI/filoai-frontend   # 只扫一个仓
node scripts/pr-merge-sweep.mjs --repo FiloAI/filoai-frontend --pr 3410 --expected-head <40位本机AI已审SHA> # 定点合并
```

门禁（全过才合并）：非 draft + base 在仓库允许列表 + 无 `no-automerge` + `mergeable=MERGEABLE` + 当前 base ruleset 声明的全部 required checks 绿 + 0 未解决 review thread + **当前 head 至少有一次可审计的非作者人工或 owner-side AI 审核答复** + **结构化产品取舍门通过**。CI 绿本身不能合并；Cursor、Greptile、Codex 等任何具体 provider 都不是必需依赖。没有 required checks 的仓库不虚构 `summary`。`needs-human-review` 标签、外部机器人的风险评级、`未批准` 或 `转人工` 本身都不是门禁；只有具备权限的真人明确阻止才需要真人针对当前 head 放行。

### 产品取舍门：只认结构化 marker

产品取舍门只处理明确声明为 P0/P1 的结构化 finding。它不再猜测中英文自然语言，不恢复评论编辑历史，不做编辑距离或跨来源同秒排序。推荐协议如下（marker 中的 actor 由 GitHub 评论作者决定）：

```html
<!-- filoai:finding id=<stable-id> severity=P1 kind=behavior -->
<!-- filoai:product-disposition finding=<stable-id> action=defer -->
<!-- filoai:product-disposition finding=<stable-id> action=accept-deferral -->
<!-- filoai:product-disposition finding=<stable-id> action=approve head=<40位当前head SHA> -->
<!-- filoai:product-disposition finding=<stable-id> action=withdraw head=<40位当前head SHA> -->
```

`finding` 只能来自正式 review 或 inline review comment，不能由普通 issue comment 创建；`defer` 只能由 PR 作者发布；`accept-deferral` 只能由创建该 finding 的原 reviewer 发布；`approve` 只能由 FiloAI owner（`zqchris`、`jerboy`、`GaoWeiLiuXD`）发布，且必须绑定当前完整 head SHA。`withdraw` 由原 reviewer 或 owner 发布，也必须绑定当前 head，并会使之前的授权失效。事件只按评论 `created_at` 处理，编辑后的内容不会制造新的授权事件。

没有 defer 的 finding 不会触发产品取舍门；非 owner 作者有 defer 但缺少对应 acceptance/approval、marker 格式错误、finding 不匹配、actor 越权或 head 过期，一律 fail-closed。owner 作者的显式 defer 视为自身产品决定，但 withdraw 后仍须重新 defer 或获得新的授权。自由文本只能触发人工提醒，不能构成放行证据。

不属于脚本门禁：Greptile、GitHub Codex、Cursor Bugbot、Cursor Approval Agent 或 Cursor Security Agent 的到场、缺席、超时、失败、拒审、风险评级、`未批准` 或 `转人工`，以及 Confidence、PR 大小、commit 数、作者身份分级、feat/fix 类型、视觉或产品方向分类。定时任务在调用定点合并前必须完整审查当前 head；外部 reviewer 已给出的具体可行动意见／安全 finding 与管家自审发现都必须写成 inline review thread 并闭环。机器人没有给出具体缺陷或覆盖不足时走管家代码／安全代审，不能让已满足硬门禁的 PR 永久等待。

列表接口暂时返回 `mergeable=UNKNOWN` 时会立即回读该 PR 的实时状态，不会把旧 PR 永久跳过；满足门禁的 PR 也不再受每仓固定合并配额限制。`--publish-status` 会幂等更新同一条 PR 状态评论，直接写明本轮不能合并的原因。高风险路径或标签会另行幂等更新 owner 请求评论，直接 `@zqchris @jerboy @GaoWeiLiuXD`；非 owner 作者时还会尝试正式 request Chris。这个流程由合并管家执行，不依赖 Cursor。

### PR 状态回复的人话契约

状态回复必须先给结论，再给原因、唯一行动人、下一步和自动复查承诺；禁止把
`mergeable=CONFLICTING`、`draft`、`required checks 未通过` 等内部 enum 当作唯一说明。
冲突要写成“PR 分支和最新 main 有代码冲突，请 PR 作者合并 main、解决冲突并 push”；
“当前 head 尚无审核凭证”要说明这是当前提交的新审核，不是误报，也不是一次提示后停止，
作者通常无需操作，管家会继续审核并复查。CI 阻塞必须列出具体 check 名称和结论；多个已知
确定性阻塞要在同一条状态回复中并列展示。原始机器原因保留在折叠技术细节中，便于维护者排查。

### CI 红灯桥接

PR 总管预检会把当前 head 的 CI 失败/恢复原子写入本机
`~/.agents/skills/git-workflow/sweeps/_merge-steward-ci.json`，以
`repo#PR + head + 失败指纹` 去重。合并管家每轮先消费这份线索，再回读 live GitHub；
当 bridge 与当前 head 一致且 CI 失败时，`--publish-status` 的 PR 回复会附上失败 check
名称与结论。bridge 不是合并授权，也不会让旧 head 的失败污染新 head；CI 恢复或 head
变化才产生新的状态事件。

Owner-side AI 审核当前 head 无问题后写入：

```html
<!-- filoai-merge-steward:reviewed head=<40位SHA> verdict=pass -->
```

非 owner 作者提交的高风险改动，经 FiloAI owner（zqchris、jerboy 或 GaoWeiLiuXD）确认当前 head 后写入：

```html
<!-- filoai-merge-steward:owner-approved head=<40位SHA> -->
```

FiloAI owner（zqchris、jerboy 或 GaoWeiLiuXD）自己提交的 PR 不再设置额外 owner 确认门；required CI、当前 head 审核证据、未解决线程和明确人工阻塞仍照常检查。

脚本不会自动 approve、不会写“终审意见”、不会创建“团队待办”，也不使用 `--admin` 绕过 GitHub 规则。定点实合并必须用 `--expected-head` 传入本机 AI 已审的完整 SHA，并继续用 `--match-head-commit` 绑定该 head；合并前会重读 PR 元数据与全部硬门禁，合并后回读 merged / queued / scheduled 实时状态。

实合并永久禁止不带 `--pr` 的裸跑，避免跳过管家对具体 head 的完整审查。定点合并失败时，脚本会在对应 PR 回复 GitHub 返回的具体原因，并用本次实时观察到的 head 隐藏标记更新同一条评论，避免周期任务重复刷屏；合并命令已成功但最终状态暂时无法回读时，会明确写“结果待确认”，不会误报合并失败。评论本身发送失败只记日志，不覆盖原始错误。

活体任务由 Cindy scheduler 管理；前置检查脚本必须通过 `schedule_set_pre_run_hook` 安装和自测，不直接写入 ignored 的 `scripts/schedule-checks/`。仓库里的本文件只记录脚本契约，不作为另一套流程规范。

想让某个 PR 不被自动合并：打 `no-automerge` 标签或保持 draft。
