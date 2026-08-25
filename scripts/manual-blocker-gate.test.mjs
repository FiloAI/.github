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

test('Chris 或 Bobo 的明确 veto 不受仓库 collaborator 权限字段影响', () => {
  for (const login of ['zqchris', 'jerboy']) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login, permission: 'none', body: '当前不要合并，仍有安全风险。',
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, login)
    assert.deepEqual(result.blockers, [login], login)
  }
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

test('高风险 owner 请求评论不会在 owner 已批准后留下永久阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'zqchris',
      permission: 'admin',
      body: '<!-- filoai-merge-steward:owner-review-request -->\n高风险改动需要 owner 确认',
    }],
  })
  assert.equal(result.satisfied, true)
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

test('COMMENTED review 总结里的明确否决会阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'COMMENTED',
      body: 'Do not merge. The rollout contract is still broken.',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('COMMENTED review 总结里的非阻塞说明不会误判', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'COMMENTED',
      body: 'No merge blockers found.',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
})

test('正式 review 状态优先于同一 review 的总结措辞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: headOid,
      body: 'Earlier there was a do not merge concern.', submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: headOid,
      body: `LGTM ${headOid.slice(0, 7)}`, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, false)
})

test('dismissed review 和自动化账号不构成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      { login: 'reviewer', permission: 'write', state: 'DISMISSED', body: 'do not merge' },
      { login: 'cursor', permission: 'write', state: 'CHANGES_REQUESTED', is_bot: true },
    ],
  }).satisfied, true)
})

test('编辑后的评论按 updated_at 排序', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: `LGTM ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
      { login: 'reviewer', permission: 'write', body: 'do not merge', created_at: '2026-08-24T00:00:00Z', updated_at: '2026-08-24T00:02:00Z' },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('普通 blocker 字样不误判，逗号分隔的当前 head 放行可识别', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{ login: 'reviewer', permission: 'write', body: 'The test blocker is fixed.' }],
  }).satisfied, true)
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: 'do not merge', created_at: '2026-08-24T00:00:00Z' },
      { login: 'reviewer', permission: 'write', body: `LGTM, ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
    ],
  }).satisfied, true)
})

test('同一段先说无 CI 阻断、随后明确不要合并时仍然阻塞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write',
      body: 'No merge blockers from CI but do not merge until the migration is fixed.',
    }],
  }).satisfied, false)
})

test('测试通过不能解除人工合并阻止', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: '不要合并', created_at: '2026-08-24T00:00:00Z' },
      { login: 'reviewer', permission: 'write', body: `测试已通过 ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
    ],
  })
  assert.equal(result.satisfied, false)
})
