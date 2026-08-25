import { ownerApprovalMarker } from './high-risk-review-gate.mjs'
import { isMergeOwner } from './merge-owner-logins.mjs'

const SEVERITY_PATTERN =
  /(?:alt=["']?P([0123])["']?|badge\/P([0123])-|\bP([0123])\b)/i

const SEVERITY_CHANGE_PATTERN =
  /\b(?:downgrad(?:e|ed|ing)|upgrad(?:e|ed|ing)|escalat(?:e|ed|ing)|reclassif(?:y|ied|ying)|severity|priority|should\s+be)\b|(?:降级|升级|提高|降低|调整|改为|定为)/i

const PRODUCT_DEFERRAL_PATTERN =
  /(?:产品(?:决定|决策|取舍)|不在本\s*PR\s*(?:修|改|处理)|超出(?:本\s*PR\s*)?范围|不改|不修|暂不处理|后续(?:处理|再处理|修复|解决|\s*PR|\s*issue)|另开(?:\s*PR|\s*issue)?|(?:会|将|将在)[^。！？!?\n]{0,30}(?:修复|处理|解决)|(?:下个|下一(?:个)?|以后|稍后)[^。！？!?\n]{0,24}(?:修复|处理|解决))|\b(?:product\s+(?:decision|trade-?off)|(?:(?:this|that)(?:\s+behavio(?:u)?r)?|it)\s+(?:is|'s)\s+(?:by\s+design|expected\s+behavio(?:u)?r)|keep(?:ing)?(?:\s+(?:this|it))?\s+as[-\s]+is|out\s+of\s+scope|not\s+in\s+this\s+PR|(?:won['’]t|will\s+not)\s+(?:fix|address|resolve)|(?:(?:i(?:\s+am|['’]m)|we(?:\s+are|['’]re))\s+not\s+going\s+to\s+(?:fix|address|resolve))|(?:(?:i|we)\s+)?(?:do\s+not|don['’]t)\s+plan\s+to\s+(?:fix|address|resolve)|(?:(?:i|we)\s+)?(?:have|has)\s+no\s+plans?\s+to\s+(?:fix|address|resolve)|defer(?:red|ring)?|follow-?up\s+(?:PR|issue)|separate\s+(?:PR|issue)|(?:will|plan(?:ned)?\s+to|going\s+to)[^.\n]{0,40}(?:fix|address|resolve)[^.\n]{0,40}(?:later|follow-?up|next\s+(?:PR|pull\s+request))|(?:fix|address|resolve)[^.\n]{0,20}(?:this|it)[^.\n]{0,20}later)\b/i

const NEGATED_PRODUCT_DEFERRAL_PATTERN =
  /(?:不是|并非|并不是)\s*(?:产品(?:决定|决策|取舍)|不改|不修|暂不处理|超出(?:本\s*PR\s*)?范围)|\b(?:is\s+not|isn't|was\s+not|wasn't|not)\s+(?:a\s+)?(?:product\s+(?:decision|trade-?off)|by\s+design|expected\s+behavio(?:u)?r|out\s+of\s+scope|defer(?:red)?)\b|\b(?:do\s+not|don't|should\s+not|shouldn't|cannot|can't|won't|not)\s+keep(?:\s+(?:this|it))?\s+as[-\s]+is\b/gi

const INTENDED_BEHAVIOR_DEFERRAL_PATTERN =
  /\b(?:working\s+as\s+intended|intended\s+behavio(?:u)?r)\b/i

const NO_CHANGE_DEFERRAL_PATTERN =
  /\bno\s+changes?\s+(?:are\s+)?needed\b/i

const NON_BEHAVIOR_NO_CHANGE_PATTERN =
  /\bno\s+changes?\s+(?:are\s+)?needed\s+(?:to|for|in)\s+(?:the\s+)?(?:tests?|test\s+suite|docs?|documentation|comments?|formatting|snapshots?|fixtures?|mocks?|tooling|ci)\b/i

const NEGATED_INTENDED_BEHAVIOR_PATTERN =
  /\b(?:is\s+not|isn't|was\s+not|wasn't|not)\s+(?:working\s+as\s+intended|intended\s+behavio(?:u)?r)\b/gi

const REVIEWER_ACCEPTANCE_PATTERN =
  /(?:接受|同意)[^。！？!?\n]{0,32}(?:延期|取舍|范围(?:说明)?|另开|后续处理|单独处理)|(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)(?:修复|处理|解决)|不再阻塞|不阻塞|非阻塞|撤回(?:阻止|阻塞|反对|异议)|可以另开|单独处理|\b(?:accept(?:ed)?|agree(?:d)?)\b[^.。！？!?\n]{0,40}\b(?:deferral|trade-?off|scope|out\s+of\s+scope|follow-?up|separate\s+(?:concern|issue|pr))\b|\b(?:confirm(?:ed)?|verif(?:y|ied))\b[^.。！？!?\n]{0,32}\b(?:fixed|addressed|resolved)\b|\bmakes?\s+sense\b[^.。！？!?\n]{0,40}\b(?:scope|separate|follow-?up)\b|\b(?:not\s+a\s+blocker|non-?blocking|withdraw(?:n)?\s+(?:the\s+)?(?:blocker|objection|concern|request\s+for\s+changes)|separate\s+concern|keep\s+the\s+scope\s+tight)\b/i

const REVIEWER_FIXED_ACCEPTANCE_PATTERN =
  /(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)(?:修复|处理|解决)|\b(?:confirm(?:ed)?|verif(?:y|ied))\b[^.。！？!?\n]{0,32}\b(?:fixed|addressed|resolved)\b/i

const REVIEWER_DEFERRAL_ACCEPTANCE_PATTERN =
  /(?:接受|同意)[^。！？!?\n]{0,32}(?:延期|取舍|范围(?:说明)?|另开|后续处理|单独处理)|可以另开|单独处理|\b(?:accept(?:ed)?|agree(?:d)?)\b[^.。！？!?\n]{0,40}\b(?:deferral|trade-?off|scope|out\s+of\s+scope|follow-?up|separate\s+(?:concern|issue|pr))\b|\bmakes?\s+sense\b[^.。！？!?\n]{0,40}\b(?:scope|separate|follow-?up)\b|\b(?:separate\s+concern|keep\s+the\s+scope\s+tight)\b/i

const REVIEWER_REJECTION_PATTERN =
  /(?:不接受|不同意|不理解|撤回(?:同意|接受|批准)|不再(?:同意|接受)|(?:不能|无法|不可|尚未|未能)\s*(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)?(?:修复|处理|解决)|仍(?:然)?阻塞|还是阻塞|不能另开|不可另开|(?:不能|不可|不得)\s*单独处理|(?:不认为|不能认为|并非|不是)[^。！？!?\n]{0,24}(?:非阻塞|不阻塞)|(?:必须|需要|应该|应当)\s*在本\s*PR\s*(?:修复|处理|解决)|合并前(?:仍需|请|必须)?[^。！？!?\n]{0,24}(?:修复|处理|解决)|仍需修复)|\b(?:do\s+not|don't|cannot|can't|won't)\s+(?:accept|agree|withdraw|confirm|verify)\b|\b(?:have|has|had)\s+not\s+(?:confirmed|verified)\b|\b(?:do\s+not|don't|cannot|can't|won't)\s+(?:consider|regard|treat|view)\b[^.。！？!?\n]{0,48}\bnon-?blocking\b|\b(?:is|are)\s+not\s+non-?blocking\b|\b(?:have|has|had)\s+not\s+(?:accepted|agreed)\b|\bno\s+longer\s+(?:accept|agree)\b|\b(?:withdraw|retract)(?:ing|s|ed)?\s+(?:my|our|the|that)?\s*(?:acceptance|agreement|approval)\b|\b(?:is\s+not|isn't|not)\s+(?:a\s+)?separate\s+(?:concern|issue|pr)\b|\b(?:address|fix|resolve)\s+(?:it|this|the\s+(?:issue|finding))\s+in\s+this\s+(?:pr|pull\s+request)\b|\b(?:please\s+)?(?:address|fix|resolve)\s+(?:it|this|the\s+(?:issue|finding))\s+before\s+(?:merge|merging)\b|\b(?:still|remains?)\s+(?:a\s+)?blocker\b|\b(?:still\s+needs?\s+(?:work|to\s+be\s+fixed)|needs?\s+to\s+be\s+fixed|must\s+be\s+fixed)\b|\b(?:but|however)\b[^.。！？!?\n]{0,80}\b(?:still\s+needs?\s+to|needs?\s+to\s+be\s+fixed|must\s+be\s+fixed|before\s+merge|block(?:er|ing)?)\b/i

const NEGATED_REVIEWER_WITHDRAWAL_PATTERN =
  /\b(?:(?:have|has|had)\s+not|haven['’]t|hasn['’]t|hadn['’]t)\s+(?:withdrawn|retracted)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t)\s+(?:withdraw|retract)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:blocker|objection|concern|request\s+for\s+changes)\b[^.。！？!?\n]{0,40}\b(?:(?:has|had)\s+not|hasn['’]t|hadn['’]t)\s+been\s+(?:withdrawn|retracted)\b/i

const REVIEWER_ACCEPTANCE_UNCERTAINTY_PATTERN =
  /[?？]|(?:是否(?:可以)?|是不是|能否|可否|能不能|可不可以|要不要)[^。！？!?\n]{0,32}(?:接受|同意|另开|单独处理|不阻塞|非阻塞)|(?:吗|么|呢|吧)(?:$|[\s。！？!?，,；;])|\b(?:can|could|would|should|may|might|will|do|does|did)\s+(?!(?:not|never)\b)(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:accept|agree|consider|regard|treat)\b|\b(?:are|is)\s+(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:(?:accept|agree|consider|regard|treat)ing|(?:willing|able|ready|prepared)\s+to\s+(?:accept|agree|consider|regard|treat))\b|\bwhether\s+(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:accept|agree|consider|regard|treat)s?\b|\b(?:i|we)\s+(?:could|would|may|might)\s+(?:accept|agree|consider|regard|treat)\b|\b(?:maybe|perhaps|possibly)\b[^.。！？!?\n]{0,40}\b(?:accept|agree|consider|regard|treat)\b/i

const FINDING_FIXED_PATTERN =
  /(?:已|已经)(?:修复|处理|解决|改好)|(?:已|已经)?补(?:上|了)?(?:回归)?测试|\b(?:fixed|addressed|resolved|implemented)(?:\s+this|\s+it|\s+the\s+(?:issue|finding))?\b/i

const NEGATED_FINDING_FIXED_PATTERN =
  /(?:未|尚未|没有|并未|还没)(?:修复|处理|解决|改好|补(?:上|回归)?测试)|\b(?:not|isn't|is\s+not|wasn't|was\s+not|aren't|are\s+not|weren't|were\s+not|haven't|have\s+not|hasn't|has\s+not|hadn't|had\s+not|never)\s+(?:been\s+)?(?:fixed|addressed|resolved|implemented)\b/i

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

function authorDispositionKind(body) {
  if (isProductDeferral(body)) return 'deferral'
  if (isFindingFixRetraction(body)) return 'fix-retracted'
  if (isFindingFixedClaim(body)) return 'fixed'
  return null
}

function compactEditText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function editDistanceWithin(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return false
  const overflow = limit + 1
  let previous = new Map()
  for (let index = 0; index <= Math.min(right.length, limit); index++) {
    previous.set(index, index)
  }
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = new Map()
    const start = Math.max(0, leftIndex - limit)
    const end = Math.min(right.length, leftIndex + limit)
    let rowMinimum = overflow
    for (let rightIndex = start; rightIndex <= end; rightIndex++) {
      const value = rightIndex === 0
        ? leftIndex
        : Math.min(
          (previous.get(rightIndex) ?? overflow) + 1,
          (current.get(rightIndex - 1) ?? overflow) + 1,
          (previous.get(rightIndex - 1) ?? overflow)
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        )
      if (value <= limit) current.set(rightIndex, value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > limit) return false
    previous = current
  }
  return (previous.get(right.length) ?? overflow) <= limit
}

function isCosmeticEdit(left, right) {
  const compactLeft = compactEditText(left)
  const compactRight = compactEditText(right)
  if (compactLeft === compactRight) return true
  const limit = Math.min(6, Math.max(2, Math.floor(Math.max(compactLeft.length, compactRight.length) * 0.02)))
  return editDistanceWithin(compactLeft, compactRight, limit)
}

function patchEdit(value) {
  const lines = String(value || '').split('\n')
  const before = []
  const after = []
  let hasHunk = false
  for (const line of lines) {
    if (/^@@(?:\s|$)/.test(line)) hasHunk = true
    else if (/^-(?!---)/.test(line)) before.push(line.slice(1))
    else if (/^\+(?!\+\+)/.test(line)) after.push(line.slice(1))
  }
  if (!hasHunk && (before.length === 0 || after.length === 0)) return null
  return {
    type: 'patch',
    before: before.join('\n'),
    after: after.join('\n'),
    complete: before.length > 0 && after.length > 0,
  }
}

function editEntries(comment) {
  return (comment?.edits || []).map((edit) => {
    const body = edit?.body == null ? '' : String(edit.body)
    if (body) return { type: 'body', body }
    const diff = edit?.diff == null ? '' : String(edit.diff)
    if (!diff) return { type: 'empty' }
    return patchEdit(diff) || { type: 'body', body: diff }
  })
}

function editDispositionTexts(comment) {
  return editEntries(comment).flatMap((entry) => {
    if (entry.type === 'body') return [entry.body]
    if (entry.type === 'patch') return [entry.before, entry.after].filter(Boolean)
    return []
  })
}

function hasOpaqueDispositionEdit(comment) {
  if (commentTime(comment) <= dispositionTime(comment)) return false
  if (comment?.edits_complete === false) return true
  const entries = editEntries(comment)
  if (entries.length === 0) return true
  const currentKind = authorDispositionKind(comment.body)
  return entries.every((entry) => {
    if (entry.type === 'empty') return true
    if (entry.type === 'patch') {
      if (authorDispositionKind(entry.before) || authorDispositionKind(entry.after)) return false
      return !entry.complete && !currentKind
    }
    if (authorDispositionKind(entry.body)) return false
    return isLikelyPatchFragment(entry.body, comment.body, authorDispositionKind)
  })
}

function isLikelyPatchFragment(value, currentBody, dispositionKind) {
  if (dispositionKind(value)) return false
  const compactValue = compactEditText(value)
  const compactCurrent = compactEditText(currentBody)
  return compactValue.length < Math.max(8, Math.floor(compactCurrent.length * 0.5))
}

function hasSemanticDispositionEdit(comment, dispositionKind) {
  const createdAt = dispositionTime(comment)
  const updatedAt = commentTime(comment)
  if (!updatedAt || updatedAt <= createdAt) return false
  if (comment?.edits_complete === false) return true
  const currentBody = String(comment?.body || '')
  const currentKind = dispositionKind(currentBody)
  const entries = editEntries(comment)
  if (entries.length === 0) return true
  return entries.some((entry) => {
    if (entry.type === 'empty') return true
    if (entry.type === 'patch') {
      const beforeKind = dispositionKind(entry.before)
      const afterKind = dispositionKind(entry.after)
      if (beforeKind !== afterKind && (beforeKind || afterKind)) return true
      if (beforeKind && afterKind) return !isCosmeticEdit(entry.before, entry.after)
      return !entry.complete
    }
    const body = entry.body
    if (isLikelyPatchFragment(body, currentBody, dispositionKind)) {
      return compactEditText(body).length > 0
    }
    if (dispositionKind(body) !== currentKind) return true
    if (isCosmeticEdit(body, currentBody)) return false
    return compactEditText(body) !== compactEditText(currentBody)
  })
}

function reviewerAcceptanceEvidence(body) {
  return String(body || '')
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter((part) => (
      part
        && REVIEWER_ACCEPTANCE_PATTERN.test(part)
        && !REVIEWER_ACCEPTANCE_UNCERTAINTY_PATTERN.test(part)
        && !REVIEWER_REJECTION_PATTERN.test(part)
        && !NEGATED_REVIEWER_WITHDRAWAL_PATTERN.test(part)
    ))
    .join(' ')
}

function isExplicitReviewerAcceptance(body) {
  return Boolean(reviewerAcceptanceEvidence(body))
}

function reviewerAcceptanceKind(body) {
  const value = reviewerAcceptanceEvidence(body)
  if (!isExplicitReviewerAcceptance(value)) return null
  if (REVIEWER_DEFERRAL_ACCEPTANCE_PATTERN.test(value)) return 'deferral'
  if (REVIEWER_FIXED_ACCEPTANCE_PATTERN.test(value)) return 'fixed'
  return 'generic'
}

function isExplicitReviewerRejection(body) {
  const value = String(body || '')
  return REVIEWER_REJECTION_PATTERN.test(value)
    || NEGATED_REVIEWER_WITHDRAWAL_PATTERN.test(value)
}

function reviewerDispositionKind(body) {
  if (isExplicitReviewerRejection(body)) return 'reject'
  return reviewerAcceptanceKind(body) ? 'accept' : null
}

function reviewerDispositionTime(comment) {
  if (!hasSemanticDispositionEdit(comment, reviewerDispositionKind)) {
    return dispositionTime(comment)
  }
  if (reviewerDispositionKind(comment.body) === 'reject') return commentTime(comment)
  const currentAcceptance = reviewerAcceptanceKind(comment.body)
  const provesFreshAcceptance = comment?.edits_complete !== false
    && editEntries(comment).some((entry) => {
      if (entry.type === 'empty') return false
      if (entry.type === 'patch') {
        return entry.complete
          && reviewerAcceptanceKind(entry.after) === currentAcceptance
          && reviewerAcceptanceKind(entry.before) !== currentAcceptance
      }
      return reviewerAcceptanceKind(entry.body) !== currentAcceptance
    })
  return provesFreshAcceptance ? commentTime(comment) : dispositionTime(comment)
}

function severityDispositionKind(body) {
  const value = String(body || '')
  return SEVERITY_CHANGE_PATTERN.test(value)
    ? destinationSeverityOf(value)
    : severityOf(value)
}

function severityDispositionTime(comment) {
  const createdAt = dispositionTime(comment)
  const updatedAt = commentTime(comment)
  if (!updatedAt || updatedAt <= createdAt) return createdAt

  const currentSeverity = severityDispositionKind(comment.body)
  const entries = editEntries(comment)
  const severityChanged = entries.some((entry) => {
    if (entry.type === 'empty') return false
    if (entry.type === 'patch') {
      const beforeSeverity = severityDispositionKind(entry.before)
      const afterSeverity = severityDispositionKind(entry.after)
      return beforeSeverity !== afterSeverity && Boolean(beforeSeverity || afterSeverity)
    }
    if (isLikelyPatchFragment(entry.body, comment.body, severityDispositionKind)) return false
    return severityDispositionKind(entry.body) !== currentSeverity
  })
  if (severityChanged) return updatedAt

  // If GitHub did not return a complete edit history, only move a high-risk
  // severity forward. Moving a low-risk P2/P3 forward could hide a later P0/P1.
  const hasOpaqueSeverityEdit = entries.length === 0
    || entries.every((entry) => entry.type === 'empty'
      || (entry.type === 'patch' && !entry.complete))
  if (comment?.edits_complete === false || hasOpaqueSeverityEdit) {
    return isHighSeverity(currentSeverity) ? updatedAt : createdAt
  }
  return createdAt
}

function authorDispositionEvents(comment, index) {
  const currentKind = authorDispositionKind(comment.body)
  const historicalDeferral = editDispositionTexts(comment).some((body) => isProductDeferral(body))
    || hasOpaqueDispositionEdit(comment)
  const semanticEdit = hasSemanticDispositionEdit(comment, authorDispositionKind)
  const at = semanticEdit ? commentTime(comment) : dispositionTime(comment)

  if (currentKind === 'deferral') {
    return [{ kind: 'deferral', index, at, strictAfter: semanticEdit, semanticEdit }]
  }
  if (!historicalDeferral) {
    return currentKind
      ? [{ kind: currentKind, index, at, strictAfter: semanticEdit, semanticEdit }]
      : []
  }

  const deferralAt = currentKind ? dispositionTime(comment) : at
  return [
    {
      kind: 'deferral', index, at: deferralAt,
      strictAfter: !currentKind && semanticEdit,
      semanticEdit: !currentKind && semanticEdit,
    },
    ...(currentKind
      ? [{ kind: currentKind, index, at, strictAfter: semanticEdit, semanticEdit }]
      : []),
  ]
}

function isProductDeferral(body) {
  const value = String(body || '')
    .replace(NEGATED_PRODUCT_DEFERRAL_PATTERN, ' ')
    .replace(NEGATED_INTENDED_BEHAVIOR_PATTERN, ' ')
  return PRODUCT_DEFERRAL_PATTERN.test(value)
    || INTENDED_BEHAVIOR_DEFERRAL_PATTERN.test(value)
    || (NO_CHANGE_DEFERRAL_PATTERN.test(value)
      && !NON_BEHAVIOR_NO_CHANGE_PATTERN.test(value))
}

function isFindingFixedClaim(body) {
  const value = String(body || '')
  return !NEGATED_FINDING_FIXED_PATTERN.test(value) && FINDING_FIXED_PATTERN.test(value)
}

function isFindingFixRetraction(body) {
  return NEGATED_FINDING_FIXED_PATTERN.test(String(body || ''))
}

function severityOf(body) {
  const match = String(body || '').match(SEVERITY_PATTERN)
  const level = match?.slice(1).find(Boolean)
  return level ? `P${level}` : null
}

function destinationSeverityOf(body) {
  const value = String(body || '')
  const target = value.match(
    /(?:\b(?:to|into|as)\s+P([0123])\b|\bP[0123]\s*(?:-|=)?\>\s*P([0123])\b|(?:改为|调整为|定为|升级为|降级为|提高到|降低到|变为|至|到)\s*P([0123])\b)/i,
  )
  const targetLevel = target?.slice(1).find(Boolean)
  if (targetLevel) return `P${targetLevel}`

  const levels = [...value.matchAll(new RegExp(SEVERITY_PATTERN.source, 'ig'))]
    .map((match) => match.slice(1).find(Boolean))
    .filter(Boolean)
  const last = levels.at(-1)
  return last ? `P${last}` : null
}

function severityDispositionOf(body, initial = false) {
  const value = String(body || '')
  const severity = initial ? severityOf(value) : destinationSeverityOf(value)
  if (!severity) return null
  if (initial || SEVERITY_CHANGE_PATTERN.test(value)) return severity
  return null
}

function isHighSeverity(severity) {
  return severity === 'P0' || severity === 'P1'
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
      review_id: comment.pullRequestReview?.databaseId || null,
      edits: (comment.userContentEdits?.nodes || []).map((edit) => ({
        edited_at: edit.editedAt,
        diff: edit.diff || '',
      })),
      edits_complete: comment.userContentEdits?.pageInfo?.hasNextPage !== true,
    })),
  }
}

function latestDisposition(dispositions) {
  const latestAt = Math.max(...dispositions.map((item) => item.at))
  const candidates = dispositions.filter((item) => item.at === latestAt)
  if (candidates.length === 1) return candidates[0].disposition

  // A semantic edit and another event sharing GitHub's second-level timestamp
  // have no provable cross-event order. Preserve an explicit rejection.
  if (candidates.some((item) => item.semanticEdit)
    && candidates.some((item) => item.disposition === 'reject')) return 'reject'

  const reviewOrders = candidates.map((item) => item.reviewOrder)
  if (reviewOrders.every(Number.isSafeInteger) && reviewOrders.every((order) => order >= 0)) {
    const latestReviewOrder = Math.max(...reviewOrders)
    const latestReview = candidates.filter((item) => item.reviewOrder === latestReviewOrder)
    if (latestReview.length === 1) return latestReview[0].disposition
    if (latestReview.every((item) => item.source === 'thread')) {
      return latestReview.sort((left, right) => left.index - right.index).at(-1).disposition
    }
    return latestReview.some((item) => item.disposition === 'reject') ? 'reject' : 'accept'
  }

  if (candidates.every((item) => item.source === candidates[0].source)) {
    return candidates.sort((left, right) => left.index - right.index).at(-1).disposition
  }
  return candidates.some((item) => item.disposition === 'reject') ? 'reject' : 'accept'
}

function latestAuthorDisposition(events) {
  const latestAt = Math.max(...events.map((event) => event.at))
  const candidates = events.filter((event) => event.at === latestAt)
  if (candidates.length === 1) return candidates[0]

  // GitHub timestamps have second-level precision. If any tied event is a
  // semantic edit, array position cannot prove whether a fixed claim followed
  // the edited deferral. Preserve the non-fix disposition fail-closed.
  if (candidates.some((event) => event.semanticEdit)) {
    const conservative = candidates.filter((event) => event.kind !== 'fixed')
    if (conservative.length > 0) {
      return conservative.sort((left, right) => left.index - right.index).at(-1)
    }
  }
  return candidates.sort((left, right) => left.index - right.index).at(-1)
}

function threadEventFollows({ at, index, semanticEdit = false }, boundaryAt, boundaryIndex, boundaryIsEdit = false) {
  if (at > boundaryAt) return true
  if (at < boundaryAt) return false
  if (semanticEdit || boundaryIsEdit) return false
  return index > boundaryIndex
}

function latestReviewerDisposition({
  thread,
  reviewerLogin,
  afterIndex,
  highFindingAt,
  highFindingIndex,
  highFindingIsEdit,
  evidenceAt,
  evidenceStrictAfter,
  evidenceKind,
  reviews,
  headOid,
}) {
  const evidenceCreatedAt = dispositionTime(thread.comments[afterIndex]) || Number.MAX_SAFE_INTEGER
  const originalBoundary = Math.max(evidenceCreatedAt, highFindingAt || 0)
  const effectiveBoundary = Math.max(evidenceAt || evidenceCreatedAt, highFindingAt || 0)
  const dispositions = []
  const reviewOrderById = new Map(reviews.map((review, index) => [String(review.id || ''), index]))

  for (const [index, comment] of thread.comments.entries()) {
    if (String(comment.login || '').toLowerCase() !== reviewerLogin) continue
    const semanticEdit = hasSemanticDispositionEdit(comment, reviewerDispositionKind)
    const at = reviewerDispositionTime(comment)
    if (isExplicitReviewerRejection(comment.body)) {
      if (at >= originalBoundary) {
        dispositions.push({
          disposition: 'reject', at,
          source: 'thread',
          reviewOrder: reviewOrderById.get(String(comment.review_id || '')),
          index,
          semanticEdit,
        })
      }
    } else {
      const acceptanceKind = reviewerAcceptanceKind(comment.body)
      const acceptsCurrentEvidence = acceptanceKind
        && !(acceptanceKind === 'fixed' && evidenceKind !== 'fixed')
      if (acceptsCurrentEvidence
        && threadEventFollows(
          { at, index, semanticEdit },
          evidenceAt || evidenceCreatedAt,
          afterIndex,
          evidenceStrictAfter,
        )
        && threadEventFollows(
          { at, index, semanticEdit },
          highFindingAt || 0,
          highFindingIndex,
          highFindingIsEdit,
        )) {
        dispositions.push({
          disposition: 'accept', at,
          source: 'thread',
          reviewOrder: reviewOrderById.get(String(comment.review_id || '')),
          index,
          semanticEdit,
        })
      }
    }
  }

  for (const [index, review] of reviews.entries()) {
    if (String(review.login || '').toLowerCase() !== reviewerLogin
      || !sameHead(review.commit_id, headOid)) continue
    const at = eventTime(review.submitted_at)
    const state = String(review.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED' && at >= originalBoundary) {
      dispositions.push({
        disposition: 'reject', at,
        source: 'review', reviewOrder: index,
        index,
      })
    } else if (state === 'APPROVED' && at > effectiveBoundary) {
      dispositions.push({
        disposition: 'accept', at,
        source: 'review', reviewOrder: index,
        index,
      })
    }
  }

  if (dispositions.length === 0) return null
  return latestDisposition(dispositions)
}

function ownerDecisionEvidence({ authorLogin, headOid, after, reviews, comments }) {
  const author = String(authorLogin || '').toLowerCase()
  if (isMergeOwner(author)) return `owner-author:${author}`

  const review = reviews.find((item) => (
    isMergeOwner(item.login)
      && String(item.state || '').toUpperCase() === 'APPROVED'
      && sameHead(item.commit_id, headOid)
      && eventTime(item.submitted_at) > after
  ))
  if (review) return `owner-review:${review.login}`

  const marker = ownerApprovalMarker(headOid)
  const comment = comments.find((item) => (
    isMergeOwner(item.login)
      && String(item.body || '').toLowerCase().includes(marker)
      && eventTime(item.updated_at || item.created_at) > after
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
    if (!thread.is_resolved) continue
    const reviewerComments = thread.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment }) => String(comment.login || '').toLowerCase() !== author)
    const findingOrigin = { comment: thread.comments[0], index: 0 }
    if (!findingOrigin.comment
      || String(findingOrigin.comment.login || '').toLowerCase() === author) continue
    const finding = findingOrigin.comment
    const reviewerLogin = String(finding.login || '').toLowerCase()
    const findingEvents = []
    for (const { comment, index } of reviewerComments) {
      if (String(comment.login || '').toLowerCase() !== reviewerLogin) continue
      const severity = severityDispositionOf(comment.body, findingEvents.length === 0)
      if (!severity) continue
      const at = severityDispositionTime(comment)
      findingEvents.push({
        comment,
        index,
        severity,
        at,
        semanticEdit: at > dispositionTime(comment),
      })
    }
    if (findingEvents.length === 0) continue
    const latestFindingAt = Math.max(...findingEvents.map((event) => event.at))
    const latestFindingCandidates = findingEvents.filter((event) => event.at === latestFindingAt)
    const latestFinding = latestFindingCandidates.sort((left, right) => {
      const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
      return severityRank[left.severity] - severityRank[right.severity]
        || right.index - left.index
    })[0]
    if (!latestFinding || !isHighSeverity(latestFinding.severity)) continue

    // Severity follows the latest explicit marker. Preserve author disposition
    // history across both P2 -> P1 escalation and P1 -> P2 downgrade.
    const findingStartIndex = findingOrigin.index
    const severity = latestFinding.severity
    const highFindingAt = latestFinding.at
    const authorEvents = thread.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment, index }) => (
        index > findingStartIndex
          && String(comment.login || '').toLowerCase() === author
      ))
      .flatMap(({ comment, index }) => authorDispositionEvents(comment, index))
      .sort((left, right) => left.at - right.at || left.index - right.index)

    const latestDeferral = authorEvents.filter((event) => event.kind === 'deferral').at(-1)
    if (!latestDeferral) continue
    const deferralIndex = latestDeferral.index
    const evidenceEvent = latestAuthorDisposition(authorEvents)
    const reviewerDisposition = latestReviewerDisposition({
      thread,
      reviewerLogin,
      afterIndex: evidenceEvent.index,
      highFindingAt,
      highFindingIndex: latestFinding.index,
      highFindingIsEdit: latestFinding.semanticEdit,
      evidenceAt: evidenceEvent.at,
      evidenceStrictAfter: evidenceEvent.strictAfter,
      evidenceKind: evidenceEvent.kind,
      reviews,
      headOid,
    })
    if (reviewerDisposition === 'accept') continue
    blockers.push({
      severity,
      reviewer: finding.login || 'unknown',
      at: Math.max(
        evidenceEvent.at || commentTime(thread.comments[deferralIndex]) || Number.MAX_SAFE_INTEGER,
        highFindingAt,
      ),
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
