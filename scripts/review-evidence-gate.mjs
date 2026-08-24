const PASS_STATES = new Set(['APPROVED', 'COMMENTED'])

const FAILED_REVIEW_PATTERN =
  /(?:无法|未能|不能|拒绝|跳过|没有)(?:完成|进行)?(?:代码)?审查|(?:审查|review)(?:失败|超时|未运行|不可用)|\b(?:unable|failed|failure|timed?\s*out|skipped|refused|could\s+not|couldn't)\b[^.\n]{0,40}\breview\b|\breview\b[^.\n]{0,40}\b(?:failed|failure|timed?\s*out|skipped|unavailable)\b/i

export const REVIEW_MARKER_PREFIX = '<!-- filoai-merge-steward:reviewed'

export function mergeReviewMarker(headOid) {
  return `${REVIEW_MARKER_PREFIX} head=${String(headOid || '').toLowerCase()} verdict=pass -->`
}

function sameHead(value, headOid) {
  return String(value || '').toLowerCase() === String(headOid || '').toLowerCase()
}

function hasPassingMarker(body, headOid) {
  const escapedHead = String(headOid || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `<!--\\s*filoai-merge-steward:reviewed\\s+head=${escapedHead}\\s+verdict=pass\\s*-->`,
    'i',
  ).test(String(body || ''))
}

function isFailedReview(body) {
  return FAILED_REVIEW_PATTERN.test(String(body || ''))
}

export function evaluateReviewEvidence({
  headOid,
  authorLogin,
  reviews = [],
  comments = [],
  trustedStewardLogins = [],
}) {
  const author = String(authorLogin || '').toLowerCase()
  const trusted = new Set(trustedStewardLogins.map((login) => String(login).toLowerCase()))

  const formalReview = reviews.find((review) => {
    const login = String(review.login || '').toLowerCase()
    const state = String(review.state || '').toUpperCase()
    return login
      && login !== author
      && PASS_STATES.has(state)
      && sameHead(review.commit_id, headOid)
      && !isFailedReview(review.body)
  })
  if (formalReview) {
    return {
      satisfied: true,
      reason: null,
      evidence: `formal-review:${formalReview.login}`,
    }
  }

  const stewardComment = comments.find((comment) => {
    const login = String(comment.login || '').toLowerCase()
    return trusted.has(login)
      && hasPassingMarker(comment.body, headOid)
      && !isFailedReview(comment.body)
  })
  if (stewardComment) {
    return {
      satisfied: true,
      reason: null,
      evidence: `merge-steward:${stewardComment.login}`,
    }
  }

  return {
    satisfied: false,
    reason: '当前 head 尚无可审计的 AI 或非作者人工审核答复',
    evidence: null,
  }
}
