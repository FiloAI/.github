const REVIEW_PERMISSIONS = new Set(['admin', 'maintain', 'write'])
const OWNER_VETO_LOGINS = new Set(['zqchris', 'xd-bobo'])

const BLOCK_PATTERNS = [
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)[^。！？!\n]{0,24}(?:合并|merge)/i,
  /(?:不同意|不确认|不允许|不批准|未批准)[^。！？!\n]{0,16}(?:合并|merge)/i,
  /(?:合并|merge)[^。！？!\n]{0,16}(?:阻断|阻塞|拦截|block)/i,
  /(?:功能|发布|合并)[^。！？!\n]{0,12}(?:阻断|阻塞)/i,
  /\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b|\bnot\s+ready\s+to\s+merge\b|\bnot\s+approved?\b|\b(?:merge|release|functionality)\s+blocker\b/i,
]

const EXPLICIT_VETO_PATTERN =
  /(?:当前|现在|暂时)?(?:不宜|不应|不能|不可|不要|先别|暂不|禁止)(?:(?!阻塞|阻断|卡住|拦截)[^。！？!\n]){0,24}(?:合并|merge)|\b(?:do\s+not|don't|cannot|can't|should\s+not|must\s+not)\s+merge\b|\bnot\s+ready\s+to\s+merge\b/i

const ACTIVE_MERGE_VETO_PATTERN =
  /\b(?:(?:i(?:['’]m|\s+am)|we(?:['’]re|\s+are))\s+)?block(?:ing)?\s+(?:this\s+|the\s+)?merge\b|\b(?:(?:i|we)\s+)?veto(?:ed|ing)?\s+(?:this\s+|the\s+)?merge\b/i

const APPROVAL_PATTERN =
  /(?:同意|确认|允许)(?:这个|该)?(?:\s*pr)?(?:可以)?(?:直接)?合并|可以(?:直接)?合并|(?:代码)?(?:审查|审核)(?:已经|已)?通过(?:了)?|\b(?:lgtm|approved?|ok(?:ay)?\s+to\s+merge|please\s+merge|merge\s+it|go\s+ahead|ship\s+it)\b/i

const APPROVAL_NEGATION_PATTERN =
  /(?:尚未|还没|没有|不能|无法|不会|不)(?:批准|确认)[^。！？!\n]{0,16}(?:合并|merge)?|\b(?:(?:i|we)\s+)?(?:(?:have|has|had)\s+not|haven['’]t|hasn['’]t|hadn['’]t)\s+approved?\b|\b(?:(?:i|we)\s+)?(?:cannot|can['’]t|could\s+not|couldn['’]t|will\s+not|won['’]t|do\s+not|don['’]t)\s+approve\b/i

const THIRD_PARTY_APPROVAL_NEGATION_PATTERN =
  /(?:^|[，,；;]\s*|\b(?:but|however|while)\s+)(?!(?:i|we|my|our)\b)(?:@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})\s+(?:(?:has|had)\s+not|hasn['’]t|hadn['’]t|cannot|can['’]t|could\s+not|couldn['’]t|will\s+not|won['’]t|does\s+not|doesn['’]t)\s+approve(?:d)?\b|(?:^|[，,；;]\s*)(?:(?:他|她|他们|她们|对方|第三方)|@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})[^。！？!?，,；;\n]{0,12}(?:尚未|还没|没有|不能|无法|不会|不)(?:批准|确认)/iu

const FIRST_PERSON_APPROVAL_PATTERN =
  /\b(?:i|we)\s+(?:(?:have|had)\s+)?(?:(?:now|hereby|explicitly|personally|fully)\s+)*approve(?:d)?\b|(?:我|我们)(?:已|已经|现已|明确|正式|现在)?(?:同意|确认|允许)[^。！？!?\n]{0,16}(?:合并|merge)/i

