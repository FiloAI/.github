const REVIEW_PERMISSIONS = new Set(['admin', 'maintain', 'write'])
const OWNER_VETO_LOGINS = new Set(['zqchris', 'xd-bobo'])

const BLOCK_PATTERNS = [
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)[^。！？!\n]{0,24}(?:合并|merge)/i,
  /(?:不同意|不确认|不允许|不批准|未批准)[^。！？!\n]{0,16}(?:合并|merge)/i,
  /(?:合并|merge)[^。！？!\n]{0,16}(?:阻断|阻塞|拦截|block)/i,
  /(?:功能|发布|合并)[^。！？!\n]{0,12}(?:阻断|阻塞)/i,
  /\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b|\bnot\s+ready\s+to\s+merge\b|\bnot\s+approved?\b|\bmerge\s+blocker\b/i,
]

const EXPLICIT_VETO_PATTERN =
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)(?:(?!阻塞|阻断|卡住|拦截)[^。！？!\n]){0,24}(?:合并|merge)|\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b|\bnot\s+ready\s+to\s+merge\b/i

const APPROVAL_PATTERN =
  /(?:同意|确认|允许)(?:这个|该)?(?:\s*pr)?(?:可以)?(?:直接)?合并|可以(?:直接)?合并|(?:代码)?(?:审查|审核)(?:已经|已)?通过(?:了)?|\b(?:lgtm|approved?|ok(?:ay)?\s+to\s+merge|please\s+merge|merge\s+it|go\s+ahead|ship\s+it)\b/i

const CLAUSE_UNCERTAINTY =
  /[?？]|(?:吗|么|呢|吧)(?:$|[\s。！？!?，,；;])/i

