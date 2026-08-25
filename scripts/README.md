# FiloAI org 自动化脚本

## pr-merge-sweep.mjs — owner 侧 PR 合并 sweep

2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人（zqchris / jerboy 等）的定时任务执行本脚本。

```bash
node scripts/pr-merge-sweep.mjs --dry-run   # 只看决策不合并
node scripts/pr-merge-sweep.mjs --dry-run --publish-status # 同步把未合并原因直接写到 PR
node scripts/pr-merge-sweep.mjs --dry-run --repo FiloAI/filoai-frontend   # 只扫一个仓
node scripts/pr-merge-sweep.mjs --repo FiloAI/filoai-frontend --pr 3410 --expected-head <40位本机AI已审SHA> # 定点合并
```

门禁（全过才合并）：非 draft + base 在仓库允许列表 + 无 `no-automerge` + `mergeable=MERGEABLE` + 当前 base ruleset 声明的全部 required checks 绿 + 0 未解决 review thread + **当前 head 至少有一次可审计的非作者人工或 owner-side AI 审核答复**。CI 绿本身不能合并；Cursor、Greptile、Codex 等任何具体 provider 都不是必需依赖。没有 required checks 的仓库不虚构 `summary`。`needs-human-review` 标签、外部机器人的风险评级、`未批准` 或 `转人工` 本身都不是门禁；只有具备权限的真人明确阻止才需要真人针对当前 head 放行。非 Chris/Bobo 作者若以“产品决定/超出范围/后续处理”关闭未撤回的 P0/P1 finding，还需 Chris 或 Bobo 对当前 head 明确放行；原 reviewer 明确接受范围解释则不阻塞。

不属于脚本门禁：Greptile、GitHub Codex、Cursor Bugbot、Cursor Approval Agent 或 Cursor Security Agent 的到场、缺席、超时、失败、拒审、风险评级、`未批准` 或 `转人工`，以及 Confidence、PR 大小、commit 数、作者身份分级、feat/fix 类型、视觉或产品方向分类。定时任务在调用定点合并前必须完整审查当前 head；外部 reviewer 已给出的具体可行动意见／安全 finding 与管家自审发现都必须写成 inline review thread 并闭环。机器人没有给出具体缺陷或覆盖不足时走管家代码／安全代审，不能让已满足硬门禁的 PR 永久等待。

列表接口暂时返回 `mergeable=UNKNOWN` 时会立即回读该 PR 的实时状态，不会把旧 PR 永久跳过；满足门禁的 PR 也不再受每仓固定合并配额限制。`--publish-status` 会幂等更新同一条 PR 状态评论，直接写明本轮不能合并的原因。高风险路径或标签会另行幂等更新 owner 请求评论，直接 `@zqchris @jerboy`；非 Chris/Bobo 作者时还会尝试正式 request Chris。这个流程由合并管家执行，不依赖 Cursor。

Owner-side AI 审核当前 head 无问题后写入：

```html
<!-- filoai-merge-steward:reviewed head=<40位SHA> verdict=pass -->
```

非 owner 作者提交的高风险改动，经 Chris 或 Bobo 确认当前 head 后写入：

```html
<!-- filoai-merge-steward:owner-approved head=<40位SHA> -->
```

Chris 或 Bobo 自己提交的 PR 不再设置额外 owner 确认门；required CI、当前 head 审核证据、未解决线程和明确人工阻塞仍照常检查。

脚本不会自动 approve、不会写“终审意见”、不会创建“团队待办”，也不使用 `--admin` 绕过 GitHub 规则。定点实合并必须用 `--expected-head` 传入本机 AI 已审的完整 SHA，并继续用 `--match-head-commit` 绑定该 head；合并前会重读 PR 元数据与全部硬门禁，合并后回读 merged / queued / scheduled 实时状态。

实合并永久禁止不带 `--pr` 的裸跑，避免跳过管家对具体 head 的完整审查。定点合并失败时，脚本会在对应 PR 回复 GitHub 返回的具体原因，并用本次实时观察到的 head 隐藏标记更新同一条评论，避免周期任务重复刷屏；合并命令已成功但最终状态暂时无法回读时，会明确写“结果待确认”，不会误报合并失败。评论本身发送失败只记日志，不覆盖原始错误。

活体任务由 Cindy scheduler 管理；前置检查脚本必须通过 `schedule_set_pre_run_hook` 安装和自测，不直接写入 ignored 的 `scripts/schedule-checks/`。仓库里的本文件只记录脚本契约，不作为另一套流程规范。

想让某个 PR 不被自动合并：打 `no-automerge` 标签或保持 draft。
