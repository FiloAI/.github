# FiloAI org 自动化脚本

## pr-merge-sweep.mjs — owner 侧 PR 合并 sweep

2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人（zqchris / jerboy 等）的定时任务执行本脚本。

```bash
node scripts/pr-merge-sweep.mjs --dry-run   # 只看决策不合并
node scripts/pr-merge-sweep.mjs --repo FiloAI/filoai-frontend   # 只扫一个仓
node scripts/pr-merge-sweep.mjs --repo FiloAI/filoai-frontend --pr 3410 --expected-head <40位本机AI已审SHA> # 定点合并
```

门禁（全过才进入本轮自审候选）：非 draft + base 在仓库允许列表 + 无 `no-automerge` + `mergeable=MERGEABLE` + 当前 base ruleset 声明的全部 required checks 绿 + 0 未解决 review thread + 无尚未解除的成员人工阻止。任何有 write 及以上权限的成员通过普通评论明确说“不能/不宜/不要合并”、指出“功能阻断/merge blocker”，或提交 `CHANGES_REQUESTED`，都立即 fail-closed；作者 push 新 head 不自动清除，必须由原阻止者对当前 head 明确放行或正式 `APPROVED`。没有 required checks 的仓库不虚构 `summary`；若 PR 带 `needs-human-review`，作者有 write 及以上权限时自动满足，否则接受当前 head 的正式 approve，或有权限者在当前 head 后给出的明确自然语言确认。

不属于门禁：GitHub Codex Review、Greptile/Confidence、PR 大小、commit 数、作者身份分级、feat/fix 类型、视觉或产品方向分类。自动出现的 GitHub Codex Review 可以作为非约束性的辅助证据读取，但不得主动召唤、不得等待，也不得让一个已满足上述硬门禁的 PR 因其缺席、失败或意见而停下。

列表接口暂时返回 `mergeable=UNKNOWN` 时会立即回读该 PR 的实时状态，不会把旧 PR 永久跳过；满足门禁的 PR 也不再受每仓固定合并配额限制。

脚本不会请求或等待 GitHub Codex Review，不会发布任何配额召唤评论，也不会自动 approve、写“终审意见”或创建“团队待办”；候选由运行定时任务的 Codex 读取当前 head 完整 diff 后自行审核。裸跑和未知参数绝不执行全量实合并；`--help` 只显示帮助。定点实合并必须用 `--expected-head` 传入本轮 Codex 已审的完整 SHA，并继续用 `--match-head-commit` 绑定该 head；合并前会重读 PR 元数据与全部硬门禁，合并后回读 merged / queued / scheduled 实时状态。

活体任务由 Cindy scheduler 管理；前置检查脚本必须通过 `schedule_set_pre_run_hook` 安装和自测，不直接写入 ignored 的 `scripts/schedule-checks/`。仓库里的本文件只记录脚本契约，不作为另一套流程规范。

想让某个 PR 不被自动合并：打 `no-automerge` 标签或保持 draft。
