#!/usr/bin/env node
// FiloAI owner 侧 PR 合并 sweep
//
// 背景：2026-08-05 起全组织停用仓库侧 bot 自动合并；合并由 owner 权限的人
// （zqchris / jerboy 等）的定时 agent 执行本脚本完成。设计对齐 cindy MagicLizi：
// 确定性门禁全过才合并；不使用规模、作者、产品方向或 reviewer 缺席等主观分类。
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
import { buildMergeArgs, validateAdminFallbackSnapshot } from './merge-execution-policy.mjs'
import { evaluateRequiredChecks, evaluateStrictPolicy } from './required-check-gate.mjs'

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
  ]).map((review) => ({
    login: review.user?.login || '',
    permission: collaboratorPermission(repo, review.user?.login || ''),
    state: review.state || '',
    commit_id: review.commit_id || '',
    submitted_at: review.submitted_at,
  }))
  return evaluateHumanReviewGate({
    hasLabel,
    authorLogin,
    authorPermission,
    headOid: pr.headRefOid,
    headCommittedAt,
    reviews,
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

const requiredCheckCache = new Map()

function requiredRuleConfig(repo, baseRefName) {
  const key = `${repo}:${baseRefName}`
  if (requiredCheckCache.has(key)) return requiredCheckCache.get(key)
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
  }
  requiredCheckCache.set(key, config)
  return config
}

function requiredChecksGate(repo, pr) {
  const config = requiredRuleConfig(repo, pr.baseRefName)
  const checks = checkConclusions(repo, pr.headRefOid)
  const checkGate = evaluateRequiredChecks({ requirements: config.requirements, checks })
  if (!checkGate.satisfied) return { ...checkGate, strict: config.strict }
  if (!config.strict) return { ...checkGate, strict: false }
  const comparison = ghJson([
    'api', `repos/${repo}/compare/${encodeURIComponent(pr.baseRefName)}...${pr.headRefOid}`,
  ])
  return {
    ...evaluateStrictPolicy({ strict: true, behindBy: comparison.behind_by }),
    strict: true,
  }
}

function refreshMergeability(repo, pr) {
  if (pr.mergeable !== 'UNKNOWN') return pr
  const live = ghJson([
    'pr', 'view', String(pr.number), '--repo', repo, '--json',
    'number,title,isDraft,baseRefName,baseRefOid,labels,author,mergeable,headRefOid,state',
  ])
  return { ...pr, ...live }
}

function livePr(repo, number) {
  return ghJson([
    'pr', 'view', String(number), '--repo', repo, '--json',
    'number,title,isDraft,baseRefName,baseRefOid,labels,author,mergeable,headRefOid,state',
  ])
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
let totalSkipped = 0

for (const repo of REPOS) {
  if (ONLY_REPO && repo !== ONLY_REPO) continue
  let prs
  try {
    prs = ghJson([
      'pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json',
      'number,title,isDraft,baseRefName,baseRefOid,labels,author,mergeable,headRefOid,state',
    ])
  } catch (e) {
    console.log(`[${repo}] 列表拉取失败：${e.message}`)
    continue
  }
  for (const listedPr of prs) {
    const pr = refreshMergeability(repo, listedPr)
    if (ONLY_PR !== null && pr.number !== ONLY_PR) continue
    const tag = `[${repo}#${pr.number}]`
    const skip = (why) => {
      totalSkipped++
      console.log(`${tag} SKIP: ${why} — ${pr.title}`)
    }
    const candidate = evaluateCandidate(repo, pr)
    if (!candidate.satisfied) { skip(candidate.reason); continue }
    const { requiredGate, isBot } = candidate
    if (candidate.humanReason) console.log(`${tag} HUMAN GATE SATISFIED: ${candidate.humanReason}`)

    const method = isBot ? '--squash' : '--merge'
    if (DRY_RUN) {
      console.log(`${tag} WOULD MERGE (${method}) — ${pr.title}`)
      continue
    }
    try {
      // strict 仓库先让 GitHub 原子执行 freshness；若其它仓库规则（例如形式化
      // approve）拒绝，则完整重读全部硬门禁，并在 head/base 均未变化时用 owner
      // bypass 重试。这样不会把已删除的人工批准门禁重新引入自动化。
      const primaryArgs = buildMergeArgs({
        repo,
        number: pr.number,
        method,
        headOid: pr.headRefOid,
        admin: !requiredGate.strict,
      })
      let primaryError = null
      try {
        gh(primaryArgs)
      } catch (error) {
        primaryError = error
      }
      let mergedPr = ghJson([
        'pr', 'view', String(pr.number), '--repo', repo, '--json',
        'state,mergedAt,mergeCommit',
      ])
      if (mergedPr.state !== 'MERGED' && primaryError && requiredGate.strict) {
        const retryPr = refreshMergeability(repo, livePr(repo, pr.number))
        const retryCandidate = evaluateCandidate(repo, retryPr)
        if (!retryCandidate.satisfied) {
          throw new Error(`strict merge 失败且重检未通过：${retryCandidate.reason}`)
        }
        const checkedBaseOid = retryPr.baseRefOid
        const snapshot = livePr(repo, pr.number)
        const snapshotGate = validateAdminFallbackSnapshot({
          expectedHeadOid: pr.headRefOid,
          checkedBaseOid,
          snapshot,
        })
        if (!snapshotGate.satisfied) {
          throw new Error(`strict merge 失败且 ${snapshotGate.reason}`)
        }
        console.log(`${tag} strict 原子 merge 被其它规则拒绝；硬门禁重检通过，使用 owner bypass`)
        gh(buildMergeArgs({
          repo,
          number: pr.number,
          method,
          headOid: pr.headRefOid,
          admin: true,
        }))
        mergedPr = ghJson([
          'pr', 'view', String(pr.number), '--repo', repo, '--json',
          'state,mergedAt,mergeCommit',
        ])
      } else if (mergedPr.state !== 'MERGED' && primaryError) {
        throw primaryError
      }
      if (mergedPr.state !== 'MERGED' || !mergedPr.mergedAt) {
        throw new Error(`合并命令返回但 live state=${mergedPr.state}`)
      }
      console.log(`${tag} MERGED (${method}) commit=${mergedPr.mergeCommit?.oid || 'unknown'} — ${pr.title}`)
      totalMerged++
    } catch (e) {
      console.log(`${tag} MERGE FAILED: ${String(e.message).slice(0, 200)}`)
    }
  }
  if (prs.length === 0) console.log(`[${repo}] 无 open PR`)
}

console.log(`\nsweep 完成：merged=${DRY_RUN ? '(dry-run)' : totalMerged} skipped=${totalSkipped}`)
