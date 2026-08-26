const MAX_SUMMARY_LENGTH = 220

function cleanText(value) {
  return String(value || '')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value, max = MAX_SUMMARY_LENGTH) {
  const text = cleanText(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function extractDescription(body) {
  const text = String(body || '')
  const marked = text.match(/DESCRIPTION START -->\s*([\s\S]*?)\s*<!-- DESCRIPTION END/i)
  if (marked?.[1]) return marked[1]
  return text.split(/\r?\n/).find((line) => cleanText(line).length > 0) || ''
}

function extractSeverity(body) {
  const match = String(body || '').match(/\b(P[0-3])\b|\b(Critical|High|Medium|Low)\s+Severity\b/i)
  if (!match) return '未标级别'
  const value = match[1] || match[2]
  if (/^medium$/i.test(value)) return 'Medium（中风险）'
  if (/^high$/i.test(value)) return 'High（高风险）'
  if (/^critical$/i.test(value)) return 'Critical（严重）'
  if (/^low$/i.test(value)) return 'Low（低风险）'
  return value.toUpperCase()
}

function displayAuthor(login) {
  if (/^cursor(?:\[bot\])?$/i.test(login)) return 'Cursor Bugbot'
  if (/^greptile-apps(?:\[bot\])?$/i.test(login)) return 'Greptile'
  return login
}

function humanizeReviewSummary(body) {
  const summary = truncate(extractDescription(body))
  const lower = summary.toLowerCase()
  if (lower.includes('fingerprint') && lower.includes('unrelated') && lower.includes('slot')) {
    return '重复图片没有对应的未占用槽位时，回退逻辑可能把它分配给另一个失败的 HTML 图片槽位，导致正文插入错误图片。'
  }
  if (lower.includes('atob') && (lower.includes('base64') || lower.includes('memory'))) {
    return '超大的 data URL 在大小检查前就会解码，可能卡住渲染线程或耗尽内存。'
  }
  if (lower.includes('duplicate') && lower.includes('insert')) {
    return '部分成功时可能重复插入已经成功的图片，造成正文重复图片或重复上传。'
  }
  return summary
}

export function summarizeReviewThread(thread) {
  const root = thread?.comments?.nodes?.[0] || {}
  const path = thread?.path || '文件位置未提供'
  const line = thread?.line ?? thread?.originalLine
  const location = line == null ? path : `${path}:${line}`
  const author = displayAuthor(root.author?.login || 'reviewer')
  const severity = extractSeverity(root.body)
  const summary = humanizeReviewSummary(root.body) || 'reviewer 留下了未解决的代码意见。'
  return { location, author, severity, summary }
}

export function formatUnresolvedReviewReason(threads) {
  if (!Array.isArray(threads) || threads.length === 0) return null
  const lines = [`未解决 review thread：${threads.length} 条`]
  for (const detail of threads.map(summarizeReviewThread)) {
    lines.push(`- ${detail.location}（${detail.author}，${detail.severity}）：${detail.summary.replace(/[；;]/g, '，')}`)
  }
  return lines.join('\n')
}

export function buildReviewThreadsQuery({ owner, name, prNumber, after = null }) {
  const cursor = after == null ? '' : `, after: ${JSON.stringify(after)}`
  return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${Number(prNumber)}) { reviewThreads(first: 100${cursor}) {
      nodes { id isResolved path line originalLine comments(first: 1) {
        nodes { body author { login } createdAt url }
      } }
      pageInfo { hasNextPage endCursor }
    } } } }`
}

/**
 * Read every review thread, not just GitHub's first page. `runGraphql` is
 * injected so pagination remains unit-testable without touching GitHub.
 */
export function readUnresolvedReviewThreads({ repo, prNumber, runGraphql }) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name || !Number.isInteger(Number(prNumber))) {
    throw new TypeError('repo 和 prNumber 无效')
  }
  if (typeof runGraphql !== 'function') throw new TypeError('runGraphql 必须是函数')

  const threads = []
  let after = null
  while (true) {
    const response = runGraphql(buildReviewThreadsQuery({ owner, name, prNumber, after }))
    const connection = response?.data?.repository?.pullRequest?.reviewThreads
    if (!connection) throw new Error('GitHub 未返回 review thread 连接')
    threads.push(...(connection.nodes || []))
    if (!connection.pageInfo?.hasNextPage) break
    const next = connection.pageInfo.endCursor
    if (!next || next === after) throw new Error('GitHub review thread 分页游标无效')
    after = next
  }
  return threads.filter((thread) => !thread.isResolved)
}
