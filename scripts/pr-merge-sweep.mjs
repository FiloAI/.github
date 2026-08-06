#!/usr/bin/env node
// FiloAI owner 侧 PR 合并 sweep
//
// 背景：2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人
// （zqchris / jerboy 等）的定时 agent 执行本脚本完成。设计对齐 cindy MagicLizi：
// 确定性门禁全过才合并，任何不确定 → 跳过并说明原因，绝不硬合。
//
// 用法：
//   node scripts/pr-merge-sweep.mjs [--dry-run] [--repo owner/name] [--pr <number>]
// 鉴权：走本机 gh CLI 登录态（执行者本人身份），无需额外 token。
//
// 2026-08-05 起的混合模式分工：定时任务先跑 --dry-run 拿到过全部硬门禁的候选，
// 由本机 AI 终审 agent 逐个读 diff 判「是什么/有无危害/与描述相符」，判过的才用
// --repo X --pr N 定点合并（本脚本是唯一合并执行通道，合并方式仍由脚本判定）。
// 裸跑（无 --pr）仍是全量模式，仅供人工兜底，常规链路不再直接用。
//
// 每个候选 PR 的门禁（全部满足才合并）：
//   1. 非 draft、base 在该仓允许列表内（见 REPO_BASES）、无 no-automerge 标签、无合并冲突
//   2. required check `summary` = success
//   3. `Greptile Review` check（若存在）= success
//   4. 人类作者 PR：Greptile Confidence 评论必须存在且 ≥ 4/5，且必须有
//      Codex（chatgpt-codex-connector[bot]）review——缺任一 = 跳过。
//      （2026-08-05 实踩：#3256 在 Greptile 完全缺席时被旧逻辑放行，零 review 合入。）
//      bot 作者 PR（如版本 bump）豁免此条，靠 summary + 终审 agent 的文件白名单判据。
//   5. 0 个未解决 review thread（不分作者，bot 的也算——回复完必须 resolve）
// 合并方式：bot 作者 squash，人类作者 merge commit（与 frontend 既有约定一致）。
// 每仓每轮最多合并 MAX_MERGES_PER_REPO 个、串行执行——保护打包机队列。

import { execFileSync } from 'node:child_process'

const DRY_RUN = process.argv.includes('--dry-run')
const repoArgIdx = process.argv.indexOf('--repo')
const ONLY_REPO = repoArgIdx > -1 ? process.argv[repoArgIdx + 1] : null
const prArgIdx = process.argv.indexOf('--pr')
const ONLY_PR = prArgIdx > -1 ? Number(process.argv[prArgIdx + 1]) : null
if (ONLY_PR !== null && (!Number.isInteger(ONLY_PR) || !ONLY_REPO)) {
  console.error('--pr 需要一个整数且必须与 --repo 同用')
  process.exit(1)
}

// 仓库 → 允许 sweep 合并的 base 分支。
// 2026-08-05 晚起全组织 main-only：main 是唯一长期分支，正式版打 tag 发布
//（服务器/官网 prod-v*，客户端 <platform>-v*）。历史 dev/prod 分支已冻结。
const REPO_BASES = {
  'FiloAI/filoai-frontend': ['main'], // 客户端唯一仓
  'FiloAI/FiloMailCenter': ['main'], // 服务器唯一仓（含 apps/admin、services/doc-reader、services/agent）
  'FiloAI/filo-www': ['main'], // 官网独立仓
  'FiloAI/.github': ['main'], // org 中枢（sweep 脚本自身也走本门禁）
  'FiloAI/filo-issue-bot': ['main'], // 反馈分诊 bot
}
const REPOS = Object.keys(REPO_BASES)
const MAX_MERGES_PER_REPO = 3
const REQUIRED_CHECK = 'summary'
const GREPTILE_CHECK = 'Greptile Review'
const MIN_CONFIDENCE = 4

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts })
}
function ghJson(args) {
  return JSON.parse(gh(args))
}

function latestConfidence(repo, prNumber) {
  // Greptile 每轮复审都会发含 Confidence Score 的评论，取最新一条
  const comments = ghJson([
    'api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate',
    '--jq', '[.[] | select(.user.login == "greptile-apps[bot]")] | map({body, created_at})',
  ])
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = comments[i].body.match(/confidence\s*score[:\s]*([0-5])\s*\/\s*5/i)
    if (m) return Number(m[1])
  }
  return null
}

