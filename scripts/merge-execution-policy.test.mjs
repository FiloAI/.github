import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMergeArgs,
  validateAdminFallbackSnapshot,
} from './merge-execution-policy.mjs'

test('merge args 始终绑定当前 head，只有明确请求时才使用 admin', () => {
  const common = {
    repo: 'FiloAI/filoai-frontend',
    number: 3410,
    method: '--merge',
    headOid: 'abc1234',
  }
  assert.deepEqual(buildMergeArgs(common), [
    'pr', 'merge', '3410', '--repo', 'FiloAI/filoai-frontend', '--merge',
    '--match-head-commit', 'abc1234',
  ])
  assert.deepEqual(buildMergeArgs({ ...common, admin: true }).slice(-1), ['--admin'])
})

test('admin fallback 仅接受仍 open 且 head/base 都未变化的快照', () => {
  const common = {
    expectedHeadOid: 'head-1',
    checkedBaseOid: 'base-1',
  }
  assert.equal(validateAdminFallbackSnapshot({
    ...common,
    snapshot: { state: 'OPEN', headRefOid: 'head-1', baseRefOid: 'base-1' },
  }).satisfied, true)
  assert.equal(validateAdminFallbackSnapshot({
    ...common,
    snapshot: { state: 'OPEN', headRefOid: 'head-2', baseRefOid: 'base-1' },
  }).satisfied, false)
  assert.equal(validateAdminFallbackSnapshot({
    ...common,
    snapshot: { state: 'OPEN', headRefOid: 'head-1', baseRefOid: 'base-2' },
  }).satisfied, false)
  assert.equal(validateAdminFallbackSnapshot({
    ...common,
    snapshot: { state: 'MERGED', headRefOid: 'head-1', baseRefOid: 'base-1' },
  }).satisfied, false)
})
