import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateRequiredChecks } from './required-check-gate.mjs'

test('仓库没有 required checks 时不虚构 summary', () => {
  assert.deepEqual(evaluateRequiredChecks({ requirements: [], checks: [] }), {
    satisfied: true,
    reason: null,
  })
})

test('全部 required checks 必须成功', () => {
  assert.equal(evaluateRequiredChecks({
    requirements: [{ context: 'summary' }, { context: 'hygiene' }],
    checks: [
      { name: 'summary', status: 'completed', conclusion: 'success' },
      { name: 'hygiene', status: 'completed', conclusion: 'success' },
    ],
  }).satisfied, true)
})

test('缺失、失败或未完成的 required check 都阻塞', () => {
  const result = evaluateRequiredChecks({
    requirements: [{ context: 'summary' }, { context: 'hygiene' }, { context: 'deploy' }],
    checks: [
      { name: 'summary', status: 'completed', conclusion: 'success' },
      { name: 'hygiene', status: 'completed', conclusion: 'failure' },
    ],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /hygiene=completed\/failure/)
  assert.match(result.reason, /deploy=缺失/)
})

test('绑定 GitHub App 的 required check 只接受同一 integration', () => {
  const result = evaluateRequiredChecks({
    requirements: [{ context: 'summary', integrationId: 123 }],
    checks: [
      {
        name: 'summary', integrationId: 999, status: 'completed', conclusion: 'success',
        at: '2026-08-14T00:02:00Z',
      },
      {
        name: 'summary', integrationId: 123, status: 'completed', conclusion: 'failure',
        at: '2026-08-14T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /summary@app:123=completed\/failure/)
})

test('同一 integration 只认最新 check 状态', () => {
  assert.equal(evaluateRequiredChecks({
    requirements: [{ context: 'summary', integrationId: 123 }],
    checks: [
      {
        name: 'summary', integrationId: 123, status: 'completed', conclusion: 'failure',
        at: '2026-08-14T00:01:00Z',
      },
      {
        name: 'summary', integrationId: 123, status: 'completed', conclusion: 'success',
        at: '2026-08-14T00:02:00Z',
      },
    ],
  }).satisfied, true)
})

test('GitHub 视为通过的 neutral 与 skipped 不阻塞', () => {
  for (const conclusion of ['neutral', 'skipped']) {
    assert.equal(evaluateRequiredChecks({
      requirements: [{ context: 'summary' }],
      checks: [{ name: 'summary', status: 'completed', conclusion }],
    }).satisfied, true, conclusion)
  }
})