const CODEX_LOGINS = ['chatgpt-codex-connector[bot]', 'chatgpt-codex-connector']

function hasCodexReview(repo, prNumber) {
  const reviews = ghJson([
    'api', `repos/${repo}/pulls/${prNumber}/reviews`, '--paginate',
    '--jq', '[.[] | .user.login]',
  ])
  if (reviews.some((l) => CODEX_LOGINS.includes(l))) return true
  // Codex 无 major issue 时可能只发 issue comment（「Codex Review: Didn't find any
  // major issues」形态，不产生正式 review——2026-08-06 .github#15 实踩：干净 PR 因此
  // 永远过不了本门禁）。评论形态只认两个条件同时成立：
  // ① connector 本人发的**明确成功结论**（Didn't find any major issues）——失败、
  //    进度、负面结果不算，防止任意含“Codex Review”字样的文本绕过门禁；
  // ② 评论正文声明的「Reviewed commit」SHA 必须就是当前 head（headRefOid，服务端
  //    事实）——不用 committedDate 之类 author 可控时间戳推断新鲜度，天然免疫
  //    「本地已产新 head→评论发布→再 push」的竞态：push 后 headRefOid 变化，
  //    旧结论立即失效。评论不带 SHA 的一律不认。
  // 按作者过滤，人类发的「@codex review」召唤评论不会误判。
  const [owner, name] = repo.split('/')
  const headQ = `query { repository(owner: "${owner}", name: "${name}") {
    pullRequest(number: ${prNumber}) { headRefOid } } }`
  const headOid = ghJson(['api', 'graphql', '-f', `query=${headQ}`])
    .data.repository.pullRequest.headRefOid.toLowerCase()
  const comments = ghJson([
    'api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate',
    '--jq', '[.[] | {login: .user.login, body: .body}]',
  ])
  return comments.some((c) => {
    if (!CODEX_LOGINS.includes(c.login)) return false
    const body = c.body || ''
    if (!/didn'?t find any major issues/i.test(body)) return false
    const m = body.match(/reviewed commit[^0-9a-f]*([0-9a-f]{7,40})/i)
    return !!m && headOid.startsWith(m[1].toLowerCase())
  })
}

function unresolvedThreads(repo, prNumber) {
  const [owner, name] = repo.split('/')
  const q = `query { repository(owner: "${owner}", name: "${name}") {
    pullRequest(number: ${prNumber}) { reviewThreads(first: 100) { nodes { isResolved } } } } }`
  const d = ghJson(['api', 'graphql', '-f', `query=${q}`])
  return d.data.repository.pullRequest.reviewThreads.nodes.filter((t) => !t.isResolved).length
}

function checkConclusions(repo, sha) {
  const runs = ghJson([
    'api', `repos/${repo}/commits/${sha}/check-runs`, '--paginate',
    '--jq', '[.check_runs[] | {name, status, conclusion}]',
  ])
  // 同名 check 取最新（API 返回按时间倒序，first-wins）
  const byName = {}
  for (const r of runs) if (!(r.name in byName)) byName[r.name] = r
  return byName
}

let totalMerged = 0
let totalSkipped = 0

for (const repo of REPOS) {
  if (ONLY_REPO && repo !== ONLY_REPO) continue
  let prs
  try {
    prs = ghJson([
      'pr', 'list', '--repo', repo, '--state', 'open', '--json',
      'number,title,isDraft,baseRefName,labels,author,mergeable,headRefOid',
    ])
  } catch (e) {
    console.log(`[${repo}] 列表拉取失败：${e.message}`)
    continue
  }
  let merged = 0
  for (const pr of prs) {
    if (ONLY_PR !== null && pr.number !== ONLY_PR) continue
    const tag = `[${repo}#${pr.number}]`
    const skip = (why) => {
      totalSkipped++
      console.log(`${tag} SKIP: ${why} — ${pr.title}`)
    }
    if (pr.isDraft) { skip('draft'); continue }
    if (!REPO_BASES[repo].includes(pr.baseRefName)) { skip(`base=${pr.baseRefName} 不在允许列表 [${REPO_BASES[repo]}]`); continue }
    if (pr.labels.some((l) => l.name === 'no-automerge')) { skip('no-automerge 标签'); continue }
    // needs-human-review：终审 agent 判定需人工看护（产品方向偏差/功能大包）。
    // Chris / bobo 看完移除标签即放行，下轮自动重新进入终审。
    if (pr.labels.some((l) => l.name === 'needs-human-review')) { skip('needs-human-review 等人工放行'); continue }
    if (pr.mergeable === 'CONFLICTING') { skip('合并冲突'); continue }
    if (merged >= MAX_MERGES_PER_REPO) { skip('本轮配额已满'); continue }

    const checks = checkConclusions(repo, pr.headRefOid)
    const summary = checks[REQUIRED_CHECK]
    if (!summary || summary.status !== 'completed' || summary.conclusion !== 'success') {
      skip(`summary=${summary ? `${summary.status}/${summary.conclusion}` : '缺失'}`); continue
    }
    const greptile = checks[GREPTILE_CHECK]
    if (greptile && (greptile.status !== 'completed' || greptile.conclusion !== 'success')) {
      skip(`Greptile Review=${greptile.status}/${greptile.conclusion}`); continue
    }
    const isBot = pr.author?.is_bot || /\[bot\]$/.test(pr.author?.login ?? '')
    // Confidence 门禁：凭评论判定（filo-www 上 Greptile 无 check run，2026-08-05 实查）。
    // 人类 PR：Greptile Confidence 与 Codex review 都必须存在——缺席 ≠ 放行
    // （2026-08-05 实踩：#3256 零 review 被旧的"缺席即跳过验证"逻辑合入）。
    // bot PR（版本 bump 等）豁免双 review 硬门禁，由终审 agent 按文件白名单严判。
    const conf = latestConfidence(repo, pr.number)
    if (conf !== null && conf < MIN_CONFIDENCE) { skip(`Confidence ${conf}/5 < ${MIN_CONFIDENCE}`); continue }
    if (!isBot) {
      if (conf === null) { skip('人类 PR 缺 Greptile Confidence 评论（AI review 未完成）'); continue }
      if (!hasCodexReview(repo, pr.number)) { skip('人类 PR 缺 Codex review'); continue }
    } else if (greptile && conf === null) {
      skip('Greptile check 存在但解析不到 Confidence Score'); continue
    }
    const unresolved = unresolvedThreads(repo, pr.number)
    if (unresolved > 0) { skip(`${unresolved} 个未解决 review thread`); continue }

    const method = isBot ? '--squash' : '--merge'
    if (!DRY_RUN) {
      // 第三方签核留痕：合并前以执行者身份 approve（作者是执行者本人时 GitHub
      // 会拒绝 approve 自己的 PR——吞掉即可，bypass 合并不依赖这一步）。
      try {
        gh(['pr', 'review', String(pr.number), '--repo', repo, '--approve',
          '--body', 'owner sweep 终审通过（硬门禁全过 + 本机 AI 内容终审）'])
      } catch {
        console.log(`${tag} approve 留痕跳过（作者即执行者或已 approve）`)
      }
    }
    if (DRY_RUN) {
      console.log(`${tag} WOULD MERGE (${method}) — ${pr.title}`)
      merged++
      continue
    }
    try {
      // --admin：显式行使 owner bypass。2026-08-05 上 Merge discipline ruleset
      // （update 限制 + approvals≥1）后，普通合并调用即使是 bypass 名单成员也会被
      // base branch policy 拒绝（21:07/22:07 两轮实踩）；admin 合并才走 bypass 通道。
      // 门禁不受影响——本脚本只会走到这里当且仅当全部硬门禁 + AI 终审已通过。
      gh(['pr', 'merge', String(pr.number), '--repo', repo, method, '--admin'])
      console.log(`${tag} MERGED (${method}) — ${pr.title}`)
      merged++
      totalMerged++
    } catch (e) {
      console.log(`${tag} MERGE FAILED: ${String(e.message).slice(0, 200)}`)
    }
  }
  if (prs.length === 0) console.log(`[${repo}] 无 open PR`)
}

console.log(`\nsweep 完成：merged=${DRY_RUN ? '(dry-run)' : totalMerged} skipped=${totalSkipped}`)
