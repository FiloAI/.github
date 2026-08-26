import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMergeStatusComment,
  buildMergeStatusCommentArgs,
  humanizeMergeReason,
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
  assert.match(body, /谁需要处理/)
  assert.match(body, /不会绕过 CI、覆盖率、审核/)
})

test('确定性门禁通过但未审时明确说明 CI 绿不等于可合并', () => {
  const body = buildMergeStatusComment({
    headOid: '48a99f165ed252a898c5088153e7ea30e3bfe36d',
    reason: '等待审核',
    state: 'ready',
  })
  assert.match(body, /正在审核当前 head/)
  assert.match(body, /作者通常无需操作/)
  assert.match(body, /不是“报一次后就停止”/)
})

test('机器化冲突状态翻译为作者可执行的人话', () => {
  const body = buildMergeStatusComment({
    headOid: '04d01e9'.padEnd(40, '0'),
    reason: 'mergeable=CONFLICTING',
  })
  assert.match(body, /和最新 main 有代码冲突/)
  assert.match(body, /PR 作者\/负责人/)
  assert.match(body, /合并到该分支，解决冲突并 push/)
  assert.match(body, /技术细节（给维护者）/)
})

test('CI 阻塞展示具体 check，并说明修复后会自动复查', () => {
  const body = buildMergeStatusComment({
    headOid: 'a'.repeat(40),
    reason: 'required checks 未通过: desktop / test=FAILURE, ios / test=FAILURE；CI bridge 失败详情：desktop / test=FAILURE',
  })
  assert.match(body, /必需 CI 检查未通过/)
  assert.match(body, /desktop \/ test=FAILURE/)
  assert.match(body, /修复或重跑/)
  assert.match(body, /自动复查.*会/)
})

test('纯函数人话映射不改变 fail-closed 语义', () => {
  const result = humanizeMergeReason('mergeable=UNKNOWN')
  assert.equal(result.owner, '合并管家')
  assert.match(result.summary, /还在计算/)
  assert.match(result.action, /自动重试/)
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

test('合并后状态评论明确收口，不再显示等待审核', () => {
  const body = buildMergeStatusComment({
    headOid: 'b'.repeat(40),
    reason: 'GitHub 已确认 state=MERGED，merge commit=c'.repeat(1),
    state: 'merged',
  })
  assert.match(body, /合并管家：已合并/)
  assert.match(body, /不再表示阻塞/)
  assert.doesNotMatch(body, /正在审核当前 head/)
})
