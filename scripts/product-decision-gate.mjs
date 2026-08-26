// Structured-only product decision gate.
// Natural-language comments are intentionally ignored: they can explain a
// decision to humans, but they are never authorization evidence.

const FINDING_MARKER = 'filoai:finding'
const DISPOSITION_MARKER = 'filoai:product-disposition'
const OWNER_LOGINS = new Set(['zqchris', 'jerboy', 'gaoweiliuxd'])
const ACTIONS = new Set(['defer', 'accept-deferral', 'approve', 'withdraw'])
const SHA = '[0-9a-f]{40}'

const MARKER_TOKEN_PATTERN = /<!--[\s\S]*?-->/g
// Only an HTML-comment-shaped token is protocol input. Plain documentation,
// status text, or bot summaries that mention the marker name are ignored.
const MARKER_HINT_PATTERN = /<!--[\s\S]*?filoai:(?:finding|product-disposition)\b/i

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase()
}

function eventTime(event) {
  const value = Date.parse(event?.created_at || '')
  return Number.isFinite(value) ? value : 0
}

function isEditedEvent(event) {
  if (!event?.created_at || !event?.updated_at) return false
  return eventTime({ created_at: event.updated_at }) > eventTime(event)
}

function parseAttributes(raw, required, optional = []) {
  const attrs = {}
  const allowed = new Set([...required, ...optional])
  const pattern = /([a-z][a-z0-9-]*)=([^\s]+)(?:\s+|$)/gi
  let consumed = 0
  let match
  while ((match = pattern.exec(raw)) !== null) {
    consumed += match[0].length
    const key = match[1].toLowerCase()
    if (!allowed.has(key) || attrs[key] !== undefined) return { error: '重复或未知属性' }
    attrs[key] = match[2]
  }
  if (consumed !== raw.trim().length) return { error: '属性必须使用 key=value 且以空格分隔' }
  for (const key of required) {
    if (!attrs[key]) return { error: `缺少 ${key}` }
  }
  return { attrs }
}

function parseMarkerToken(token, event) {
  const match = token.match(/^<!--\s*(filoai:(finding|product-disposition))\s+([\s\S]*?)\s*-->$/i)
  if (!match) return null
  const type = match[2].toLowerCase()
  const attributes = type === 'finding'
    ? parseAttributes(match[3], ['id', 'severity', 'kind'])
    : parseAttributes(match[3], ['finding', 'action'], ['head'])
  if (attributes.error) return { type, valid: false, error: attributes.error, event }

  const attrs = attributes.attrs
  if (type === 'finding') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attrs.id)) {
      return { type, valid: false, error: 'id 不合法', event }
    }
    if (!/^P[0-3]$/.test(attrs.severity)) {
      return { type, valid: false, error: 'severity 必须是 P0/P1/P2/P3', event }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(attrs.kind)) {
      return { type, valid: false, error: 'kind 不合法', event }
    }
    return {
      type,
      valid: true,
      id: attrs.id,
      severity: attrs.severity,
      kind: attrs.kind,
      actor: normalizeLogin(event.login),
      created_at: event.created_at || null,
      event,
    }
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attrs.finding)) {
    return { type, valid: false, error: 'finding 不合法', event }
  }
  if (!ACTIONS.has(attrs.action)) {
    return { type, valid: false, error: `action 必须是 ${[...ACTIONS].join('/')}`, event }
  }
  const needsHead = attrs.action === 'approve' || attrs.action === 'withdraw'
  if (needsHead && !new RegExp(`^${SHA}$`, 'i').test(attrs.head || '')) {
    return { type, valid: false, error: `${attrs.action} 必须带完整 40 位 head SHA`, event }
  }
  if (!needsHead && attrs.head !== undefined) {
    return { type, valid: false, error: `${attrs.action} 不允许带 head`, event }
  }
  return {
    type,
    valid: true,
    findingId: attrs.finding,
    action: attrs.action,
    head: attrs.head?.toLowerCase() || null,
    actor: normalizeLogin(event.login),
    created_at: event.created_at || null,
    event,
  }
}

export function parseProductDecisionMarkers(events = []) {
  const markers = []
  for (const rawEvent of events) {
    const event = {
      login: rawEvent?.login || rawEvent?.user?.login || '',
      body: String(rawEvent?.body || ''),
      created_at: rawEvent?.created_at || rawEvent?.submitted_at || null,
      updated_at: rawEvent?.updated_at || null,
      source: rawEvent?.source || 'comment',
      id: rawEvent?.id ?? null,
      commit_id: rawEvent?.commit_id || null,
    }
    const tokens = event.body.match(MARKER_TOKEN_PATTERN) || []
    const relevant = tokens.filter((token) => MARKER_HINT_PATTERN.test(token))
    if (MARKER_HINT_PATTERN.test(event.body) && relevant.length === 0) {
      markers.push({ valid: false, type: 'unknown', error: 'marker 未闭合或格式无法解析', event })
      continue
    }
    if (relevant.length > 0 && isEditedEvent(event)) {
      markers.push({
        valid: false,
        type: 'unknown',
        error: '包含 marker 的评论已编辑；请新建评论发布 marker，不能用编辑旧评论制造授权事件',
        event,
      })
      continue
    }
    for (const token of relevant) {
      const marker = parseMarkerToken(token, event)
      markers.push(marker || {
        valid: false,
        type: 'unknown',
        error: 'marker token 包含协议提示但整体格式无法解析',
        event,
      })
    }
  }
  return markers.filter(Boolean)
}

