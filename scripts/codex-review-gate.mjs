export const CODEX_LOGINS = new Set([
  'chatgpt-codex-connector[bot]',
  'chatgpt-codex-connector',
])

function sameCommit(candidate, headOid) {
  const candidateOid = String(candidate || '').toLowerCase()
  const head = String(headOid || '').toLowerCase()
  return candidateOid.length >= 7 && head.length >= 7 && candidateOid === head
}

function isStandardCodexCommentedReview(body, headOid) {
  const match = String(body || '').match(
    /^\s*### 💡 Codex Review\s+Here are some automated review suggestions for this pull request\.\s+\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`\s*(?:<details>[\s\S]*<\/details>)?\s*$/,
  )
  return Boolean(match && String(headOid || '').toLowerCase().startsWith(match[1].toLowerCase()))
}

export function hasCurrentHeadCodexReview({ reviews = [], comments = [], headOid }) {
  const head = String(headOid || '').toLowerCase()
  if (!head) return false

  const formalReview = reviews.some((review) => {
    if (!CODEX_LOGINS.has(review.user?.login || review.login || '')) return false
    if (!sameCommit(review.commit_id || review.commitOid, head)) return false
    const state = String(review.state || '').toUpperCase()
    if (state === 'APPROVED') return true
    return state === 'COMMENTED' && isStandardCodexCommentedReview(review.body, head)
  })
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
