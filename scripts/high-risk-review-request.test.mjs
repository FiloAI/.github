import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildFormalReviewerRequestArgs,
  buildOwnerReviewCommentArgs,
  buildOwnerReviewRequest,
  OWNER_REVIEW_REQUEST_MARKER,
} from './high-risk-review-request.mjs'

const head = '48a99f165ed252a898c5088153e7ea30e3bfe36d'

test('高风险请求直接在 PR 点名 owner，并绑定当前 head', () => {
  const body = buildOwnerReviewRequest({ headOid: head, reason: 'path:auth/service.ts' })
  assert.ok(body.includes(OWNER_REVIEW_REQUEST_MARKER))
  assert.ok(body.includes(`owner-review-request-head=${head}`))
  assert.match(body, /@zqchris @jerboy/)
  assert.match(body, /48a99f1/)
  assert.match(body, /不按 PR 行数触发/)
})

test('同一条 owner 请求评论可幂等更新', () => {
  const common = { repo: 'FiloAI/FiloMailCenter', number: 637, body: 'request' }
  assert.deepEqual(buildOwnerReviewCommentArgs(common), [
    'api', 'repos/FiloAI/FiloMailCenter/issues/637/comments', '--method', 'POST', '-f', 'body=request',
  ])
  assert.deepEqual(buildOwnerReviewCommentArgs({ ...common, commentId: 42 }), [
    'api', 'repos/FiloAI/FiloMailCenter/issues/comments/42', '--method', 'PATCH', '-f', 'body=request',
  ])
})

test('非 owner 作者正式 request Chris，Chris/Bobo 自己是作者时不额外请求 owner', () => {
  assert.deepEqual(buildFormalReviewerRequestArgs({
    repo: 'FiloAI/filoai-frontend', number: 3557, authorLogin: 'contributor',
  }), [
    'api', 'repos/FiloAI/filoai-frontend/pulls/3557/requested_reviewers', '--method', 'POST',
    '-f', 'reviewers[]=zqchris',
  ])
  for (const authorLogin of ['zqchris', 'jerboy']) {
    assert.equal(buildFormalReviewerRequestArgs({
      repo: 'FiloAI/filoai-frontend', number: 3557, authorLogin,
    }), null, authorLogin)
  }
})
