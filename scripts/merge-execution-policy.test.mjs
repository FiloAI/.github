import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMergeArgs,
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
