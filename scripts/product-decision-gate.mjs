import { ownerApprovalMarker } from './high-risk-review-gate.mjs'
import { isMergeOwner } from './merge-owner-logins.mjs'

const HIGH_SEVERITY_PATTERN =
  /(?:alt=["']?P([01])["']?|badge\/P([01])-|\bP([01])\b)/i

const PRODUCT_DEFERRAL_PATTERN =
  /(?:产品(?:决定|决策|取舍)|不在本\s*PR\s*(?:修|改|处理)|超出(?:本\s*PR\s*)?范围|不改|不修|暂不处理|后续(?:处理|再处理|修复|解决|\s*PR|\s*issue)|另开(?:\s*PR|\s*issue)?|(?:会|将|将在)[^。！？!?\n]{0,30}(?:修复|处理|解决)|(?:下个|下一(?:个)?|以后|稍后)[^。！？!?\n]{0,24}(?:修复|处理|解决))|\b(?:product\s+(?:decision|trade-?off)|out\s+of\s+scope|not\s+in\s+this\s+PR|won't\s+fix|will\s+not\s+fix|defer(?:red|ring)?|follow-?up\s+(?:PR|issue)|separate\s+(?:PR|issue)|(?:will|plan(?:ned)?\s+to|going\s+to)[^.\n]{0,40}(?:fix|address|resolve)[^.\n]{0,40}(?:later|follow-?up|next\s+(?:PR|pull\s+request))|(?:fix|address|resolve)[^.\n]{0,20}(?:this|it)[^.\n]{0,20}later)\b/i

const NEGATED_PRODUCT_DEFERRAL_PATTERN =
  /(?:不是|并非|并不是)\s*(?:产品(?:决定|决策|取舍)|不改|不修|暂不处理|超出(?:本\s*PR\s*)?范围)|\b(?:is\s+not|isn't|not)\s+(?:a\s+)?(?:product\s+(?:decision|trade-?off)|out\s+of\s+scope|defer(?:red)?)\b/gi

const REVIEWER_ACCEPTANCE_PATTERN =
  /(?:接受|同意|不再阻塞|不阻塞|非阻塞|撤回|可以另开|单独处理)|\b(?:accept(?:ed)?|agree(?:d)?|makes?\s+sense|not\s+a\s+blocker|non-?blocking|withdraw(?:n)?|separate\s+concern|keep\s+the\s+scope\s+tight)\b/i

const REVIEWER_REJECTION_PATTERN =
  /(?:不接受|不同意|不理解|仍(?:然)?阻塞|还是阻塞|不能另开|不可另开|合并前仍需|仍需修复)|\b(?:do\s+not|don't|cannot|can't|won't)\s+(?:accept|agree|withdraw)|\b(?:still|remains?)\s+(?:a\s+)?blocker\b|\b(?:but|however)\b[^.。！？!?\n]{0,80}\b(?:still\s+needs?\s+to|needs?\s+to\s+be\s+fixed|must\s+be\s+fixed|before\s+merge|block(?:er|ing)?)\b/i

const FINDING_FIXED_PATTERN =
  /(?:已|已经)(?:修复|处理|解决|改好)|(?:已|已经)?补(?:上|了)?(?:回归)?测试|\b(?:fixed|addressed|resolved|implemented)(?:\s+this|\s+it|\s+the\s+(?:issue|finding))?\b/i

function sameHead(value, headOid) {
  return String(value || '').toLowerCase() === String(headOid || '').toLowerCase()
}

function eventTime(value) {
  return Date.parse(value || 0) || 0
}

function commentTime(comment) {
  return eventTime(comment?.updated_at || comment?.created_at)
}

function dispositionTime(comment) {
  return eventTime(comment?.created_at)
}

function isExplicitReviewerAcceptance(body) {
  const value = String(body || '')
  return REVIEWER_ACCEPTANCE_PATTERN.test(value) && !REVIEWER_REJECTION_PATTERN.test(value)
}

function isExplicitReviewerRejection(body) {
  return REVIEWER_REJECTION_PATTERN.test(String(body || ''))
}

function isProductDeferral(body) {
  const value = String(body || '').replace(NEGATED_PRODUCT_DEFERRAL_PATTERN, ' ')
  return PRODUCT_DEFERRAL_PATTERN.test(value)
}

function severityOf(body) {
  const match = String(body || '').match(HIGH_SEVERITY_PATTERN)
  const level = match?.slice(1).find(Boolean)
  return level ? `P${level}` : null
}

export function normalizeProductDecisionIssueComment(comment) {
  return {
    login: comment.user?.login || '',
    body: comment.body || '',
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  }
}

export function normalizeProductDecisionThread(thread) {
  return {
    is_resolved: thread.isResolved,
    is_outdated: thread.isOutdated,
    resolved_by: thread.resolvedBy?.login || '',
    comments: thread.comments.nodes.map((comment) => ({
      login: comment.author?.login || '',
      body: comment.body || '',
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    })),
  }
}

function isReviewerAcceptance({ thread, reviewerLogin, deferralIndex, reviews, headOid }) {
  const deferral = thread.comments[deferralIndex]
  const deferralAt = commentTime(deferral) || Number.MAX_SAFE_INTEGER
  const dispositions = []
  let index = 0

  for (const comment of thread.comments.slice(deferralIndex + 1)) {
    index++
    if (String(comment.login || '').toLowerCase() !== reviewerLogin) continue
    const at = dispositionTime(comment)
    if (at < deferralAt) continue
    if (isExplicitReviewerRejection(comment.body)) {
      dispositions.push({ disposition: 'reject', at, index })
    } else if (isExplicitReviewerAcceptance(comment.body)) {
      dispositions.push({ disposition: 'accept', at, index })
    }
  }

  for (const review of reviews) {
    index++
    if (String(review.login || '').toLowerCase() !== reviewerLogin
      || !sameHead(review.commit_id, headOid)) continue
    const at = eventTime(review.submitted_at)
    if (at < deferralAt) continue
    const state = String(review.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED') {
      dispositions.push({ disposition: 'reject', at, index })
    } else if (state === 'APPROVED') {
      dispositions.push({ disposition: 'accept', at, index })
    }
  }

  dispositions.sort((left, right) => left.at - right.at || left.index - right.index)
  return dispositions.at(-1)?.disposition === 'accept'
}

function ownerDecisionEvidence({ authorLogin, headOid, after, reviews, comments }) {
  const author = String(authorLogin || '').toLowerCase()
  if (isMergeOwner(author)) return `owner-author:${author}`

  const review = reviews.find((item) => (
    isMergeOwner(item.login)
      && String(item.state || '').toUpperCase() === 'APPROVED'
      && sameHead(item.commit_id, headOid)
      && eventTime(item.submitted_at) >= after
  ))
  if (review) return `owner-review:${review.login}`

  const marker = ownerApprovalMarker(headOid)
  const comment = comments.find((item) => (
    isMergeOwner(item.login)
      && String(item.body || '').toLowerCase().includes(marker)
      && eventTime(item.updated_at || item.created_at) >= after
  ))
  return comment ? `owner-marker:${comment.login}` : null
}

export function evaluateProductDecisionGate({
  headOid,
  authorLogin,
  threads = [],
  reviews = [],
  comments = [],
}) {
  const author = String(authorLogin || '').toLowerCase()
  const blockers = []

  for (const thread of threads) {
    if (!thread.is_resolved || thread.is_outdated) continue
    const findingIndex = thread.comments.findIndex((comment) => (
      String(comment.login || '').toLowerCase() !== author && severityOf(comment.body)
    ))
    if (findingIndex < 0) continue

    const finding = thread.comments[findingIndex]
    const severity = severityOf(finding.body)
    const reviewerLogin = String(finding.login || '').toLowerCase()
    const authorEvents = thread.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment, index }) => (
        index > findingIndex
          && String(comment.login || '').toLowerCase() === author
          && (isProductDeferral(comment.body) || FINDING_FIXED_PATTERN.test(String(comment.body || '')))
      ))
      .map(({ comment, index }) => ({
        kind: isProductDeferral(comment.body) ? 'deferral' : 'fixed',
        index,
        at: commentTime(comment),
      }))
      .sort((left, right) => left.at - right.at || left.index - right.index)

    const latestDeferral = authorEvents.filter((event) => event.kind === 'deferral').at(-1)
    if (!latestDeferral) continue
    const latestEvent = authorEvents.at(-1)
    if (latestEvent?.kind === 'fixed'
      && latestEvent.at >= latestDeferral.at
      && String(thread.resolved_by || '').toLowerCase() === reviewerLogin) {
      continue
    }

    const deferralIndex = latestDeferral.index
    if (isReviewerAcceptance({ thread, reviewerLogin, deferralIndex, reviews, headOid })) continue
    blockers.push({
      severity,
      reviewer: finding.login || 'unknown',
      at: commentTime(thread.comments[deferralIndex]) || Number.MAX_SAFE_INTEGER,
    })
  }

  if (blockers.length === 0) {
    return { satisfied: true, reason: null, evidence: null, blockers: [] }
  }

  const evidence = ownerDecisionEvidence({
    authorLogin,
    headOid,
    after: Math.max(...blockers.map((item) => item.at)),
    reviews,
    comments,
  })
  if (evidence) return { satisfied: true, reason: null, evidence, blockers: [] }

  const detail = blockers.map((item) => `${item.severity}:${item.reviewer}`).join(', ')
  return {
    satisfied: false,
    reason: `P0/P1 finding 被作者以产品取舍关闭，待 Chris 或 Bobo 确认当前 head（${detail}）`,
    evidence: null,
    needsOwnerReview: true,
    blockers,
  }
}
