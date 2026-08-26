// FiloAI 组织身份：jerboy 是 Cindy 中的 Bobo 在 FiloAI 使用的 GitHub 账号。
const OWNER_LOGINS = new Set(['zqchris', 'jerboy', 'gaoweiliuxd'])

const EXPLICIT_RISK_LABELS = new Set([
  'needs-owner-review',
  'risk:owner-review',
  'risk:security',
  'risk:billing',
  'risk:production',
])

const HIGH_RISK_PATHS = [
  /(^|\/)\.github\/workflows(\/|$)/i,
  /(^|\/)(?:\.github\/|docs\/)?CODEOWNERS$/i,
  /(^|\/)(?:auth|authentication|authorization|security|permission|permissions)(\/|\.|$)/i,
  /(^|\/)(?:payment|payments|billing|subscription|subscriptions|quota|entitlement|entitlements)(\/|\.|$)/i,
  /(^|\/)(?:migration|migrations|schema)(\/|\.|$)/i,
  /(^|\/)(?:deploy|deployment|production|prod)(\/|\.|$)/i,
  /(?:\.entitlements$|signing|provisioning|system-permission)/i,
  /(^|\/)(?:Auth(?:entication|orization)?|Security|Permissions?|Payments?|Billing|Subscriptions?|Quota|Entitlements?|Migration|Schema|Deploy(?:ment)?|Production)[A-Za-z0-9_.-]*$/,
  /(^|\/)(?:auth(?:entication|orization)?|security|permissions?|payments?|billing|subscriptions?|quota|entitlements?|migration|schema|deploy(?:ment)?|production)[A-Z][A-Za-z0-9_.-]*$/,
]

const ORG_AUTOMATION_PATHS = [
  /^scripts\/(?:pr-merge-sweep|merge-execution-policy|merge-label-policy|manual-blocker-gate|required-check-gate|high-risk-review-gate|high-risk-review-request|review-evidence-gate|merge-status-comment)/,
]

export function ownerApprovalMarker(headOid) {
  return `<!-- filoai-merge-steward:owner-approved head=${String(headOid || '').toLowerCase()} -->`
}

function sameHead(value, headOid) {
  return String(value || '').toLowerCase() === String(headOid || '').toLowerCase()
}

function hasOwnerMarker(body, headOid) {
  return String(body || '').toLowerCase().includes(ownerApprovalMarker(headOid))
}

export function classifyHighRisk({ repo, labels = [], files = [] }) {
  const labelNames = labels.map((label) => String(label?.name || label).toLowerCase())
  const label = labelNames.find((name) => EXPLICIT_RISK_LABELS.has(name))
  if (label) return { highRisk: true, reason: `label:${label}` }

  const patterns = repo === 'FiloAI/.github'
    ? [...HIGH_RISK_PATHS, ...ORG_AUTOMATION_PATHS]
    : HIGH_RISK_PATHS
  const file = files.find((item) => patterns.some((pattern) => pattern.test(String(item))))
  if (file) return { highRisk: true, reason: `path:${file}` }
  return { highRisk: false, reason: null }
}

export function evaluateHighRiskApproval({
  headOid,
  authorLogin,
  highRisk,
  riskReason,
  reviews = [],
  comments = [],
}) {
  if (!highRisk) return { satisfied: true, reason: null, evidence: null }
  const author = String(authorLogin || '').toLowerCase()
  if (OWNER_LOGINS.has(author)) {
    return { satisfied: true, reason: null, evidence: `owner-author:${author}` }
  }

  const review = reviews.find((item) => {
    const login = String(item.login || '').toLowerCase()
    return OWNER_LOGINS.has(login)
      && login !== author
      && String(item.state || '').toUpperCase() === 'APPROVED'
      && sameHead(item.commit_id, headOid)
  })
  if (review) {
    return { satisfied: true, reason: null, evidence: `owner-review:${review.login}` }
  }

  const comment = comments.find((item) => {
    const login = String(item.login || '').toLowerCase()
    return OWNER_LOGINS.has(login) && hasOwnerMarker(item.body, headOid)
  })
  if (comment) {
    return { satisfied: true, reason: null, evidence: `owner-marker:${comment.login}` }
  }

  return {
    satisfied: false,
    reason: `高风险改动待 FiloAI owner（zqchris、jerboy 或 GaoWeiLiuXD）确认当前 head（${riskReason}）`,
    evidence: null,
    needsOwnerReview: true,
  }
}
