const MAX_REASON_LENGTH = 1200

function clean(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/```/g, "'''")
    .trim()
}

export const MERGE_STATUS_MARKER = '<!-- filoai-merge-steward:status -->'

export function buildMergeStatusComment({ headOid, reason, state = 'blocked' }) {
  const cleanReason = clean(reason) || 'GitHub 未返回具体原因'
  const clipped = cleanReason.length > MAX_REASON_LENGTH
    ? `${cleanReason.slice(0, MAX_REASON_LENGTH - 1)}…`
    : cleanReason
  const merged = state === 'merged'
  const ready = state === 'ready'
  const title = merged
    ? '已合并'
    : ready
      ? '已通过确定性门禁，等待当前 head 审核'
      : '本轮未自动合并'
  const followUp = merged
    ? 'GitHub 已确认该 PR 为 MERGED；这条状态不再表示阻塞。'
    : ready
    ? '合并管家会对这个 head 完成 AI 终审并留下可审计凭证；CI 绿灯本身不会触发合并。'
    : '处理上面的原因后，合并管家会重新检查；不会绕过 CI、覆盖率、审核或 GitHub 规则。'
  return `${MERGE_STATUS_MARKER}
ℹ️ **合并管家：${title}**

- **当前 head**：\`${String(headOid || '').slice(0, 7) || 'unknown'}\`
- **状态**：${clipped}

${followUp}`
}

export function buildMergeStatusCommentArgs({ repo, number, body, commentId = null }) {
  if (commentId) {
    return ['api', `repos/${repo}/issues/comments/${commentId}`, '--method', 'PATCH', '-f', `body=${body}`]
  }
  return ['api', `repos/${repo}/issues/${number}/comments`, '--method', 'POST', '-f', `body=${body}`]
}