function sameHead(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase()
}

function markerDescription(marker) {
  return `filoai:${marker.type === 'finding' ? 'finding' : 'product-disposition'} marker`
}

function blocked(reason, extra = {}) {
  return { satisfied: false, reason: `产品取舍门禁阻塞：${reason}`, ...extra }
}

export function evaluateProductDecisionGate({
  headOid,
  authorLogin,
  events = [],
  ownerLogins = OWNER_LOGINS,
}) {
  const head = String(headOid || '').toLowerCase()
  if (!new RegExp(`^${SHA}$`, 'i').test(head)) {
    return blocked('当前 head 不是完整 SHA，无法验证结构化授权（fail-closed）')
  }
  const author = normalizeLogin(authorLogin)
  const owners = new Set([...ownerLogins].map(normalizeLogin))
  const authorIsOwner = owners.has(author)
  const markers = parseProductDecisionMarkers(events)
  const invalid = markers.find((marker) => !marker.valid)
  if (invalid) {
    return blocked(`${markerDescription(invalid)} 格式错误：${invalid.error}；自由文本不能替代 marker`, { markers })
  }

  const findings = new Map()
  for (const marker of markers.filter((item) => item.type === 'finding')) {
    const prior = findings.get(marker.id)
    if (prior && (prior.severity !== marker.severity || prior.kind !== marker.kind || prior.actor !== marker.actor)) {
      return blocked(`finding=${marker.id} 的定义发生冲突；必须保留唯一稳定定义`, { markers })
    }
    if (!prior) findings.set(marker.id, marker)
  }

  const dispositions = markers.filter((item) => item.type === 'product-disposition')
  for (const disposition of dispositions) {
    if (!findings.has(disposition.findingId)) {
      return blocked(`finding=${disposition.findingId} 没有对应的结构化 finding`, { markers })
    }
  }

  const relevantFindings = [...findings.values()].filter((finding) => ['P0', 'P1'].includes(finding.severity))
  const evidence = []
  for (const finding of relevantFindings) {
    if (!finding.actor || finding.actor === author) {
      return blocked(`finding=${finding.id} 必须由非作者 reviewer/bot 创建，PR 作者不能给自己创建授权 finding`, { markers })
    }
    if (!['review', 'review-comment'].includes(finding.event?.source)) {
      return blocked(`finding=${finding.id} 必须来自 GitHub review 或 inline review comment，普通 issue comment 不能创建授权 finding`, { markers })
    }
    const allHistory = dispositions
      .filter((item) => item.findingId === finding.id)
      .sort((left, right) => eventTime(left) - eventTime(right))
    if (allHistory.length > 0 && (!finding.created_at || allHistory.some((item) => !item.created_at))) {
      return blocked(`finding=${finding.id} 的事件缺少可靠 created_at，无法证明授权发生在 finding 之后`, { markers })
    }
    const findingCreatedAt = eventTime(finding)
    const history = allHistory.filter((item) => eventTime(item) > findingCreatedAt)
    if (history.length === 0) continue

    let deferred = false
    let authorized = null
    for (let index = 1; index < history.length; index++) {
      if (eventTime(history[index - 1]) === eventTime(history[index])) {
        return blocked(`finding=${finding.id} 有多个同秒 disposition，无法证明事件先后；请用新评论重发最后动作`, { markers })
      }
    }
    for (const item of history) {
      if (item.action === 'defer') {
        if (item.actor !== author) {
          return blocked(`finding=${finding.id} 的 defer 只能由 PR 作者发布（实际为 ${item.actor || 'unknown'}）`, { markers })
        }
        deferred = true
        authorized = authorIsOwner ? item : null
        continue
      }
      if (item.action === 'accept-deferral') {
        if (item.actor !== finding.actor) {
          return blocked(`finding=${finding.id} 的 accept-deferral 必须由原 reviewer ${finding.actor || 'unknown'} 发布`, { markers })
        }
        if (deferred) authorized = item
        continue
      }
      if (item.action === 'approve') {
        if (!owners.has(item.actor)) {
          return blocked(`finding=${finding.id} 的 approve 只能由 FiloAI owner 发布（实际为 ${item.actor || 'unknown'}）`, { markers })
        }
        if (!sameHead(item.head, head)) {
          continue
        }
        if (deferred) authorized = item
        continue
      }
      if (item.action === 'withdraw') {
        if (item.actor !== finding.actor && !owners.has(item.actor)) {
          return blocked(`finding=${finding.id} 的 withdraw 只能由原 reviewer 或 FiloAI owner 发布`, { markers })
        }
        if (!sameHead(item.head, head)) {
          continue
        }
        authorized = null
      }
    }

    if (deferred && !authorized) {
      return blocked(`finding=${finding.id}（${finding.severity}/${finding.kind}）已声明 defer，但没有原 reviewer ${finding.actor || 'unknown'} 的 accept-deferral，或 FiloAI owner 针对当前 head 的 approve`, { markers })
    }
    if (deferred && authorized) {
      evidence.push(`finding:${finding.id}:${authorized.action}:${authorized.actor}`)
    }
  }

  return { satisfied: true, reason: null, evidence, markers }
}

export function productFindingMarker({ id, severity, kind }) {
  return `<!-- filoai:finding id=${id} severity=${severity} kind=${kind} -->`
}

export function productDispositionMarker({ finding, action, head }) {
  const suffix = head === undefined ? '' : ` head=${head}`
  return `<!-- filoai:product-disposition finding=${finding} action=${action}${suffix} -->`
}