const QUOTED_APPROVAL_PATTERN =
  /[“"‘'][^”"’'\n]{0,120}(?:\blgtm\b|\bapproved?\b|(?:同意|确认|允许)[^”"’'\n]{0,16}(?:合并|merge))[^”"’'\n]{0,120}[”"’']/i

const REPORTED_APPROVAL_PATTERN =
  /\b(?:according\s+to|per)\b[^.。！？!?\n]{0,80}\b(?:lgtm|approved?)\b|\b(?:says?|said|reports?|reported|wrote|writes)\b[^.。！？!?\n]{0,80}\b(?:lgtm|approved?)\b|(?:据|按照|根据)[^。！？!?\n]{0,32}(?:说|表示|回复|评论)[^。！？!?\n]{0,48}(?:lgtm|approved?|同意|确认|允许)/i

const DIRECT_THIRD_PARTY_RELEASE_PATTERN =
  /(?:^|[。！？!?；;，,]\s*)(?!(?:i|we)\b)(?:@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})\s*(?::|：|\b(?:gave|gives|left|posted|provided)\b)\s*(?:an?\s+)?(?:lgtm|approved?|approval|ok(?:ay)?\s+to\s+merge|go\s+ahead|ship\s+it)\b/i

const BARE_ACTOR_RELEASE_PATTERN =
  /(?:^|[。！？!?；;，,]\s*)(?!(?:I|We|i|we|my|our|but|however|yet|and|so|then|strongly|definitely|personally|fully|clearly|overall)\b)(?:@[A-Za-z0-9_.-]+|[A-Za-z][A-Za-z0-9_.-]*(?:\s+[A-Z][A-Za-z0-9_.-]*){0,3})\s+[Ll][Gg][Tt][Mm]\b/u

const ATTRIBUTED_APPROVAL_SOURCE_PATTERN =
  /(?:^|[。！？!?；;，,]\s*)(?!(?:i|we|my|our)\b)(?:@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})['’]s\s+(?:lgtm|approval|ok(?:ay)?\s+to\s+merge)\b|\b(?:lgtm|approval|approved?)\b[^.。！？!?\n]{0,20}\b(?:from|by)\s+(?!(?:me|us)\b)(?:@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})\b/i

const THIRD_PARTY_APPROVAL_PATTERN =
  /\b(?:@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,3})\s+(?:has\s+|had\s+)?approved?\b|(?:(?:他|她|他们|她们|对方|第三方)|[\p{L}\p{N}_@.-]{2,}(?:\s+[\p{L}\p{N}_@.-]{2,}){0,3})[^。！？!?\n]{0,20}(?:同意|确认|允许)[^。！？!?\n]{0,16}(?:合并|merge)/iu

const CLAUSE_UNCERTAINTY =
  /[?？]|(?:吗|么|呢|吧)(?:$|[\s。！？!?，,；;])/i

const BLOCKER_UNCERTAINTY =
  /\b(?:may|might|could)\s+be\s+(?:an?\s+)?(?:merge|release|functionality)\s+blocker\b|\b(?:is|are)\s+(?:possibly|potentially)\s+(?:an?\s+)?(?:merge|release|functionality)\s+blocker\b|\b(?:investigat(?:e|es|ed|ing)|check(?:ing)?|assess(?:ing)?|determin(?:e|ing)|not\s+sure|unclear)\b[^.。！？!?\n]{0,64}\b(?:merge|release|functionality)\s+blocker\b|(?:可能|也许|或许|疑似|尚不确定|不确定|正在(?:调查|排查|确认|评估))[^。！？!?\n]{0,40}(?:合并|发布|功能)(?:阻断|阻塞)/i

