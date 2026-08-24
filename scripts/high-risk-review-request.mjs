function clean(value) {
  return String(value || '').replace(/```/g, "'''").trim()
}

export const OWNER_REVIEW_REQUEST_MARKER = '<!-- filoai-merge-steward:owner-review-request -->'

export function buildOwnerReviewRequest({ headOid, reason }) {
  return `${OWNER_REVIEW_REQUEST_MARKER}
<!-- filoai-merge-steward:owner-review-request-head=${String(headOid || '').toLowerCase()} -->
🚨 **合并管家：高风险改动需要 owner 确认**

- **当前 head**：\`${String(headOid || '').slice(0, 7) || 'unknown'}\`
- **触发原因**：${clean(reason) || '命中高风险路径或标签'}

@zqchris @xd-bobo 请确认这个 **当前 head** 是否可以合并。这里按安全、权限、支付、生产、迁移或合并门禁等明确风险触发，**不按 PR 行数触发**。CI 和普通 AI 审核通过仍不能替代这次 owner 确认。`
}

export function buildOwnerReviewCommentArgs({ repo, number, body, commentId = null }) {
  if (commentId) {
    return ['api', `repos/${repo}/issues/comments/${commentId}`, '--method', 'PATCH', '-f', `body=${body}`]
  }
  return ['api', `repos/${repo}/issues/${number}/comments`, '--method', 'POST', '-f', `body=${body}`]
}

export function buildFormalReviewerRequestArgs({ repo, number, authorLogin }) {
  if (String(authorLogin || '').toLowerCase() === 'zqchris') return null
  return [
    'api', `repos/${repo}/pulls/${number}/requested_reviewers`, '--method', 'POST',
    '-f', 'reviewers[]=zqchris',
  ]
}
