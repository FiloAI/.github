const MAX_REASON_LENGTH = 1200

function cleanText(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/```/g, "'''")
    .trim()
}

export function mergeFailureReason(error) {
  const stderr = cleanText(error?.stderr)
  const message = cleanText(error?.message || error)
  const reason = stderr || message || 'GitHub 未返回具体错误信息'
  return reason.length > MAX_REASON_LENGTH
    ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`
    : reason
}

export function mergeFailureMarker(headOid) {
  return `<!-- filoai-merge-steward:failure head=${String(headOid || '').toLowerCase()} -->`
}

export function buildMergeFailureComment({ headOid, error, outcomeUnverified = false }) {
  const head = String(headOid || '')
  const title = outcomeUnverified ? '自动合并结果待确认' : '自动合并未完成'
  const followUp = outcomeUnverified
    ? 'GitHub 合并命令已返回成功，但管家暂时无法确认 PR 最终处于 merged、queued 或 scheduled 状态。任务会重新读取实时状态，不会重复发起无依据的合并。'
    : '本轮没有绕过 GitHub 的合并规则；处理上述原因后，任务会重新检查。'
  return `${mergeFailureMarker(head)}
⚠️ **合并管家：${title}**

- **当前 head**：\`${head.slice(0, 7) || 'unknown'}\`
- **原因**：

\`\`\`
${mergeFailureReason(error)}
\`\`\`

${followUp}`
}

export function buildMergeFailureCommentArgs({ repo, number, body, commentId = null }) {
  if (commentId) {
    return ['api', `repos/${repo}/issues/comments/${commentId}`, '--method', 'PATCH', '-f', `body=${body}`]
  }
  return ['api', `repos/${repo}/issues/${number}/comments`, '--method', 'POST', '-f', `body=${body}`]
}
