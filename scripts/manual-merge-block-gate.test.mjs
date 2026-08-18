import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateManualMergeBlockGate,
  isMergeBlockText,
} from './manual-merge-block-gate.mjs'

test('识别 #3420 波波的普通评论为明确合并阻断', () => {
  assert.equal(isMergeBlockText('这里有一个需要修复的功能阻断：FREE 降级用户的 Automation 仍可能执行。'), true)
})

test('识别中英文明确阻止合并文本', () => {
  for (const text of [
    '当前不宜合并，需要先修复状态不一致。',
    '先别合并，这会导致数据损坏。',
    'This is a merge blocker.',
    'Do not merge until this is fixed.',
    'Not ready to merge.',
  ]) assert.equal(isMergeBlockText(text), true, text)
})

test('条件建议和已解除阻断不误判', () => {
  for (const text of [
    '建议后续继续优化。',
    '之前的阻断已修复，可以合并。',
    '可以合并，剩余问题另开 issue。',
  ]) assert.equal(isMergeBlockText(text), false, text)
})

test('同一评论中以最后一个明确意图为准', () => {
  assert.equal(isMergeBlockText('之前不能合并，现在已经修复，可以合并。'), false)
  assert.equal(isMergeBlockText('可以合并，不过这仍是一个 merge blocker。'), true)
})

test('同一条评论里的最终阻止不会被前文批准吞掉', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [{
      login: 'jerboy', permission: 'write',
      body: '可以合并，不过这仍是一个 merge blocker。',
      created_at: '2026-08-17T10:32:27Z',
    }],
  })
  assert.equal(gate.satisfied, false)
})

test('疑问和仍带前置条件的文本不能解除阻止', () => {
  for (const body of [
    '现在可以合并吗？',
    '可以合并，不过需要先修复状态不一致。',
    '可以合并，但是还要处理退款数据。',
    'Can we merge now?',
    'OK to merge, but this still needs a fix.',
  ]) {
    const gate = evaluateManualMergeBlockGate({
      headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      comments: [
        { login: 'jerboy', permission: 'write', body: '当前不宜合并。', created_at: '2026-08-17T10:10:00Z' },
        { login: 'jerboy', permission: 'write', body, created_at: '2026-08-17T10:20:00Z' },
      ],
    })
    assert.equal(gate.satisfied, false, body)
  }
})

test('有权限成员普通评论阻止后 fail-closed', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [{
      login: 'jerboy', permission: 'write',
      body: '这里有一个需要修复的功能阻断。',
      created_at: '2026-08-17T10:32:27Z',
    }],
  })
  assert.equal(gate.satisfied, false)
  assert.match(gate.reason, /jerboy/)
})

test('作者 push 新 head 不会自动清除原阻止者的门', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    comments: [{
      login: 'jerboy', permission: 'write', body: '当前不宜合并。',
      created_at: '2026-08-17T10:32:27Z',
    }],
  })
  assert.equal(gate.satisfied, false)
})

test('其他成员批准不能覆盖原阻止者', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [
      { login: 'jerboy', permission: 'write', body: '当前不宜合并。', created_at: '2026-08-17T10:32:27Z' },
      { login: 'alice', permission: 'maintain', body: '可以合并', created_at: '2026-08-17T10:40:00Z' },
    ],
  })
  assert.equal(gate.satisfied, false)
})

test('同秒发生的放行与阻止保守地保持阻止', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [{
      login: 'jerboy', permission: 'write', body: '当前不宜合并。',
      created_at: '2026-08-17T10:32:27Z',
    }],
    reviews: [{
      login: 'jerboy', permission: 'write', state: 'APPROVED', commit_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      submitted_at: '2026-08-17T10:32:27Z',
    }],
  })
  assert.equal(gate.satisfied, false)
})

test('原阻止者明确引用当前 head 放行后解除', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comments: [
      { login: 'jerboy', permission: 'write', body: '当前不宜合并。', created_at: '2026-08-17T10:32:27Z' },
      { login: 'jerboy', permission: 'write', body: '阻断已修复，可以合并 aaaaaaa。', created_at: '2026-08-17T10:40:00Z' },
    ],
  })
  assert.equal(gate.satisfied, true)
})

test('原阻止者未引用当前 head 的文字放行不能解除阻止', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    comments: [
      { login: 'jerboy', permission: 'write', body: '当前不宜合并。', created_at: '2026-08-17T10:32:27Z' },
      { login: 'jerboy', permission: 'write', body: '可以合并 aaaaaaa。', created_at: '2026-08-17T11:40:00Z' },
    ],
  })
  assert.equal(gate.satisfied, false)
})

test('原阻止者正式 APPROVED 当前 head 后解除', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    comments: [{
      login: 'jerboy', permission: 'write', body: '当前不宜合并。',
      created_at: '2026-08-17T10:32:27Z',
    }],
    reviews: [{
      login: 'jerboy', permission: 'write', state: 'APPROVED', commit_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      submitted_at: '2026-08-17T11:10:00Z',
    }],
  })
  assert.equal(gate.satisfied, true)
})

test('正式 CHANGES_REQUESTED 在无标签时同样阻止', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviews: [{
      login: 'jerboy', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: 'head-a',
      submitted_at: '2026-08-17T10:32:27Z',
    }],
  })
  assert.equal(gate.satisfied, false)
})

test('dismissed 的 CHANGES_REQUESTED 不再构成阻止', () => {
  const gate = evaluateManualMergeBlockGate({
    headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    reviews: [{
      id: 42,
      login: 'jerboy', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: 'head-a',
      submitted_at: '2026-08-17T10:32:27Z', dismissed_at: '2026-08-17T10:40:00Z',
    }],
  })
  assert.equal(gate.satisfied, true)
})