const PENDING_CONDITION =
  /(?:不同意|不确认|不允许|不批准|未批准|不过|但是|但|仍然?|还(?:需|要)|需要|必须|先(?:修|处理|解决)|待(?:修|处理|解决)|才能|之后再|之前不|前不)|\b(?:not\s+approved?|do\s+not\s+approve|don't\s+approve|but|however|still|need(?:s|ed)?\s+to|must|before)\b|\b(?:after|when|once|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending)\b/i

const STANDALONE_APPROVAL_CONDITION =
  /^(?:after|when|once|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending)\b|\bbefore\s+(?:merge|merging)\b|^(?:如果|若|待|等到|需要先|必须先|先)[^。！？!?；;\n]{0,80}(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿)|\b(?:must|needs?\s+to|has\s+to)\b[^。！？!?；;\n]{0,80}\b(?:fix|pass|complete|resolve|sign\s*off|approve|succeed|green|ready|done|before\s+(?:merge|merging))\b/i

const NON_BLOCKING_PATTERN =
  /(?:不能|不会|不应|不得)[^。！？!\n]{0,16}(?:阻塞|阻断|卡住|拦截)[^。！？!\n]{0,8}(?:合并|merge)|(?:不|未)(?:是|属于|构成|算作)[^。！？!\n]{0,16}(?:合并)?(?:门禁|阻塞|阻断|blocker)|(?:没有|无)(?:任何)?[^。！？!\n]{0,8}(?:合并)?(?:阻断|阻塞|blockers?)|(?:不存在|未发现)[^。！？!\n]{0,20}(?:合并阻断|合并阻塞|merge\s+blockers?)|\bno\s+(?:merge\s+)?blockers?\b|\bno\s+(?:merge\s+)?blockers?\s+found\b/i

const STEWARD_MARKERS = [
  'merge-steward-verdict:',
  'filoai-merge-steward:failure',
  'filoai-merge-steward:status',
  'filoai-merge-steward:reviewed',
  'filoai-merge-steward:owner-approved',
  'filoai-merge-steward:owner-review-request',
]

function hasReviewPermission(permission) {
  return REVIEW_PERMISSIONS.has(String(permission || '').toLowerCase())
}

function canBlock(login, permission) {
  return hasReviewPermission(permission) || OWNER_VETO_LOGINS.has(String(login || '').toLowerCase())
}

function referencesHead(text, headOid) {
  const shas = String(text || '').match(/\b[0-9a-f]{7,40}\b/gi) || []
  return shas.some((sha) => String(headOid || '').toLowerCase().startsWith(sha.toLowerCase()))
}

function clausesFrom(body) {
  return String(body || '')
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function referencesDifferentPr(text, prNumber) {
  if (/\b(?:another|other)\s+(?:pull\s+request|pr)\b|(?:另一个|其它|其他)(?:\s*PR|拉取请求)/i.test(String(text || ''))) {
    return true
  }
  if (!Number.isInteger(prNumber)) return false
  const references = [...String(text || '').matchAll(/\b(?:pull\s+request|pr)\s*#?(\d+)\b/gi)]
  return references.some((match) => Number(match[1]) !== prNumber)
}

function classifyTextIntent(body, headOid, prNumber) {
  if (STEWARD_MARKERS.some((marker) => String(body || '').includes(marker))) return null
  const clauses = clausesFrom(body)
  let intent = null
  for (const [clauseIndex, clause] of clauses.entries()) {
    const clauseUncertainty = CLAUSE_UNCERTAINTY.test(clause)
    const pendingCondition = PENDING_CONDITION.test(clause)

    const explicitBlock = EXPLICIT_VETO_PATTERN.test(clause)
      || (!NON_BLOCKING_PATTERN.test(clause)
        && BLOCK_PATTERNS.some((pattern) => pattern.test(clause)))
    if (explicitBlock) {
      intent = 'block'
    }

    // A veto in the same clause always wins. Questions and conditional
    // approvals are not an explicit current-head release. A condition may
    // be separated by explanatory clauses, but a condition explicitly
    // scoped to another PR must not poison this PR's release.
    const relatedCondition = clauses.some((candidate, candidateIndex) => (
      candidateIndex !== clauseIndex
        && !CLAUSE_UNCERTAINTY.test(candidate)
        && STANDALONE_APPROVAL_CONDITION.test(candidate)
        && !referencesDifferentPr(candidate, prNumber)
    ))
    if (!explicitBlock
      && !clauseUncertainty
      && !pendingCondition
      && !relatedCondition
      && APPROVAL_PATTERN.test(clause)
      && referencesHead(clause, headOid)) {
      intent = 'release'
    }
  }
  return intent
}

function recordTextSignals({ body, login, at, headOid, prNumber, latestBlock, latestRelease, nextIndex }) {
  const intent = classifyTextIntent(body, headOid, prNumber)
  if (!intent) return
  nextIndex()
  if (intent === 'block') latestBlock(login, at)
  if (intent === 'release') latestRelease(login, at)
}

export function evaluateManualBlockers({ headOid, prNumber, reviews = [], comments = [] }) {
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
    if (!canBlock(review.login, review.permission) || review.is_bot) continue
    const at = Date.parse(review.submitted_at || 0) || 0
    const state = String(review.state || '').toUpperCase()
    if (state === 'DISMISSED') continue
    if (state === 'CHANGES_REQUESTED') record(latestBlock, review.login, at)
    if (state === 'APPROVED'
      && String(review.commit_id || '').toLowerCase() === String(headOid || '').toLowerCase()) {
      record(latestRelease, review.login, at)
    }
    if (state === 'COMMENTED') {
      recordTextSignals({
        body: review.body,
        login: review.login,
        at,
        headOid,
        prNumber,
        latestBlock: (login, signalAt) => record(latestBlock, login, signalAt),
        latestRelease: (login, signalAt) => record(latestRelease, login, signalAt),
        nextIndex: () => { index++ },
      })
    }
  }

  for (const comment of comments) {
    if (!canBlock(comment.login, comment.permission) || comment.is_bot) continue
    const at = Date.parse(comment.updated_at || comment.created_at || 0) || 0
    recordTextSignals({
      body: comment.body,
      login: comment.login,
      at,
      headOid,
      prNumber,
      latestBlock: (login, signalAt) => record(latestBlock, login, signalAt),
      latestRelease: (login, signalAt) => record(latestRelease, login, signalAt),
      nextIndex: () => { index++ },
    })
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
