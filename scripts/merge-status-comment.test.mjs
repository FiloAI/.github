import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMergeStatusComment,
  buildMergeStatusCommentArgs,
  MERGE_STATUS_MARKER,
} from './merge-status-comment.mjs'

test('阻塞状态绑定当前 head 并直接展示原因', () => {
  const body = buildMergeStatusComment({
    headOid: '48a99f165ed252a898c5088153e7ea30e3bfe36d',
    reason: 'coverage gate failed',
  })
  assert.ok(body.includes(MERGE_STATUS_MARKER))
  assert.match(body, /48a99f1/)
  assert.match(body, /coverage gate failed/)
  assert.match(body, /不会绕过 CI、覆盖率、审核/)
})

test('确定性门禁通过但未审时明确说明 CI 绿不等于可合并', () => {
  const body = buildMergeStatusComment({
    headOid: '48a99f165ed252a898c5088153e7ea30e3bfe36d',
    reason: '等待审核',
    state: 'ready',
  })
  assert.match(body, /等待当前 head 审核/)
  assert.match(body, /CI 绿灯本身不会触发合并/)
})

test('状态评论首次创建，后续更新同一条评论', () => {
  const common = { repo: 'FiloAI/filoai-frontend', number: 3557, body: 'status' }
  assert.deepEqual(buildMergeStatusCommentArgs(common), [
    'api', 'repos/FiloAI/filoai-frontend/issues/3557/comments', '--method', 'POST', '-f', 'body=status',
  ])
  assert.deepEqual(buildMergeStatusCommentArgs({ ...common, commentId: 42 }), [
    'api', 'repos/FiloAI/filoai-frontend/issues/comments/42', '--method', 'PATCH', '-f', 'body=status',
  ])
})
