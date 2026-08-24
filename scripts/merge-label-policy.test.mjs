import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateMergeLabels } from './merge-label-policy.mjs'

test('no-automerge remains a hard merge blocker', () => {
  assert.deepEqual(evaluateMergeLabels([{ name: 'no-automerge' }]), {
    satisfied: false,
    reason: 'no-automerge 标签',
  })
})

test('needs-human-review is advisory and does not block the merge script', () => {
  assert.deepEqual(evaluateMergeLabels([{ name: 'needs-human-review' }]), {
    satisfied: true,
    reason: null,
  })
})
