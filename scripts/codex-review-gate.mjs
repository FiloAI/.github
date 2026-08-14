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
    /^\s*### 💡 Codex Review\s+Here are some automated review suggestions for this pull request\.\s+\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`\s*([\s\S]*)$/,
  )
  if (!match || !String(headOid || '').toLowerCase().startsWith(match[1].toLowerCase())) return false
  const details = match[2].trim()
  if (!details) return true
  const lines = details.split('\n').map((line) => line.trim()).filter(Boolean)
  return JSON.stringify(lines) === JSON.stringify([
    '<details> <summary>ℹ️ About Codex in GitHub</summary>',
    '<br/>',
    '[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you',
    '- Open a pull request for review',
    '- Mark a draft as ready',
    '- Comment "@codex review".',
    'If Codex has suggestions, it will comment; otherwise it will react with 👍.',
    'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
    '</details>',
  ])
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
