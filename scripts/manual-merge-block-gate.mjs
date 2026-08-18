import { hasReviewPermission, isApprovalText } from './human-review-gate.mjs'

const BLOCK_PATTERNS = [
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)[^。！？!\n]{0,24}(?:合并|merge)/i,
  /(?:合并|merge)[^。！？!\n]{0,16}(?:阻断|阻塞|拦截|block)/i,
  /(?:功能|发布|合并)[^。！？!\n]{0,12}(?:阻断|阻塞)/i,
  /(?:必须|需要)[^。！？!\n]{0,24}修复[^。！？!\n]{0,24}(?:才能|之后再|前不|之前不)[^。！？!\n]{0,12}合并/i,
  /\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b/i,
  /\bnot\s+ready\s+to\s+merge\b/i,
  /\b(?:merge\s+)?blocker\b|\bblocking\s+(?:the\s+)?merge\b/i,
  /\bmust\s+(?:be\s+)?fix(?:ed)?\s+before\s+merge\b/i,
]

function classifyMergeIntentText(body) {
  const text = String(body || '').trim()
  if (!text) return null
  const clauses = text
    .split(/[。！？!?；;，,\n]+|\.(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean)
  let intent = null
  for (const clause of clauses) {
    if (BLOCK_PATTERNS.some((pattern) => pattern.test(clause))) intent = 'block'
    if (isApprovalText(clause)) intent = 'release'
  }
  return intent
}

export function isMergeBlockText(body) {
  return classifyMergeIntentText(body) === 'block'
}

function eventTimestamp(value) {
  return Date.parse(value || '') || 0
}

function newerThan(candidate, current) {
  if (!current) return true
  if (candidate.at !== current.at) return candidate.at > current.at
  return candidate.index > current.index
}

export function evaluateManualMergeBlockGate({
  headOid,
  headCommittedAt,
  reviews = [],
  comments = [],
}) {
  const latestBlockByLogin = new Map()
  const latestReleaseByLogin = new Map()
  const dismissedReviewIds = new Set(
    reviews
      .filter((review) => review.dismissed_at
        || String(review.state || '').toUpperCase() === 'DISMISSED')
      .map((review) => review.id)
      .filter((id) => id !== undefined && id !== null),
  )
  let index = 0

  for (const review of reviews) {
    index++
    if (!hasReviewPermission(review.permission)) continue
    if (dismissedReviewIds.has(review.id)) continue
    const login = String(review.login || '').toLowerCase()
    if (!login) continue
    const state = String(review.state || '').toUpperCase()
    const event = { at: eventTimestamp(review.submitted_at), index, source: 'review', login: review.login }
    if (state === 'CHANGES_REQUESTED') {
      if (newerThan(event, latestBlockByLogin.get(login))) latestBlockByLogin.set(login, event)
      continue
    }
    if (state === 'APPROVED'
      && String(review.commit_id || '').toLowerCase() === String(headOid || '').toLowerCase()) {
      if (newerThan(event, latestReleaseByLogin.get(login))) latestReleaseByLogin.set(login, event)
    }
  }

  for (const comment of comments) {
    index++
    if (!hasReviewPermission(comment.permission)) continue
    const login = String(comment.login || '').toLowerCase()
    if (!login) continue
    const event = { at: eventTimestamp(comment.created_at), index, source: 'comment', login: comment.login }
    const intent = classifyMergeIntentText(comment.body)
    if (intent === 'release' && event.at >= headCommittedAt) {
      if (newerThan(event, latestReleaseByLogin.get(login))) latestReleaseByLogin.set(login, event)
      continue
    }
    if (intent === 'block') {
      if (newerThan(event, latestBlockByLogin.get(login))) latestBlockByLogin.set(login, event)
    }
  }

  const blockers = []
  for (const [login, block] of latestBlockByLogin) {
    const release = latestReleaseByLogin.get(login)
    // GitHub timestamps are only second-granular across different event streams.
    // If a release and block share a timestamp, keep the safer block until the
    // original blocker produces an unambiguously later release.
    if (!release || release.at <= block.at) {
      blockers.push({ login: block.login || login, at: block.at, source: block.source })
    }
  }
  blockers.sort((a, b) => b.at - a.at)

  if (blockers.length > 0) {
    return {
      satisfied: false,
      blockers,
      reason: `有权限成员明确阻止合并，待原阻止者确认当前 head：${blockers.map((item) => item.login).join(', ')}`,
    }
  }
  return { satisfied: true, blockers: [], reason: null }
}
