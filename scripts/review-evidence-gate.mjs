const PASS_STATES = new Set(['APPROVED', 'COMMENTED'])

const FAILED_REVIEW_PATTERN =
  /(?:无法|未能|不能|拒绝|跳过)(?:完成|进行)?(?:代码)?审查|(?:没有|尚未)(?:完成|进行)(?:代码)?审查|(?:审查|review)(?:失败|超时|未运行|不可用)|\b(?:did\s+not|didn't|have\s+not|haven't)\s+review\b|\b(?:unable|failed|failure|timed?\s*out|skipped|refused|could\s+not|couldn't)\b[^.\n]{0,40}\breview\b|\breview\b[^.\n]{0,40}\b(?:failed|failure|timed?\s*out|skipped|unavailable)\b/i

const SUBSTANTIVE_COMMENTED_REVIEW =
  /\b(?:lgtm|approved?|reviewed|looks?\s+good|no\s+(?:issues?|findings?|blockers?)|issues?|findings?|bugs?)\b|(?:审查|审核)(?:已)?通过|(?:未发现|没有)(?:可行动的?)?(?:问题|缺陷|阻塞)|(?:问题|缺陷|风险|建议)/i

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

function isSubstantiveCommentedReview(body) {
  const text = String(body || '').trim()
  return text.length > 0 && SUBSTANTIVE_COMMENTED_REVIEW.test(text) && !isFailedReview(text)
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
    const body = review.body || ''
    return login
      && login !== author
      && PASS_STATES.has(state)
      && sameHead(review.commit_id, headOid)
      && !isFailedReview(body)
      && (state === 'APPROVED' || isSubstantiveCommentedReview(body) || review.hasInlineComments === true)
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