const PENDING_CONDITION =
  /(?:不同意|不确认|不允许|不批准|未批准|未签字|没有签字|尚未签字|仍然?|还(?:需|要)|需要|必须|先(?:修|处理|解决)|待(?:修|处理|解决)|才能|之后再|之前不|前不|(?:应|应该|应当)[^。！？!?；;\n]{0,24}(?:签字|确认|批准)|(?:如果|若)[^。！？!?；;\n]{0,80}(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿)|(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿)后|(?:仍|还|尚)(?:然)?(?:未|没)(?:修复|解决|完成|通过|验证|批准|签字|就绪)|(?:验证|审查|检查|迁移|发布)[^。！？!?；;\n]{0,24}(?:仍|还|尚)?(?:未|没)(?:修复|解决|完成|通过))|\b(?:not\s+approved?|not\s+signed\s+off|has(?:n't|\s+not)\s+signed\s+off|do\s+not\s+approve|don't\s+approve|need(?:s|ed)?\s+to|must|before)\b|\b(?:should|ought\s+to)\s+(?:still\s+)?(?:sign\s*off|approve)\b|\b(?:is|are|remain(?:s)?)\s+(?:still\s+)?(?:broken|unfinished|incomplete|failing|unsafe|outstanding|not\s+(?:fixed|resolved|complete|completed|validated|approved|ready))\b|\bstill\s+(?:a\s+)?(?:merge\s+|release\s+|functionality\s+)?blocker\b|\b(?:after|when|once|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending)\b[^.。！？!?；;\n]{0,100}\b(?:fix(?:ed)?|pass(?:ed)?|complete(?:d)?|resolve(?:d)?|sign(?:s|ed|ing)?\s*off|approve(?:d)?|succeed(?:s|ed|ing)?|green|ready|safe|healthy|done)\b/i

const STANDALONE_APPROVAL_CONDITION =
  /^(?:after|when|once|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending)\b[^.。！？!?；;\n]{0,100}\b(?:fix(?:ed)?|pass(?:ed)?|complete(?:d)?|resolve(?:d)?|sign(?:s|ed|ing)?\s*off|approve(?:d)?|succeed(?:s|ed|ing)?|green|ready|safe|healthy|done)\b|\bbefore\s+(?:merge|merging)\b|^(?:如果|若|待|等到|需要先|必须先|先)[^。！？!?；;\n]{0,80}(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿)|(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿)后|\b(?:must|needs?\s+to|has\s+to)\b[^。！？!?；;\n]{0,80}\b(?:fix(?:ed)?|pass(?:ed)?|complete(?:d)?|resolve(?:d)?|sign(?:s|ed|ing)?\s*off|approve(?:d)?|succeed(?:s|ed|ing)?|green|ready|done|before\s+(?:merge|merging))\b/i

const BARE_APPROVAL_CONDITION =
  /\b(?:pending|subject\s+to|awaiting)\b|(?:等待|有待|待|须经|需经)[^。！？!?；;\n]{0,24}(?:(?:安全|隐私|法务|发布|生产|迁移|维护者|owner|人工)[^。！？!?；;\n]{0,8})?(?:审查|审核|批准|确认|验证|签字|检查)/iu

const APPROVAL_CLAUSE_QUALIFIER =
  /\b(?:once|after|when|before|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending|awaiting)\b|\b(?:but\s+)?(?:please\s+)?(?:wait\s+(?:for|until)|hold(?:\s+off)?\s+(?:for|until))\b|(?:一旦|等到|等待|如果|若|除非|直到|只要)|(?:在)?[^。！？!?；;，,\n]{1,40}(?:之后|以前|之前)/iu

const CROSS_PR_PREREQUISITE =
  /^(?:after|when|once|if|unless|until|provided(?:\s+that)?|providing(?:\s+that)?|assuming(?:\s+that)?|subject\s+to|pending)\b|\bbefore\s+(?:this\s+)?(?:merge|merging)\b|\bbefore\s+(?:this\s+one|ours)\b|\bbefore\s+(?:(?:we|i|you|they|maintainers?|the\s+team)\s+(?:can\s+|may\s+|should\s+|will\s+)?merge\b|(?:we|i|you|they)\s+merge\b|(?:this|the\s+current)\s+(?:pr|pull\s+request)\s+(?:can\s+|may\s+|should\s+|will\s+)?(?:merge|be\s+merged)\b)|\b(?:fixed|resolved|completed|approved|green|ready|done|merged)\s+first\b|^(?:如果|若|待|等到)[^。！？!?；;\n]{0,100}|(?:修复|处理|解决|通过|完成|签字|确认|批准|成功|变绿|合并)后|先[^。！？!?；;\n]{0,80}合并|(?:在)?(?:我们|我|维护者|团队)合并(?:本|当前)?(?:\s*PR)?前|(?:在)(?:本|当前|这个|我们的)(?:\s*PR|拉取请求)?\s*(?:合并)?\s*(?:之前|前)\s*(?:合并)?|才能(?:合并|merge)/i

const INDEPENDENT_FOLLOWUP_OFFER = [
  /^if\s+(?:useful|helpful|desired|wanted|needed)\s*,?\s*(?:i|we)\s+(?:can|could|will|would)\b[^,，。！？!?；;\n]{0,160}[.]?$/i,
  /^(?:i|we)\s+(?:can|could|will|would)\b[^,，。！？!?；;\n]{0,120}\b(?:in\s+(?:a\s+)?follow[- ]?up|later|after(?:ward)?s?)\b[^,，。！？!?；;\n]{0,40}\bif\s+(?:useful|helpful|desired|wanted|needed)[.]?$/i,
  /^(?:如果|如|若)(?:有)?(?:需要|必要|帮助|合适)[，,]?\s*(?:我|我们)(?:可以|会|能|愿意)[^,，。！？!?；;\n]{0,120}(?:后续|之后|另行|补充|跟进)[^,，。！？!?；;\n]{0,40}[。]?$/i,
]

const NON_BLOCKING_PATTERN =
  /(?:不能|不会|不应(?:该)?|不得|不要)[^。！？!，,；;\n]{0,16}(?:阻塞|阻断|阻止|卡住|拦截)[^。！？!，,；;\n]{0,8}(?:合并|merge)|(?:不能|不会|不应(?:该)?|不得|不要)[^。！？!，,；;\n]{0,16}(?:阻塞|阻断|阻止|卡住|拦截)[，,]\s*(?:这个|该)?\s*(?:合并|merge)[^。！？!，,；;\n]{0,16}(?:安全|可以|允许|没问题|safe|okay|ok)|(?:不|未)(?:是|属于|构成|算作)[^。！？!，,；;\n]{0,16}(?:合并)?(?:门禁|阻塞|阻断|blocker)|(?:没有|无)(?:任何)?[^。！？!，,；;\n]{0,8}(?:合并)?(?:阻断|阻塞|blockers?)|(?:不存在|未发现)[^。！？!，,；;\n]{0,20}(?:合并阻断|合并阻塞|merge\s+blockers?)|\b(?:this|that|it)\s+(?:(?:is|was)\s+not|isn['’]t|wasn['’]t)\s+(?:an?\s+)?(?:merge|release|functionality)\s+blocker\b|\b(?:this|that|it)\s+(?:(?:does|did)\s+not|doesn['’]t|didn['’]t)\s+constitute\s+(?:an?\s+)?(?:merge|release|functionality)\s+blocker\b|\bthere\s+(?:(?:is|are|was|were)\s+no|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:any\s+|an?\s+|known\s+)?(?:merge|release|functionality)\s+blockers?\b|\bno\s+(?:known\s+)?(?:merge|release|functionality)\s+blockers?\b|\bno\s+(?:merge|release|functionality)\s+blockers?\s+found\b|\b(?:(?:i(?:['’]m|\s+am)|we(?:['’]re|\s+are))\s+)?(?:not|no\s+longer)\s+blocking\s+(?:this\s+|the\s+)?merge\b|\b(?:stopped|ceased)\s+blocking\s+(?:this\s+|the\s+)?merge\b|\b(?:do\s+not|don['’]t|should\s+not|shouldn['’]t|must\s+not|mustn['’]t)\s+block\s+(?:this\s+|the\s+)?merge\b|\b(?:(?:i|we)\s+)?(?:do\s+not|don['’]t|no\s+longer)\s+veto\s+(?:this\s+|the\s+)?merge\b|\b(?:i(?:['’]m|\s+am)|we(?:['’]re|\s+are))\s+not\s+vetoing\s+(?:this\s+|the\s+)?merge\b|\bwe\s+aren['’]t\s+vetoing\s+(?:this\s+|the\s+)?merge\b/i

const NEGATED_MERGE_SAFETY_PATTERN =
  /(?:这个|该)?\s*(?:合并|merge)[^。！？!?\n]{0,16}(?:(?<!不是)(?<!并非)不(?:太|够)?(?:安全|可以|允许|行|合适)|无法(?:继续|合并)|有风险)|\b(?:this\s+|the\s+)?merge\b[^.。！？!?\n]{0,24}\b(?:is|remains?|looks?)\s+(?:not\s+(?:safe|okay|ok|allowed|ready)|(?<!not\s)unsafe)\b|\b(?:cannot|can['’]t|should\s+not|shouldn['’]t|must\s+not|mustn['’]t)\s+(?:proceed|merge)\b/i

const RESOLVED_BLOCKER_PATTERN =
  /\b(?:merge|release|functionality)\s+blocker\b[^.。！？!?\n]{0,32}\b(?:is|was|has\s+been|had\s+been)\s+(?:already\s+|now\s+)?(?:fixed|resolved|cleared|removed)\b|\b(?:fixed|resolved|cleared|removed)\b[^.。！？!?\n]{0,32}\b(?:the\s+)?(?:merge|release|functionality)\s+blocker\b|(?:合并|发布|功能)(?:阻断|阻塞)[^。！？!?\n]{0,24}(?:已|已经|现已)(?:修复|解决|解除|清除)|(?:已|已经|现已)(?:修复|解决|解除|清除)[^。！？!?\n]{0,24}(?:合并|发布|功能)(?:阻断|阻塞)/i

const REACTIVATED_BLOCKER_PATTERN =
  /\b(?:merge|release|functionality)\s+blocker\b[^.。！？!?\n]{0,32}\b(?:is|was|has\s+been|had\s+been)\s+(?:already\s+|now\s+)?(?:fixed|resolved|cleared|removed)\b[^.。！？!?\n]{0,40}\b(?:back|returned|recurred|active\s+again|blocking\s+again)\b|(?:合并|发布|功能)(?:阻断|阻塞)[^。！？!?\n]{0,24}(?:已|已经|现已)(?:修复|解决|解除|清除)[^。！？!?\n]{0,40}(?:又|再次|重新)(?:出现|发生|阻断|阻塞|恢复|回来)/i

const NEGATED_REACTIVATION_PATTERN =
  /\b(?:not|no\s+longer)\s+(?:back|returned|active\s+again|blocking\s+again)\b|(?:没有|未|并未|不再)(?:又|再次|重新)?(?:出现|发生|阻断|阻塞|恢复|回来)/i

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

function referencesCurrentPr(text, prNumber) {
  const value = String(text || '')
  if (/\b(?:this|current)\s+(?:pull\s+request|pr)\b|(?:本|当前)(?:\s*PR|拉取请求)/i.test(value)) {
    return true
  }
  if (!Number.isInteger(prNumber)) return false
  const references = [...value.matchAll(/\b(?:pull\s+request|pr)\s*#?(\d+)\b/gi)]
  return references.some((match) => Number(match[1]) === prNumber)
}

function referencesDifferentPr(text, prNumber) {
  const value = String(text || '')
  if (referencesCurrentPr(value, prNumber)) return false
  if (/\b(?:another|other)\s+(?:pull\s+request|pr)\b|(?:另一个|其它|其他)(?:\s*PR|拉取请求)/i.test(value)) {
    return true
  }
  if (!Number.isInteger(prNumber)) return false
  const references = [...value.matchAll(/\b(?:pull\s+request|pr)\s*#?(\d+)\b/gi)]
  return references.some((match) => Number(match[1]) !== prNumber)
}

function isIndependentFollowupOffer(text) {
  const value = String(text || '').trim().replace(/[，,；;:.：。]+$/, '').trim()
  return INDEPENDENT_FOLLOWUP_OFFER.some((pattern) => pattern.test(value))
}

function isPendingReleaseCondition(text, prNumber) {
  const value = String(text || '')
  if (isIndependentFollowupOffer(value)) return false
  if (!PENDING_CONDITION.test(value)
    && !STANDALONE_APPROVAL_CONDITION.test(value)
    && !BARE_APPROVAL_CONDITION.test(value)) {
    return false
  }
  if (!referencesDifferentPr(value, prNumber)) return true

  // A different PR can be either incidental context ("For PR #123...") or
  // an explicit prerequisite for releasing this PR ("After PR #123...").
  // Only the latter must keep the existing blocker fail-closed.
  return CROSS_PR_PREREQUISITE.test(value)
}

function hasBareApprovalQualifier(text) {
  const value = String(text || '')
  const approval = value.match(APPROVAL_PATTERN)
  if (!approval) return false
  const fragments = [
    value.slice(0, approval.index),
    value.slice((approval.index || 0) + approval[0].length)
      .replace(/^\s*[0-9a-f]{7,40}\b/i, '')
      .replace(/^[\s，,.:：；;-]+/, ''),
  ]
    .map((fragment) => fragment.trim())
    .filter(Boolean)
  return fragments.some((fragment) => (
    !isIndependentFollowupOffer(fragment)
      && APPROVAL_CLAUSE_QUALIFIER.test(fragment)
  ))
}

function isAttributedOrQuotedApproval(text) {
  const value = String(text || '')
  if (QUOTED_APPROVAL_PATTERN.test(value)
    || REPORTED_APPROVAL_PATTERN.test(value)
    || DIRECT_THIRD_PARTY_RELEASE_PATTERN.test(value)
    || BARE_ACTOR_RELEASE_PATTERN.test(value)
    || ATTRIBUTED_APPROVAL_SOURCE_PATTERN.test(value)) return true
  if (FIRST_PERSON_APPROVAL_PATTERN.test(value)) return false
  return THIRD_PARTY_APPROVAL_PATTERN.test(value)
}

function removePatternMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return String(text || '').replace(new RegExp(pattern.source, flags), ' ')
}

function withoutNonBlockingSignals(text) {
  const source = String(text || '')
  const value = NEGATED_MERGE_SAFETY_PATTERN.test(source)
    ? source
    : removePatternMatches(source, NON_BLOCKING_PATTERN)
  if (REACTIVATED_BLOCKER_PATTERN.test(value)
    && !NEGATED_REACTIVATION_PATTERN.test(value)) return value
  return removePatternMatches(value, RESOLVED_BLOCKER_PATTERN)
}

function withoutSpeculativeBlockerSignals(text) {
  return removePatternMatches(text, BLOCKER_UNCERTAINTY)
}

function classifyTextIntent(body, headOid, prNumber) {
  if (STEWARD_MARKERS.some((marker) => String(body || '').includes(marker))) return null
  const clauses = clausesFrom(body)
  let sawBlock = false
  let sawRelease = false
  for (const [clauseIndex, clause] of clauses.entries()) {
    const commenterClause = removePatternMatches(clause, THIRD_PARTY_APPROVAL_NEGATION_PATTERN)
    const clauseUncertainty = CLAUSE_UNCERTAINTY.test(commenterClause)
    const pendingCondition = isPendingReleaseCondition(commenterClause, prNumber)
      || hasBareApprovalQualifier(commenterClause)
    const approvalNegation = APPROVAL_NEGATION_PATTERN.test(commenterClause)
      && (referencesHead(commenterClause, headOid) || /(?:合并|\bmerge\b)/i.test(commenterClause))

    const blockableClause = withoutNonBlockingSignals(
      withoutSpeculativeBlockerSignals(commenterClause),
    )
    const explicitVeto = approvalNegation
      || EXPLICIT_VETO_PATTERN.test(blockableClause)
      || ACTIVE_MERGE_VETO_PATTERN.test(blockableClause)
    const explicitBlock = explicitVeto
      || (!clauseUncertainty && BLOCK_PATTERNS.some((pattern) => pattern.test(blockableClause)))
    if (explicitBlock) {
      sawBlock = true
    }

    // A veto in the same clause always wins. Questions and conditional
    // approvals are not an explicit current-head release. A condition may
    // be separated by explanatory clauses, but a condition explicitly
    // scoped to another PR must not poison this PR's release.
    const relatedCondition = clauses.some((candidate, candidateIndex) => (
      candidateIndex !== clauseIndex
        && !CLAUSE_UNCERTAINTY.test(candidate)
        && isPendingReleaseCondition(
          removePatternMatches(candidate, THIRD_PARTY_APPROVAL_NEGATION_PATTERN),
          prNumber,
        )
    ))
    if (!explicitBlock
      && !clauseUncertainty
      && !pendingCondition
      && !relatedCondition
      && APPROVAL_PATTERN.test(commenterClause)
      && !isAttributedOrQuotedApproval(commenterClause)
      && referencesHead(commenterClause, headOid)) {
      sawRelease = true
    }
  }
  // One comment is one maintainer disposition. Contradictory text is not an
  // explicit release: a veto anywhere in that message keeps the gate closed.
  if (sawBlock) return 'block'
  return sawRelease ? 'release' : null
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
