const REVIEW_PERMISSIONS = new Set(['admin', 'maintain', 'write'])

const EXACT_APPROVALS = new Set([
  '同意',
  '确认',
  '可以',
  '可以了',
  '通过',
  '通过了',
  '合并',
  '合并吧',
  '没问题',
  '允许合并',
  '同意合并',
  '确认合并',
  'ok',
  'okay',
  'lgtm',
  'approve',
  'approved',
  'merge',
  'merge it',
  'go ahead',
  'ship it',
])

const CONDITIONAL_OR_NEGATIVE =
  /(?:不同意|不确认|不允许|不能|不可以|暂不|暂缓|先别|不要|勿|待确认|等待确认|需要确认|请确认|修复后|完成后|通过后|确认后|审核后|once\b|after\b|when\b|not\s+(?:approve|merge)|do\s+not\s+(?:approve|merge)|don['’]t\s+(?:approve|merge)|can['’]t\s+merge|cannot\s+merge)/i

const STRONG_APPROVAL =
  /(?:我)?(?:同意|确认|允许)(?:这个|该)?(?:\s*pr)?(?:可以)?(?:直接)?合并|可以(?:直接)?合并|没问题(?:了)?|(?:已经)?通过(?:了)?|\b(?:lgtm|approved?|ok(?:ay)?\s+to\s+merge|please\s+merge|merge\s+it|go\s+ahead|ship\s+it)\b/i

export function hasReviewPermission(permission) {
  return REVIEW_PERMISSIONS.has(String(permission || '').toLowerCase())
}

export function isApprovalText(body) {
  const text = String(body || '').trim()
  if (!text) return false
  const sentences = text
    .split(/[。！？!?；;\n]+|\.(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean)

  return sentences.some((sentence) => {
    const normalized = sentence.toLowerCase().replace(/[.。！!]+$/g, '').trim()
    if (!normalized || CONDITIONAL_OR_NEGATIVE.test(normalized)) return false
    if (/(?:修复|完成|通过|确认|审核)后[\s\S]*(?:合并|同意|确认|允许|可以)|\b(?:once|after|when)\b[\s\S]*\b(?:merge|approve)\b/i.test(normalized)) {
      return false
    }
    return EXACT_APPROVALS.has(normalized) || STRONG_APPROVAL.test(normalized)
  })
}

export function evaluateHumanReviewGate({
  hasLabel,
  authorLogin,
  authorPermission,
  headOid,
  headCommittedAt,
  reviews = [],
  comments = [],
}) {
  if (!hasLabel) return { satisfied: true, reason: null }
  if (hasReviewPermission(authorPermission)) {
    return {
      satisfied: true,
      reason: `作者 ${authorLogin} 具备 ${authorPermission} 权限，无需自我确认`,
    }
  }

  for (let index = reviews.length - 1; index >= 0; index--) {
    const review = reviews[index]
    if (String(review.commit_id || '').toLowerCase() !== String(headOid || '').toLowerCase()) continue
    if (String(review.state || '').toUpperCase() !== 'APPROVED') continue
    if (!hasReviewPermission(review.permission)) continue
    return {
      satisfied: true,
      reason: `${review.login}（${review.permission}）已批准当前 head`,
    }
  }

  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index]
    if ((Date.parse(comment.created_at) || 0) < headCommittedAt) continue
    if (!hasReviewPermission(comment.permission) || !isApprovalText(comment.body)) continue
    return {
      satisfied: true,
      reason: `${comment.login}（${comment.permission}）已明确确认`,
    }
  }

  return { satisfied: false, reason: 'needs-human-review 尚无有权限者确认' }
}
