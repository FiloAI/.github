import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyHighRisk,
  evaluateHighRiskApproval,
  ownerApprovalMarker,
} from './high-risk-review-gate.mjs'

const head = '48a99f165ed252a898c5088153e7ea30e3bfe36d'

test('只按明确风险标签或敏感路径触发，不按 PR 大小触发', () => {
  assert.equal(classifyHighRisk({ repo: 'FiloAI/filoai-frontend', files: ['desktop/src/mail/list.ts'] }).highRisk, false)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/FiloMailCenter', files: ['src/main/kotlin/payment/StripeService.kt'] }).highRisk, true)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/filoai-frontend', files: ['ios/FiloApp/Filo.entitlements'] }).highRisk, true)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/filoai-frontend', labels: ['risk:owner-review'] }).highRisk, true)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/filoai-frontend', files: ['CODEOWNERS'] }).highRisk, true)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/filoai-frontend', files: ['docs/CODEOWNERS'] }).highRisk, true)
})

test('组织合并与 review 门禁脚本本身属于高风险', () => {
  const result = classifyHighRisk({ repo: 'FiloAI/.github', files: ['scripts/pr-merge-sweep.mjs'] })
  assert.deepEqual(result, { highRisk: true, reason: 'path:scripts/pr-merge-sweep.mjs' })
  assert.equal(classifyHighRisk({ repo: 'FiloAI/.github', files: ['scripts/manual-blocker-gate.mjs'] }).highRisk, true)
  assert.equal(classifyHighRisk({ repo: 'FiloAI/.github', files: ['scripts/merge-label-policy.mjs'] }).highRisk, true)
})

test('高风险改动要求 Chris 或 Bobo 对当前 head 留下批准', () => {
  const blocked = evaluateHighRiskApproval({
    headOid: head,
    authorLogin: 'contributor',
    highRisk: true,
    riskReason: 'path:auth/service.ts',
  })
  assert.equal(blocked.satisfied, false)
  assert.equal(blocked.needsOwnerReview, true)

  const approved = evaluateHighRiskApproval({
    headOid: head,
    authorLogin: 'contributor',
    highRisk: true,
    riskReason: 'path:auth/service.ts',
    reviews: [{ login: 'zqchris', state: 'APPROVED', commit_id: head }],
  })
  assert.equal(approved.satisfied, true)
})

test('作者不能用自己的 GitHub approval 满足高风险门，但显式 owner 会话授权 marker 可审计', () => {
  const result = evaluateHighRiskApproval({
    headOid: head,
    authorLogin: 'zqchris',
    highRisk: true,
    riskReason: 'path:.github/workflows/ci.yml',
    reviews: [{ login: 'zqchris', state: 'APPROVED', commit_id: head }],
    comments: [{ login: 'zqchris', body: ownerApprovalMarker(head) }],
  })
  assert.equal(result.satisfied, true)
  assert.equal(result.evidence, 'owner-marker:zqchris')
})

test('普通确认、旧 head 和非 owner marker 不放行高风险改动', () => {
  const result = evaluateHighRiskApproval({
    headOid: head,
    authorLogin: 'author',
    highRisk: true,
    riskReason: 'path:migrations/001.sql',
    comments: [
      { login: 'zqchris', body: 'looks good' },
      { login: 'zqchris', body: ownerApprovalMarker('a'.repeat(40)) },
      { login: 'stranger', body: ownerApprovalMarker(head) },
    ],
  })
  assert.equal(result.satisfied, false)
})
