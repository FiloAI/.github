export const CODEX_LOGINS = new Set([
  'chatgpt-codex-connector[bot]',
  'chatgpt-codex-connector',
])

const REVIEW_STATES = new Set(['APPROVED', 'COMMENTED'])

function sameCommit(candidate, headOid) {
  const candidateOid = String(candidate || '').toLowerCase()
  const head = String(headOid || '').toLowerCase()
  return candidateOid.length >= 7 && head.length >= 7 && candidateOid === head
}

export function hasCurrentHeadCodexReview({ reviews = [], comments = [], headOid }) {
  const head = String(headOid || '').toLowerCase()
  if (!head) return false

  const formalReview = reviews.some((review) =>
    CODEX_LOGINS.has(review.user?.login || review.login || '')
      && REVIEW_STATES.has(String(review.state || '').toUpperCase())
      && sameCommit(review.commit_id || review.commitOid, head))
  if (formalReview) return true

  return comments.some((comment) => {
    const login = comment.user?.login || comment.login || ''
    if (!CODEX_LOGINS.has(login)) return false
    const body = String(comment.body || '')
    if (!/didn'?t find any major issues/i.test(body)) return false
    const match = body.match(/reviewed commit[^0-9a-f]*([0-9a-f]{7,40})/i)
    return Boolean(match && head.startsWith(match[1].toLowerCase()))
  })
}
