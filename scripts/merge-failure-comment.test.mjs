import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMergeFailureComment,
  buildMergeFailureCommentArgs,
  mergeFailureMarker,
  mergeFailureReason,
} from './merge-failure-comment.mjs'

test('失败回复优先使用 stderr 并绑定当前 head', () => {
  const headOid = '48A99F165ED252A898C5088153E7EA30E3BFE36D'
  const body = buildMergeFailureComment({
    headOid,
    error: { message: 'Command failed', stderr: 'Pull Request is not mergeable' },
  })

  assert.match(body, /自动合并未完成/)
  assert.match(body, /Pull Request is not mergeable/)
  assert.doesNotMatch(body, /Command failed/)
  assert.ok(body.includes(mergeFailureMarker(headOid)))
  assert.match(body, /当前 head.*48A99F1/)
})

test('失败原因清理终端颜色和 markdown fence，并限制长度', () => {
  const reason = mergeFailureReason({ stderr: `\u001b[31m${'x'.repeat(1300)}\`\`\`` })
  assert.equal(reason.includes('\u001b['), false)
  assert.equal(reason.includes('```'), false)
  assert.ok(reason.length <= 1200)
  assert.ok(reason.endsWith('…'))
})

test('失败回复首次创建，重复失败时更新同一条评论', () => {
  const common = { repo: 'FiloAI/filoai-frontend', number: 3410, body: 'reason' }
  assert.deepEqual(buildMergeFailureCommentArgs(common), [
    'api', 'repos/FiloAI/filoai-frontend/issues/3410/comments', '--method', 'POST', '-f', 'body=reason',
  ])
  assert.deepEqual(buildMergeFailureCommentArgs({ ...common, commentId: 987 }), [
    'api', 'repos/FiloAI/filoai-frontend/issues/comments/987', '--method', 'PATCH', '-f', 'body=reason',
  ])
})
