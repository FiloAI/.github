#!/usr/bin/env node
// FiloAI owner 侧 PR 合并 sweep
//
// 背景：2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人
// （zqchris / jerboy 等）的定时 agent 执行本脚本完成。设计对齐 cindy MagicLizi：
// 确定性门禁全过才合并；不使用规模、作者、产品方向或 reviewer 缺席等主观分类。
//
// 用法：
//   node scripts/pr-merge-sweep.mjs [--dry-run] [--repo owner/name] [--pr <number>] [--expected-head <sha>]
// 鉴权：走本机 gh CLI 登录态（执行者本人身份），无需额外 token。
//
// 2026-08-05 起的混合模式分工：定时任务先跑 --dry-run 拿到过全部硬门禁的候选，
// 由本机 AI 终审 agent 逐个读 diff 判「是什么/有无危害/与描述相符」，判过的才用
// --repo X --pr N 定点合并（本脚本是唯一合并执行通道，合并方式仍由脚本判定）。
// 裸跑（无 --pr）仍是全量模式，仅供人工兜底，常规链路不再直接用。
//
// 每个候选 PR 的门禁（全部满足才合并）：
//   1. 非 draft、base 在允许列表、无 no-automerge、mergeable=MERGEABLE
//   2. 当前 base ruleset 声明的全部 required status checks = success（没有则不虚构）
//   3. 人类作者 PR 有绑定当前 head 的 Codex 结论
//   4. 0 个未解决 review thread
//   5. 若存在 needs-human-review：作者有 write+ 权限，或当前 head 已获有权限者批准/确认
// Greptile、Confidence、改动规模、作者身份分级与产品/视觉分类均不是合并门禁。
// 合并方式：bot 作者 squash，人类作者 merge commit（与 frontend 既有约定一致）。

import { execFileSync } from 'node:child_process'
import { hasCurrentHeadCodexReview } from './codex-review-gate.mjs'
import { evaluateHumanReviewGate } from './human-review-gate.mjs'
import { flattenPaginatedPages } from './github-pagination.mjs'
import {
  buildMergeArgs,
  classifyMergeOutcome,
  matchesExpectedHead,
  shouldRequireUpToDate,
} from './merge-execution-policy.mjs'
import { evaluateRequiredChecks, evaluateStrictPolicy } from './required-check-gate.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const repoArgIdx = process.argv.indexOf('--repo')
const ONLY_REPO = repoArgIdx > -1 ? process.argv[repoArgIdx + 1] : null
const prArgIdx = process.argv.indexOf('--pr')
const ONLY_PR = prArgIdx > -1 ? Number(process.argv[prArgIdx + 1]) : null
const expectedHeadIdx = process.argv.indexOf('--expected-head')
const EXPECTED_HEAD = expectedHeadIdx > -1 ? process.argv[expectedHeadIdx + 1] : null
if (ONLY_PR !== null && (!Number.isInteger(ONLY_PR) || !ONLY_REPO)) {
  console.error('--pr 需要一个整数且必须与 --repo 同用')
  process.exit(1)
}
if (EXPECTED_HEAD && (!ONLY_PR || !/^[0-9a-f]{40}$/i.test(EXPECTED_HEAD))) {
  console.error('--expected-head 需要与 --repo/--pr 同用，且必须是完整 40 位 SHA')
  process.exit(1)
}
if (!DRY_RUN && ONLY_PR !== null && !EXPECTED_HEAD) {
  console.error('定点实合并必须传 --expected-head <本机 AI 已审过的 40 位 SHA>')
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

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts })
}
function ghJson(args) {
  return JSON.parse(gh(args))
}

function ghJsonPaginated(args) {
  return flattenPaginatedPages(ghJson([...args, '--paginate', '--slurp']))
}

const permissionCache = new Map()

function collaboratorPermission(repo, login) {
  const key = `${repo}:${login}`
  if (permissionCache.has(key)) return permissionCache.get(key)
  try {
    const permission = gh([
      'api', `repos/${repo}/collaborators/${login}/permission`, '--jq', '.permission',
    ]).trim()
    permissionCache.set(key, permission)
    return permission
  } catch {
    permissionCache.set(key, null)
    return null
  }
}

