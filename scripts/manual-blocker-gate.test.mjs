import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateManualBlockers } from './manual-blocker-gate.mjs'

const headOid = 'abcdef0123456789abcdef0123456789abcdef01'

test('外部机器人风险评论不构成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'cursor', permission: null, body: 'Risk: high. 未批准，转人工。',
      created_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
})

test('有权限者明确不要合并会阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write', body: '当前不要合并，功能仍有阻断。',
      created_at: '2026-08-24T00:00:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('CHANGES_REQUESTED 会阻塞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'maintain', state: 'CHANGES_REQUESTED',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, false)
})

test('同一阻止者批准当前 head 后解除', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED',
        commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('旧 head 批准不能解除阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED',
        commit_id: '1111111111111111111111111111111111111111',
        submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('其他人的批准不能覆盖原阻止者', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'blocker', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'approver', permission: 'admin', state: 'APPROVED',
        commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('同一阻止者引用当前 SHA 明确放行后解除', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `确认可以合并 ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('不引用当前 SHA 的普通确认不能解除跨 head 阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: '确认可以合并',
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('合并管家自己的终审与失败评论不反向生成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'owner', permission: 'admin',
        body: 'Cursor 风险评级不能单独卡住合并。\n<!-- merge-steward-verdict:repo#1:abcdef -->',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'owner', permission: 'admin',
        body: '<!-- filoai-merge-steward:failure head=abcdef -->\n【合并管家】本轮未合并',
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('不同意合并不能因包含同意合并子串而解除阻止', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `不同意合并 ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('not approved 不能因包含 approved 而解除阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `Not approved ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('否认存在 merge blocker 的说明不是阻止', () => {
  for (const body of [
    'No merge blockers',
    'No merge blocker found',
    '没有合并阻塞',
    '未发现 merge blocker',
    'Cursor 风险评级不能单独阻塞合并',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})
