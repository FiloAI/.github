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
// 实合并永久禁止裸跑；只有 dry-run 可以不带 --pr 扫描候选。
//
// 每个候选 PR 的门禁（全部满足才合并）：
//   1. 非 draft、base 在允许列表、无 no-automerge、mergeable=MERGEABLE
//   2. 当前 base ruleset 声明的全部 required status checks = success（没有则不虚构）
//   3. 0 个未解决 review thread
// needs-human-review、外部 reviewer 的到场/缺席/失败/拒审/风险评级/转人工都不是脚本门禁；
// 定时任务必须在调用定点合并前完成当前 head 的完整代审，并把发现的问题写成 inline review thread。
// 合并方式：bot 作者 squash，人类作者 merge commit（与 frontend 既有约定一致）。

import { execFileSync } from 'node:child_process'
import { flattenPaginatedPages } from './github-pagination.mjs'
import { classifyHighRisk, evaluateHighRiskApproval } from './high-risk-review-gate.mjs'
import {
  buildFormalReviewerRequestArgs,
  buildOwnerReviewCommentArgs,
  buildOwnerReviewRequest,
  OWNER_REVIEW_REQUEST_MARKER,
} from './high-risk-review-request.mjs'
import { evaluateManualBlockers } from './manual-blocker-gate.mjs'
import { evaluateMergeLabels } from './merge-label-policy.mjs'
import {
  buildMergeFailureComment,
  buildMergeFailureCommentArgs,
  mergeFailureMarker,
} from './merge-failure-comment.mjs'
import {
  buildMergeStatusComment,
  buildMergeStatusCommentArgs,
  MERGE_STATUS_MARKER,
} from './merge-status-comment.mjs'
import {
  buildMergeArgs,
  classifyMergeOutcome,
  matchesExpectedHead,
  shouldRequireUpToDate,
} from './merge-execution-policy.mjs'
import { evaluateRequiredChecks, evaluateStrictPolicy } from './required-check-gate.mjs'
import { evaluateReviewEvidence } from './review-evidence-gate.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const repoArgIdx = process.argv.indexOf('--repo')
const ONLY_REPO = repoArgIdx > -1 ? process.argv[repoArgIdx + 1] : null
const prArgIdx = process.argv.indexOf('--pr')
const ONLY_PR = prArgIdx > -1 ? Number(process.argv[prArgIdx + 1]) : null
const expectedHeadIdx = process.argv.indexOf('--expected-head')
const EXPECTED_HEAD = expectedHeadIdx > -1 ? process.argv[expectedHeadIdx + 1] : null
const PUBLISH_STATUS = process.argv.includes('--publish-status')
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
if (!DRY_RUN && ONLY_PR === null) {
  console.error('实合并必须使用 --repo <repo> --pr <number> --expected-head <40位SHA> 定点执行')
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
const TRUSTED_STEWARD_LOGINS = ['zqchris', 'jerboy']

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts })
}
function ghJson(args) {
  return JSON.parse(gh(args))
}

function ghJsonPaginated(args) {
  return flattenPaginatedPages(ghJson([...args, '--paginate', '--slurp']))
}

function replyMergeFailure(repo, pr, error, { outcomeUnverified = false } = {}) {
  const marker = mergeFailureMarker(pr.headRefOid)
  const body = buildMergeFailureComment({ headOid: pr.headRefOid, error, outcomeUnverified })
  let commentId = null
  try {
    const comments = ghJsonPaginated([
      'api', `repos/${repo}/issues/${pr.number}/comments`,
    ])
    commentId = comments.findLast((comment) => String(comment.body || '').includes(marker))?.id ?? null
  } catch (lookupError) {
    console.log(`[${repo}#${pr.number}] MERGE FAILURE COMMENT LOOKUP FAILED: ${String(lookupError.message).slice(0, 160)}`)
  }
  gh(buildMergeFailureCommentArgs({ repo, number: pr.number, body, commentId }))
}

function replyMergeStatus(repo, pr, reason, { state = 'blocked' } = {}) {
  const body = buildMergeStatusComment({ headOid: pr.headRefOid, reason, state })
  const comments = ghJsonPaginated([
    'api', `repos/${repo}/issues/${pr.number}/comments`,
  ])
  const existing = comments.findLast((comment) => String(comment.body || '').includes(MERGE_STATUS_MARKER))
  if (existing && String(existing.body || '') === body) return false
  gh(buildMergeStatusCommentArgs({
    repo,
    number: pr.number,
    body,
    commentId: existing?.id ?? null,
  }))
  return true
}

