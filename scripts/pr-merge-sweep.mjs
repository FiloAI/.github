#!/usr/bin/env node
// FiloAI owner 侧 PR 合并 sweep
//
// 背景：2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人
// （zqchris / jerboy / GaoWeiLiuXD 等）的定时 agent 执行本脚本完成。设计对齐 cindy MagicLizi：
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
import {
  isAutomatedAccount,
  isConfirmedMissingCollaborator,
} from './collaborator-permission.mjs'
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
  shouldPublishMergeStatus,
} from './merge-status-comment.mjs'
import {
  buildMergeArgs,
  classifyMergeOutcome,
  matchesExpectedHead,
  shouldRequireUpToDate,
} from './merge-execution-policy.mjs'
import { evaluateRequiredChecks, evaluateStrictPolicy } from './required-check-gate.mjs'
import { evaluateReviewEvidence } from './review-evidence-gate.mjs'
import { evaluateProductDecisionGate } from './product-decision-gate.mjs'
import {
  consumeCiBridgeEvents,
  bridgeEntriesFor,
  formatCiBridgeEvent,
  appendCiBridgeReason,
  readCiBridge,
} from './ci-mainline-bridge.mjs'

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

// PR 总管发现的 CI 红灯通过本机 bridge 交给主线合并管家；live GitHub
// 门禁仍是唯一事实源。bridge 只负责让本轮优先看到当前 head 的失败事实。
const ciBridge = readCiBridge()
const ciBridgeEntries = bridgeEntriesFor(ONLY_REPO, ciBridge)
  .filter((event) => ONLY_PR === null || Number(event.pr) === ONLY_PR)
const ciBridgeByPr = new Map(ciBridgeEntries.map((event) => [`${event.repo}#${event.pr}`, event]))
const newCiBridgeEntries = DRY_RUN
  ? consumeCiBridgeEvents({ bridge: { ...ciBridge, events: Object.fromEntries(
    ciBridgeEntries.map((event) => [`${event.repo}#${event.pr}`, event]),
  ) } })
  : []
if (DRY_RUN && newCiBridgeEntries.length) {
  console.log('CI bridge（来自 PR 总管，仍以 live GitHub 为准）：')
  for (const event of newCiBridgeEntries) console.log(`- ${formatCiBridgeEvent(event)}`)
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
const TRUSTED_STEWARD_LOGINS = ['zqchris', 'jerboy', 'GaoWeiLiuXD']

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
  const body = buildOwnerReviewRequest({
    headOid: pr.headRefOid,
    reason,
    authorLogin: pr.author?.login || '',
  })
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
