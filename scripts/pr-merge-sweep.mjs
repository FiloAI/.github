#!/usr/bin/env node
// FiloAI owner 侧 PR 合并 sweep
//
// 背景：2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人
// （zqchris / jerboy 等）的定时 agent 执行本脚本完成。设计对齐 cindy MagicLizi：
// 确定性门禁全过才合并，任何不确定 → 跳过并说明原因，绝不硬合。
//
// 用法：
//   node scripts/pr-merge-sweep.mjs [--dry-run] [--repo owner/name]
// 鉴权：走本机 gh CLI 登录态（执行者本人身份），无需额外 token。
//
// 每个候选 PR 的门禁（全部满足才合并）：
//   1. 非 draft、base=dev、无 no-automerge 标签、无合并冲突
//   2. required check `summary` = success
//   3. `Greptile Review` check（若存在）= success
//   4. Greptile 最新 Confidence Score ≥ 4/5（有 Greptile 评论时；解析不到则跳过该 PR）
//   5. 0 个未解决 review thread（不分作者，bot 的也算——回复完必须 resolve）
// 合并方式：bot 作者 squash，人类作者 merge commit（与 frontend 既有约定一致）。
// 每仓每轮最多合并 MAX_MERGES_PER_REPO 个、串行执行——保护打包机队列。

import { execFileSync } from 'node:child_process'

const DRY_RUN = process.argv.includes('--dry-run')
const repoArgIdx = process.argv.indexOf('--repo')
const ONLY_REPO = repoArgIdx > -1 ? process.argv[repoArgIdx + 1] : null

const REPOS = [
  'FiloAI/filoai-frontend',
  'FiloAI/FiloMailCenter', // 2026-08-05 起含 apps/admin 与 services/doc-reader（原独立仓已并入归档）
  'FiloAI/FiloClaw',
]
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
    const tag = `[${repo}#${pr.number}]`
    const skip = (why) => {
      totalSkipped++
      console.log(`${tag} SKIP: ${why} — ${pr.title}`)
    }
    if (pr.isDraft) { skip('draft'); continue }
    if (pr.baseRefName !== 'dev') { skip(`base=${pr.baseRefName}≠dev`); continue }
    if (pr.labels.some((l) => l.name === 'no-automerge')) { skip('no-automerge 标签'); continue }
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
    if (greptile) {
      const conf = latestConfidence(repo, pr.number)
      if (conf === null) { skip('Greptile check 存在但解析不到 Confidence Score'); continue }
      if (conf < MIN_CONFIDENCE) { skip(`Confidence ${conf}/5 < ${MIN_CONFIDENCE}`); continue }
    }
    const unresolved = unresolvedThreads(repo, pr.number)
    if (unresolved > 0) { skip(`${unresolved} 个未解决 review thread`); continue }

    const isBot = pr.author?.is_bot || /\[bot\]$/.test(pr.author?.login ?? '')
    const method = isBot ? '--squash' : '--merge'
    if (DRY_RUN) {
      console.log(`${tag} WOULD MERGE (${method}) — ${pr.title}`)
      merged++
      continue
    }
    try {
      gh(['pr', 'merge', String(pr.number), '--repo', repo, method])
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