function requestHighRiskReview(repo, pr, reason) {
  const body = buildOwnerReviewRequest({ headOid: pr.headRefOid, reason })
  const comments = ghJsonPaginated([
    'api', `repos/${repo}/issues/${pr.number}/comments`,
  ])
  const existing = comments.findLast((comment) => String(comment.body || '').includes(OWNER_REVIEW_REQUEST_MARKER))
  if (!existing || String(existing.body || '') !== body) {
    gh(buildOwnerReviewCommentArgs({
      repo,
      number: pr.number,
      body,
      commentId: existing?.id ?? null,
    }))
  }

  const reviewerArgs = buildFormalReviewerRequestArgs({
    repo,
    number: pr.number,
    authorLogin: pr.author?.login || '',
  })
  if (reviewerArgs) {
    try {
      gh(reviewerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      const detail = String(error?.stderr || error?.message || error || '')
      console.log(`[${repo}#${pr.number}] FORMAL OWNER REQUEST FAILED; PR MENTION KEPT: ${detail.slice(0, 160)}`)
    }
  }
}

const permissionCache = new Map()

function collaboratorPermission(repo, login) {
  if (!login) return null
  const key = `${repo}:${login}`
  if (permissionCache.has(key)) return permissionCache.get(key)
  try {
    const permission = gh([
      'api', `repos/${repo}/collaborators/${login}/permission`, '--jq', '.permission',
    ], { stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    permissionCache.set(key, permission)
    return permission
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error || '')
    if (/HTTP 404|\bNot Found\b|is not a user/i.test(detail)) {
      permissionCache.set(key, null)
      return null
    }
    throw new Error(`无法确认 ${login} 在 ${repo} 的权限：${detail.slice(0, 160)}`)
  }
}

function manualBlockerGate(repo, pr) {
  try {
    const reviews = ghJsonPaginated([
      'api', `repos/${repo}/pulls/${pr.number}/reviews`,
    ]).map((review) => ({
      login: review.user?.login || '',
      is_bot: review.user?.type === 'Bot' || /(?:\[bot\]$|^cursor$|^chatgpt-codex-connector$|^greptile)/i.test(review.user?.login || ''),
      permission: collaboratorPermission(repo, review.user?.login || ''),
      state: review.state || '',
      body: review.body || '',
      commit_id: review.commit_id || '',
      submitted_at: review.submitted_at,
    }))
    const comments = ghJsonPaginated([
      'api', `repos/${repo}/issues/${pr.number}/comments`,
    ]).map((comment) => ({
      login: comment.user?.login || '',
      is_bot: comment.user?.type === 'Bot' || /(?:\[bot\]$|^cursor$|^chatgpt-codex-connector$|^greptile)/i.test(comment.user?.login || ''),
      permission: collaboratorPermission(repo, comment.user?.login || ''),
      body: comment.body || '',
      created_at: comment.created_at,
      updated_at: comment.updated_at,
    }))
    return evaluateManualBlockers({ headOid: pr.headRefOid, reviews, comments })
  } catch (error) {
    return {
      satisfied: false,
      reason: `成员明确阻止检查失败（fail-closed）：${String(error.message || error).slice(0, 160)}`,
    }
  }
}

function changedFiles(repo, prNumber) {
  return ghJsonPaginated([
    'api', `repos/${repo}/pulls/${prNumber}/files`,
  ]).flatMap((file) => [file.filename, file.previous_filename]).filter(Boolean)
}

function highRiskGate(repo, pr) {
  try {
    const files = changedFiles(repo, pr.number)
    const risk = classifyHighRisk({ repo, labels: pr.labels, files })
    if (!risk.highRisk) return { satisfied: true, reason: null, evidence: null }
    const reviews = ghJsonPaginated([
      'api', `repos/${repo}/pulls/${pr.number}/reviews`,
    ]).map((review) => ({
      login: review.user?.login || '',
      state: review.state || '',
      commit_id: review.commit_id || '',
    }))
    const comments = ghJsonPaginated([
      'api', `repos/${repo}/issues/${pr.number}/comments`,
    ]).map((comment) => ({
      login: comment.user?.login || '',
      body: comment.body || '',
    }))
    return evaluateHighRiskApproval({
      headOid: pr.headRefOid,
      authorLogin: pr.author?.login || '',
      highRisk: true,
      riskReason: risk.reason,
      reviews,
      comments,
    })
  } catch (error) {
    return {
      satisfied: false,
      reason: `高风险确认检查失败（fail-closed）：${String(error.message || error).slice(0, 160)}`,
      evidence: null,
    }
  }
}

function reviewEvidenceGate(repo, pr) {
  try {
    const reviews = ghJsonPaginated([
      'api', `repos/${repo}/pulls/${pr.number}/reviews`,
    ]).map((review) => ({
      login: review.user?.login || '',
      state: review.state || '',
      body: review.body || '',
      commit_id: review.commit_id || '',
    }))
    const comments = ghJsonPaginated([
      'api', `repos/${repo}/issues/${pr.number}/comments`,
    ]).map((comment) => ({
      login: comment.user?.login || '',
      body: comment.body || '',
    }))
    return evaluateReviewEvidence({
      headOid: pr.headRefOid,
      authorLogin: pr.author?.login || '',
      reviews,
      comments,
      trustedStewardLogins: TRUSTED_STEWARD_LOGINS,
    })
  } catch (error) {
    return {
      satisfied: false,
      reason: `当前 head 审核凭证检查失败（fail-closed）：${String(error.message || error).slice(0, 160)}`,
      evidence: null,
    }
  }
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
  const labelGate = evaluateMergeLabels(pr.labels)
  if (!labelGate.satisfied) return labelGate
  if (pr.mergeable !== 'MERGEABLE') {
    return { satisfied: false, reason: `mergeable=${pr.mergeable}` }
  }

  const requiredGate = requiredChecksGate(repo, pr)
  if (!requiredGate.satisfied) return { satisfied: false, reason: requiredGate.reason }
  const isBot = pr.author?.is_bot || /\[bot\]$/.test(pr.author?.login ?? '')
  const unresolved = unresolvedThreads(repo, pr.number)
  if (unresolved > 0) {
    return { satisfied: false, reason: `${unresolved} 个未解决 review thread` }
  }
  const blockerGate = manualBlockerGate(repo, pr)
  if (!blockerGate.satisfied) return blockerGate
  const ownerGate = highRiskGate(repo, pr)
  if (!ownerGate.satisfied) return ownerGate
  const reviewGate = reviewEvidenceGate(repo, pr)
  if (!reviewGate.satisfied) {
    return { ...reviewGate, readyForReview: true, requiredGate, isBot }
  }
  return {
    satisfied: true,
    requiredGate,
    isBot,
    reviewEvidence: reviewGate.evidence,
    ownerEvidence: ownerGate.evidence,
  }
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
      if (PUBLISH_STATUS) {
        try {
          const changed = replyMergeStatus(repo, pr, why)
          console.log(`${tag} STATUS ${changed ? 'PUBLISHED' : 'UNCHANGED'}`)
        } catch (commentError) {
          console.log(`${tag} STATUS PUBLISH FAILED: ${String(commentError.message || commentError).slice(0, 200)}`)
        }
      }
    }
    let failurePr = pr
    let mergeCommandReturned = false
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
    if (!candidate.satisfied) {
      if (candidate.needsOwnerReview && PUBLISH_STATUS) {
        try {
          requestHighRiskReview(repo, pr, candidate.reason)
          console.log(`${tag} OWNER REVIEW REQUESTED`)
        } catch (requestError) {
          console.log(`${tag} OWNER REVIEW REQUEST FAILED: ${String(requestError.message || requestError).slice(0, 200)}`)
        }
      }
      if (candidate.readyForReview && DRY_RUN) {
        totalSkipped++
        console.log(`${tag} READY FOR REVIEW head=${pr.headRefOid} — ${pr.title}`)
        if (PUBLISH_STATUS) {
          try {
            const changed = replyMergeStatus(repo, pr, candidate.reason, { state: 'ready' })
            console.log(`${tag} STATUS ${changed ? 'PUBLISHED' : 'UNCHANGED'}`)
          } catch (commentError) {
            console.log(`${tag} STATUS PUBLISH FAILED: ${String(commentError.message || commentError).slice(0, 200)}`)
          }
        }
        continue
      }
      skip(candidate.reason)
      continue
    }
    const { isBot } = candidate
    const method = isBot ? '--squash' : '--merge'
    if (DRY_RUN) {
      console.log(`${tag} WOULD MERGE (${method}) head=${pr.headRefOid} review=${candidate.reviewEvidence} — ${pr.title}`)
      continue
    }
    try {
      // 实合并前重新读取 PR 元数据与全部门禁，避免 head 不变但 base、标签、draft、
      // mergeability、rules/checks、review/thread 状态变化后仍使用旧快照合并。
      const livePr = refreshMergeability(repo, readPr(repo, pr.number))
      failurePr = livePr
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
      mergeCommandReturned = true
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
      const reason = String(e.message || e).slice(0, 200)
      console.log(`${tag} MERGE FAILED: ${reason}`)
      try {
        replyMergeFailure(repo, failurePr, e, { outcomeUnverified: mergeCommandReturned })
        console.log(`${tag} MERGE FAILURE REPLIED`)
      } catch (commentError) {
        console.log(`${tag} MERGE FAILURE REPLY FAILED: ${String(commentError.message || commentError).slice(0, 200)}`)
      }
    }
  }
  if (prs.length === 0) console.log(`[${repo}] 无 open PR`)
}

console.log(`\nsweep 完成：merged=${DRY_RUN ? '(dry-run)' : totalMerged} queued=${totalQueued} scheduled=${totalScheduled} skipped=${totalSkipped}`)
