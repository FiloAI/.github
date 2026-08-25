import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateReviewEvidence,
  mergeReviewMarker,
} from './review-evidence-gate.mjs'

const head = '48a99f165ed252a898c5088153e7ea30e3bfe36d'

test('接受非作者针对当前 head 的正式 review', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [{
      login: 'reviewer',
      state: 'COMMENTED',
      commit_id: head,
      body: 'Reviewed; no blocking findings.',
    }],
  })
  assert.equal(result.satisfied, true)
  assert.equal(result.evidence, 'formal-review:reviewer')
})

test('COMMENTED review 必须有实质审查内容，空评论或未审查声明不能放行', () => {
  for (const body of ['', 'hello', 'I did not review this PR']) {
    const result = evaluateReviewEvidence({
      headOid: head,
      authorLogin: 'author',
      reviews: [{ login: 'reviewer', state: 'COMMENTED', body, commit_id: head }],
    })
    assert.equal(result.satisfied, false)
  }
  assert.equal(evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [{ login: 'ai-reviewer', state: 'COMMENTED', body: 'No findings on this head.', commit_id: head }],
  }).satisfied, true)
})

test('只有 inline review comments、summary 为空时仍算当前 head 已审', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [{
      login: 'reviewer',
      state: 'COMMENTED',
      body: '',
      commit_id: head,
      hasInlineComments: true,
    }],
  })
  assert.equal(result.satisfied, true)
  assert.equal(result.evidence, 'formal-review:reviewer')
})

test('inline comments 不能替代失败或拒绝审查声明', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [{
      login: 'reviewer',
      state: 'COMMENTED',
      body: 'I was unable to review this PR.',
      commit_id: head,
      hasInlineComments: true,
    }],
  })
  assert.equal(result.satisfied, false)
})

test('没有审查意见是有效的通过总结，不会误判为审查失败', () => {
  assert.equal(evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [{ login: 'reviewer', state: 'COMMENTED', body: '没有审查意见，未发现问题。', commit_id: head }],
  }).satisfied, true)
})

test('作者自审、旧 head 与失败或拒审答复均不算审核凭证', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    reviews: [
      { login: 'author', state: 'APPROVED', commit_id: head, body: 'LGTM' },
      { login: 'other', state: 'APPROVED', commit_id: 'a'.repeat(40), body: 'LGTM' },
      { login: 'bot[bot]', state: 'COMMENTED', commit_id: head, body: 'Unable to review this PR because it is too large.' },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('接受受信任 owner-side steward 对当前 head 写入的结构化凭证', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'zqchris',
    trustedStewardLogins: ['zqchris'],
    comments: [{
      login: 'zqchris',
      body: `${mergeReviewMarker(head)}\nAI review completed; no blocking findings.`,
    }],
  })
  assert.equal(result.satisfied, true)
  assert.equal(result.evidence, 'merge-steward:zqchris')
})

test('不接受非受信任账号、旧 head 或 verdict 非 pass 的伪造 marker', () => {
  const result = evaluateReviewEvidence({
    headOid: head,
    authorLogin: 'author',
    trustedStewardLogins: ['zqchris'],
    comments: [
      { login: 'stranger', body: mergeReviewMarker(head) },
      { login: 'zqchris', body: mergeReviewMarker('a'.repeat(40)) },
      { login: 'zqchris', body: `<!-- filoai-merge-steward:reviewed head=${head} verdict=fail -->` },
    ],
  })
  assert.equal(result.satisfied, false)
})
