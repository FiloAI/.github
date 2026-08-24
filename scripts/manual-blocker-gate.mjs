const REVIEW_PERMISSIONS = new Set(['admin', 'maintain', 'write'])

const BLOCK_PATTERNS = [
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)[^。！？!\n]{0,24}(?:合并|merge)/i,
  /(?:合并|merge)[^。！？!\n]{0,16}(?:阻断|阻塞|拦截|block)/i,
  /(?:功能|发布|合并)[^。！？!\n]{0,12}(?:阻断|阻塞)/i,
  /\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b|\bnot\s+ready\s+to\s+merge\b|\b(?:merge\s+)?blocker\b/i,
]

const APPROVAL_PATTERN =
  /(?:同意|确认|允许)(?:这个|该)?(?:\s*pr)?(?:可以)?(?:直接)?合并|可以(?:直接)?合并|没问题(?:了)?|(?:已经)?通过(?:了)?|\b(?:lgtm|approved?|ok(?:ay)?\s+to\s+merge|please\s+merge|merge\s+it|go\s+ahead|ship\s+it)\b/i

const UNCERTAIN_OR_PENDING =
  /[?？]|(?:不过|但是|但|仍然?|还(?:需|要)|需要|必须|先(?:修|处理|解决)|待(?:修|处理|解决)|才能|之后再|之前不|前不)|\b(?:but|however|still|need(?:s|ed)?\s+to|must|before|once|after|when)\b/i

function hasReviewPermission(permission) {
  return REVIEW_PERMISSIONS.has(String(permission || '').toLowerCase())
}

function referencesHead(text, headOid) {
  const shas = String(text || '').match(/\b[0-9a-f]{7,40}\b/gi) || []
  return shas.some((sha) => String(headOid || '').toLowerCase().startsWith(sha.toLowerCase()))
}

export function evaluateManualBlockers({ headOid, reviews = [], comments = [] }) {
  const latestBlock = new Map()
  const latestRelease = new Map()
  let index = 0
  const record = (target, login, at) => {
    const key = String(login || '').toLowerCase()
    if (!key) return
    const previous = target.get(key)
    if (!previous || at > previous.at || (at === previous.at && index > previous.index)) {
      target.set(key, { login, at, index })
    }
  }

  for (const review of reviews) {
    index++
    if (!hasReviewPermission(review.permission)) continue
    const at = Date.parse(review.submitted_at || 0) || 0
    const state = String(review.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED') record(latestBlock, review.login, at)
    if (state === 'APPROVED'
      && String(review.commit_id || '').toLowerCase() === String(headOid || '').toLowerCase()) {
      record(latestRelease, review.login, at)
    }
  }

  for (const comment of comments) {
    if (!hasReviewPermission(comment.permission)) continue
    const at = Date.parse(comment.created_at || 0) || 0
    const clauses = String(comment.body || '')
      .split(/[。！？!?；;，,\n]+|\.(?:\s+|$)/)
      .map((part) => part.trim())
      .filter(Boolean)
    for (const clause of clauses) {
      index++
      if (BLOCK_PATTERNS.some((pattern) => pattern.test(clause))) {
        record(latestBlock, comment.login, at)
      }
      if (!UNCERTAIN_OR_PENDING.test(clause)
        && APPROVAL_PATTERN.test(clause)
        && referencesHead(clause, headOid)) {
        record(latestRelease, comment.login, at)
      }
    }
  }

  const blockers = [...latestBlock.entries()]
    .filter(([login, block]) => {
      const release = latestRelease.get(login)
      return !release || release.at < block.at
        || (release.at === block.at && release.index <= block.index)
    })
    .map(([, block]) => block.login)

  if (blockers.length > 0) {
    return {
      satisfied: false,
      reason: `具备权限的真人明确阻止：${blockers.join(', ')}`,
      blockers,
    }
  }
  return { satisfied: true, reason: null, blockers: [] }
}