function reviewDismissalInfo(repo, prNumber) {
  const [owner, name] = repo.split('/')
  const dismissalByReviewId = new Map()
  let cursor = null
  let hasNextPage = true
  while (hasNextPage) {
    const after = cursor ? `, after: ${JSON.stringify(cursor)}` : ''
    const query = `query { repository(owner: "${owner}", name: "${name}") {
      pullRequest(number: ${prNumber}) { timelineItems(first: 100${after}, itemTypes: [REVIEW_DISMISSED_EVENT]) {
        nodes { ... on ReviewDismissedEvent { createdAt previousReviewState review { databaseId } } }
        pageInfo { hasNextPage endCursor }
      } } } }`
    const timeline = ghJson(['api', 'graphql', '-f', `query=${query}`])
      .data.repository.pullRequest.timelineItems
    for (const event of timeline.nodes) {
      if (event.review?.databaseId) {
        dismissalByReviewId.set(event.review.databaseId, {
          dismissedAt: event.createdAt,
          previousState: event.previousReviewState,
        })
      }
    }
    hasNextPage = timeline.pageInfo.hasNextPage
    cursor = timeline.pageInfo.endCursor
  }
  return dismissalByReviewId
}

function humanReviewGate(repo, pr) {
  const hasLabel = pr.labels.some((label) => label.name === 'needs-human-review')
  if (!hasLabel) return { satisfied: true, reason: null }

  const authorLogin = pr.author?.login || ''
  const authorPermission = collaboratorPermission(repo, authorLogin)
  const headCommittedAt = Date.parse(gh([
    'api', `repos/${repo}/commits/${pr.headRefOid}`, '--jq', '.commit.committer.date',
  ]).trim()) || 0
  const commentPages = ghJson([
    'api', `repos/${repo}/issues/${pr.number}/comments`, '--paginate', '--slurp',
  ])
  const comments = commentPages.flat().map((comment) => ({
    login: comment.user?.login || '',
    permission: collaboratorPermission(repo, comment.user?.login || ''),
    body: comment.body || '',
    created_at: comment.created_at,
  }))
  const reviews = ghJsonPaginated([
    'api', `repos/${repo}/pulls/${pr.number}/reviews`,
  ])
  const dismissalByReviewId = reviewDismissalInfo(repo, pr.number)
  const normalizedReviews = reviews.map((review) => {
    const dismissal = dismissalByReviewId.get(review.id)
    return {
    id: review.id,
    login: review.user?.login || '',
    permission: collaboratorPermission(repo, review.user?.login || ''),
    state: review.state || '',
    commit_id: review.commit_id || '',
    submitted_at: review.submitted_at,
    dismissed_at: dismissal?.dismissedAt || null,
    dismissed_previous_state: dismissal?.previousState || null,
  }
  })
  return evaluateHumanReviewGate({
    hasLabel,
    authorLogin,
    authorPermission,
    headOid: pr.headRefOid,
    headCommittedAt,
    reviews: normalizedReviews,
    comments,
  })
}

