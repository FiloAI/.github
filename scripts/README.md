# FiloAI org 自动化脚本

## pr-merge-sweep.mjs — owner 侧 PR 合并 sweep

2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人（zqchris / jerboy 等）的定时任务执行本脚本。

```bash
node scripts/pr-merge-sweep.mjs --dry-run   # 只看决策不合并
node scripts/pr-merge-sweep.mjs             # 实际合并（以执行者的 gh 登录态）
node scripts/pr-merge-sweep.mjs --repo FiloAI/filoai-frontend   # 只扫一个仓
```

门禁（全过才合并）：非 draft + base=dev + 无 `no-automerge` 标签 + 无冲突 + `summary` check 绿 + `Greptile Review` 绿 + Confidence ≥4/5 + 0 未解决 review thread。bot 作者 squash、人类 merge commit；每仓每轮 ≤3 串行（保护打包机队列）。

**部署方式（Chris 侧参考，bobo 照抄即可）**：本机 Cindy scheduler 脚本模式，每小时 `7 * * * *`，
cwd 为本仓库 checkout，命令 `git pull --ff-only; node scripts/pr-merge-sweep.mjs`（输出走 stderr，
结束吐 cindy-script/1 complete 帧）；配 `schedule-checks/filoai-pr-merge-sweep-owner.mjs` 预检
（org 无 open 非 draft PR 时零成本跳过）。用普通 cron 也行：`7 * * * * cd <checkout> && git pull -q --ff-only; node scripts/pr-merge-sweep.mjs >> ~/filoai-sweep.log 2>&1`。

想让某个 PR 不被自动合并：打 `no-automerge` 标签或保持 draft。
