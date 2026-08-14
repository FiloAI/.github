import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateHumanReviewGate,
  hasReviewPermission,
  isApprovalText,
} from './human-review-gate.mjs'

test('review 权限只接受 write 及以上', () => {
  assert.equal(hasReviewPermission('admin'), true)
  assert.equal(hasReviewPermission('maintain'), true)
  assert.equal(hasReviewPermission('write'), true)
  assert.equal(hasReviewPermission('triage'), false)
  assert.equal(hasReviewPermission('read'), false)
})

test('简短确认无需固定完整话术', () => {
  for (const text of ['同意', '确认', '可以', '合并吧', '没问题', '我确认可以合并']) {
    assert.equal(isApprovalText(text), true, text)
  }
})

test('英文明确合并意图同样接受', () => {
  for (const text of [
    'LGTM',
    'Approved',
    'Please merge this.',
    'Go ahead',
    'OK to merge',
    "Please merge this so I can review the test build. Once it’s available, I’ll verify the visuals.",
  ]) {
    assert.equal(isApprovalText(text), true, text)
  }
})

test('请求、等待和条件句不误判成确认', () => {
  for (const text of ['请确认', '等待确认', '修复后可以合并', '暂不合并', "Don't merge", 'After review, merge it']) {
    assert.equal(isApprovalText(text), false, text)
  }
})

test('同一评论后半句明确同意时接受', () => {
  assert.equal(isApprovalText('不需要再确认，可以直接合并'), true)
})

test('有 review 权限的作者无需自我确认', () => {
  assert.deepEqual(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'write',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    comments: [],
  }), {
    satisfied: true,
    reason: '作者 author 具备 write 权限，无需自我确认',
  })
})

test('当前 head 后有权限者回复“确认”即可放行', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    comments: [{
      login: 'reviewer',
      permission: 'write',
      body: '确认',
      created_at: '2026-08-14T00:01:00Z',
    }],
  }).satisfied, true)
})

test('当前 head 的正式批准直接满足人工门禁', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'abc1234',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [{
      login: 'reviewer',
      permission: 'write',
      state: 'APPROVED',
      commit_id: 'abc1234',
    }],
  }).satisfied, true)
})

test('旧 head 的正式批准不能放行新 head', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'new1234',
    headCommittedAt: Date.parse('2026-08-14T00:02:00Z'),
    reviews: [{
      login: 'reviewer',
      permission: 'write',
      state: 'APPROVED',
      commit_id: 'old1234',
    }],
  }).satisfied, false)
})

test('同一 reviewer 后续要求修改会覆盖旧批准', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'abc1234',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:01:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:02:00Z',
      },
    ],
  }).satisfied, false)
})

test('同一 reviewer 的批准被 dismissed 后不再生效', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'abc1234',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:01:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'DISMISSED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:02:00Z',
      },
    ],
  }).satisfied, false)
})

test('另一位有权限 reviewer 的最新批准仍可满足门禁', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'abc1234',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [
      {
        login: 'reviewer-a', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:02:00Z',
      },
      {
        login: 'reviewer-b', permission: 'maintain', state: 'APPROVED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:03:00Z',
      },
    ],
  }).satisfied, true)
})

test('跨 commit 的后续否决会阻止旧 head 批准复活', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'commit-a',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: 'commit-a',
        submitted_at: '2026-08-14T00:01:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: 'commit-b',
        submitted_at: '2026-08-14T00:02:00Z',
      },
    ],
  }).satisfied, false)
})

test('COMMENTED 不会撤销 reviewer 已有的当前 head 批准', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headOid: 'abc1234',
    headCommittedAt: Date.parse('2026-08-14T00:00:00Z'),
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:01:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'COMMENTED', commit_id: 'abc1234',
        submitted_at: '2026-08-14T00:02:00Z',
      },
    ],
  }).satisfied, true)
})

test('旧 head 的确认不能放行新 head', () => {
  assert.equal(evaluateHumanReviewGate({
    hasLabel: true,
    authorLogin: 'author',
    authorPermission: 'read',
    headCommittedAt: Date.parse('2026-08-14T00:02:00Z'),
    comments: [{
      login: 'reviewer',
      permission: 'write',
      body: '同意',
      created_at: '2026-08-14T00:01:00Z',
    }],
  }).satisfied, false)
})