function hasCodexReview(repo, prNumber, headOid) {
  const reviews = ghJsonPaginated([
    'api', `repos/${repo}/pulls/${prNumber}/reviews`,
  ])
  const comments = ghJsonPaginated([
    'api', `repos/${repo}/issues/${prNumber}/comments`,
  ])
  return hasCurrentHeadCodexReview({
    reviews,
    comments,
    headOid,
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
  const runs = ghJsonPaginated([
    'api', `repos/${repo}/commits/${sha}/check-runs`,
  ]).flatMap((page) => page.check_runs || [])
  const checks = runs.map((run) => ({
    name: run.name,
    producer: 'check',
    sequence: run.id,
    integrationId: run.app?.id ?? null,
    status: run.status,
    conclusion: run.conclusion,
    at: run.completed_at || run.started_at || run.created_at,
  }))
  const combinedPages = ghJsonPaginated([
    'api', `repos/${repo}/commits/${sha}/status`,
  ])
  const statuses = combinedPages.flatMap((page) => page.statuses || [])
  for (const status of statuses) {
    checks.push({
      name: status.context,
      producer: 'status',
      sequence: status.id,
      integrationId: null,
      status: 'completed',
      conclusion: status.state === 'success' ? 'success' : status.state,
      at: status.updated_at || status.created_at,
    })
  }
  return checks
}

function requiredRuleConfig(repo, baseRefName) {
  const rules = ghJsonPaginated([
    'api', `repos/${repo}/rules/branches/${encodeURIComponent(baseRefName)}`,
  ])
  const checkRules = rules.filter((rule) => rule.type === 'required_status_checks')
  const requirements = checkRules
    .flatMap((rule) => rule.parameters?.required_status_checks || [])
    .filter((check) => check.context)
    .map((check) => ({
      context: check.context,
      integrationId: check.integration_id ?? null,
    }))
  const config = {
    requirements,
    strict: checkRules.some((rule) => rule.parameters?.strict_required_status_checks_policy === true),
    mergeQueue: rules.some((rule) => rule.type === 'merge_queue'),
  }
  return config
}

function requiredChecksGate(repo, pr) {
  const config = requiredRuleConfig(repo, pr.baseRefName)
  const checks = checkConclusions(repo, pr.headRefOid)
  const checkGate = evaluateRequiredChecks({ requirements: config.requirements, checks })
  if (!checkGate.satisfied) return { ...checkGate, strict: config.strict, mergeQueue: config.mergeQueue }
  if (!shouldRequireUpToDate(config)) {
    return { ...checkGate, strict: config.strict, mergeQueue: config.mergeQueue }
  }
  const comparison = ghJson([
    'api', `repos/${repo}/compare/${encodeURIComponent(pr.baseRefName)}...${pr.headRefOid}`,
  ])
  return {
    ...evaluateStrictPolicy({ strict: true, behindBy: comparison.behind_by }),
    strict: true,
    mergeQueue: config.mergeQueue,
  }
}

function refreshMergeability(repo, pr) {
  if (pr.mergeable !== 'UNKNOWN') return pr
  const live = ghJson([
    'pr', 'view', String(pr.number), '--repo', repo, '--json',
    'number,title,isDraft,baseRefName,labels,author,mergeable,headRefOid,state',
  ])
  return { ...pr, ...live }
}

function readPr(repo, prNumber) {
  return ghJson([
    'pr', 'view', String(prNumber), '--repo', repo, '--json',
    'number,title,isDraft,baseRefName,labels,author,mergeable,headRefOid,state',
  ])
}

function readMergeOutcome(repo, prNumber) {
  const [owner, name] = repo.split('/')
  const query = `query { repository(owner: "${owner}", name: "${name}") {
    pullRequest(number: ${prNumber}) {
      state mergedAt mergeCommit { oid } isInMergeQueue mergeQueueEntry { id }
      autoMergeRequest { enabledAt }
    } } }`
  return ghJson(['api', 'graphql', '-f', `query=${query}`])
    .data.repository.pullRequest
}

function evaluateCandidate(repo, pr) {
  if (pr.isDraft) return { satisfied: false, reason: 'draft' }
  if (!REPO_BASES[repo].includes(pr.baseRefName)) {
    return { satisfied: false, reason: `base=${pr.baseRefName} 不在允许列表 [${REPO_BASES[repo]}]` }
  }
  if (pr.labels.some((label) => label.name === 'no-automerge')) {
    return { satisfied: false, reason: 'no-automerge 标签' }
  }
  if (pr.mergeable !== 'MERGEABLE') {
    return { satisfied: false, reason: `mergeable=${pr.mergeable}` }
  }

  const requiredGate = requiredChecksGate(repo, pr)
  if (!requiredGate.satisfied) return { satisfied: false, reason: requiredGate.reason }
  const isBot = pr.author?.is_bot || /\[bot\]$/.test(pr.author?.login ?? '')
  if (!isBot && !hasCodexReview(repo, pr.number, pr.headRefOid)) {
    return { satisfied: false, reason: '当前 head 缺 Codex 结论' }
  }
  const unresolved = unresolvedThreads(repo, pr.number)
  if (unresolved > 0) {
    return { satisfied: false, reason: `${unresolved} 个未解决 review thread` }
  }
  const humanGate = humanReviewGate(repo, pr)
  if (!humanGate.satisfied) return { satisfied: false, reason: humanGate.reason }
  return { satisfied: true, requiredGate, isBot, humanReason: humanGate.reason }
}

let totalMerged = 0
let totalQueued = 0
let totalScheduled = 0
let totalSkipped = 0

for (const repo of REPOS) {
  if (ONLY_REPO && repo !== ONLY_REPO) continue
  let prs
  try {
    if (ONLY_PR !== null) {
      const targetedPr = readPr(repo, ONLY_PR)
      prs = targetedPr.state === 'OPEN' ? [targetedPr] : []
    } else {
      prs = ghJson([
        'pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json',
        'number,title,isDraft,baseRefName,labels,author,mergeable,headRefOid,state',
      ])
    }
  } catch (e) {
    console.log(`[${repo}] 列表拉取失败：${e.message}`)
    continue
  }
  for (const listedPr of prs) {
    let pr = listedPr
    const tag = `[${repo}#${listedPr.number}]`
    const skip = (why) => {
      totalSkipped++
      console.log(`${tag} SKIP: ${why} — ${pr.title || listedPr.title}`)
    }
    try {
      pr = refreshMergeability(repo, listedPr)
    } catch (error) {
      skip(`mergeable 实时回读失败：${String(error.message).slice(0, 160)}`)
      continue
    }
    if (ONLY_PR !== null && pr.number !== ONLY_PR) continue
    if (EXPECTED_HEAD && !matchesExpectedHead(EXPECTED_HEAD, pr.headRefOid)) {
      skip(`head 已变化：expected=${EXPECTED_HEAD} actual=${pr.headRefOid}`)
      continue
    }
    const candidate = evaluateCandidate(repo, pr)
    if (!candidate.satisfied) { skip(candidate.reason); continue }
    const { isBot } = candidate
    if (candidate.humanReason) console.log(`${tag} HUMAN GATE SATISFIED: ${candidate.humanReason}`)

    const method = isBot ? '--squash' : '--merge'
    if (DRY_RUN) {
      console.log(`${tag} WOULD MERGE (${method}) head=${pr.headRefOid} — ${pr.title}`)
      continue
    }
    try {
      // 实合并前重新读取 PR 元数据与全部门禁，避免 head 不变但 base、标签、draft、
      // mergeability、rules/checks、review/thread 状态变化后仍使用旧快照合并。
      const livePr = refreshMergeability(repo, readPr(repo, pr.number))
      if (!matchesExpectedHead(pr.headRefOid, livePr.headRefOid)) {
        throw new Error(`合并前 head 已变化：expected=${pr.headRefOid} actual=${livePr.headRefOid}`)
      }
      const liveCandidate = evaluateCandidate(repo, livePr)
      if (!liveCandidate.satisfied) {
        throw new Error(`合并前门禁已变化：${liveCandidate.reason}`)
      }
      // 不使用 --admin：GitHub 在实际 merge 时原子执行当前 rules/checks/queue；
      // 当前五仓 pull_request rules 均为 0 approvals，无需 owner bypass。
      const mergeArgs = buildMergeArgs({
        repo,
        number: pr.number,
        method,
        headOid: pr.headRefOid,
      })
      gh(mergeArgs)
      let mergedPr = readMergeOutcome(repo, pr.number)
      let outcome = classifyMergeOutcome(mergedPr)
      for (let retry = 0; outcome === 'pending' && retry < 2; retry++) {
        execFileSync('sleep', ['2'])
        mergedPr = readMergeOutcome(repo, pr.number)
        outcome = classifyMergeOutcome(mergedPr)
      }
      if (outcome === 'queued') {
        console.log(`${tag} QUEUED (${method}) — ${pr.title}`)
        totalQueued++
        continue
      }
      if (outcome === 'scheduled') {
        console.log(`${tag} SCHEDULED (${method}) — ${pr.title}`)
        totalScheduled++
        continue
      }
      if (outcome !== 'merged') {
        throw new Error(`合并命令返回但 live state=${mergedPr.state} queue=${Boolean(mergedPr.isInMergeQueue)}`)
      }
      console.log(`${tag} MERGED (${method}) commit=${mergedPr.mergeCommit?.oid || 'unknown'} — ${pr.title}`)
      totalMerged++
    } catch (e) {
      console.log(`${tag} MERGE FAILED: ${String(e.message).slice(0, 200)}`)
    }
  }
  if (prs.length === 0) console.log(`[${repo}] 无 open PR`)
}

console.log(`\nsweep 完成：merged=${DRY_RUN ? '(dry-run)' : totalMerged} queued=${totalQueued} scheduled=${totalScheduled} skipped=${totalSkipped}`)
