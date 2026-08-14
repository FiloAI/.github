import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateRequiredChecks } from './required-check-gate.mjs'

test('仓库没有 required checks 时不虚构 summary', () => {
  assert.deepEqual(evaluateRequiredChecks({ requiredNames: [], checks: {} }), {
    satisfied: true,
    reason: null,
  })
})

test('全部 required checks 必须成功', () => {
  assert.equal(evaluateRequiredChecks({
    requiredNames: ['summary', 'hygiene'],
    checks: {
      summary: { status: 'completed', conclusion: 'success' },
      hygiene: { status: 'completed', conclusion: 'success' },
    },
  }).satisfied, true)
})

test('缺失、失败或未完成的 required check 都阻塞', () => {
  const result = evaluateRequiredChecks({
    requiredNames: ['summary', 'hygiene', 'deploy'],
    checks: {
      summary: { status: 'completed', conclusion: 'success' },
      hygiene: { status: 'completed', conclusion: 'failure' },
    },
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /hygiene=completed\/failure/)
  assert.match(result.reason, /deploy=缺失/)
})
