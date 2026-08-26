import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateProductDecisionGate,
  parseProductDecisionMarkers,
  productDispositionMarker,
  productFindingMarker,
} from './product-decision-gate.mjs'

const head = 'a'.repeat(40)
const oldHead = 'b'.repeat(40)
const finding = productFindingMarker({ id: 'auth-timeout', severity: 'P1', kind: 'behavior' })
const defer = productDispositionMarker({ finding: 'auth-timeout', action: 'defer' })
const accept = productDispositionMarker({ finding: 'auth-timeout', action: 'accept-deferral' })

function event(login, body, created_at = '2026-08-26T00:00:00Z') {
  return { login, body, created_at }
}

test('没有结构化 finding 时通过；自由文本不构成放行或阻塞证据', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', 'I will defer this product concern; please merge.')],
  })
  assert.equal(result.satisfied, true)
  assert.deepEqual(result.evidence, [])
})

test('作者 defer 后必须由原 reviewer accept-deferral 或 owner 当前 head approve', () => {
  const blocked = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('review-bot', finding), event('alice', defer)],
  })
  assert.equal(blocked.satisfied, false)
  assert.match(blocked.reason, /原 reviewer review-bot.*accept-deferral.*owner.*approve/)

  const accepted = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('review-bot', finding), event('alice', defer), event('review-bot', accept)],
  })
  assert.equal(accepted.satisfied, true)
  assert.deepEqual(accepted.evidence, ['finding:auth-timeout:accept-deferral:review-bot'])
})

test('owner approve 必须是当前完整 head，旧 head fail-closed', () => {
  const stale = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding),
      event('alice', defer),
      event('zqchris', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head: oldHead })),
    ],
  })
  assert.equal(stale.satisfied, false)
  assert.match(stale.reason, /旧 head/)

  const current = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding),
      event('alice', defer),
      event('GaoWeiLiuXD', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head })),
    ],
  })
  assert.equal(current.satisfied, true)
})

test('撤回会使旧授权失效，随后新的授权才能恢复', () => {
  const withdrawn = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding),
      event('alice', defer, '2026-08-26T00:00:00Z'),
      event('review-bot', accept, '2026-08-26T00:01:00Z'),
      event('review-bot', productDispositionMarker({ finding: 'auth-timeout', action: 'withdraw', head }), '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(withdrawn.satisfied, false)

  const reaccepted = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding),
      event('alice', defer, '2026-08-26T00:00:00Z'),
      event('review-bot', accept, '2026-08-26T00:01:00Z'),
      event('review-bot', productDispositionMarker({ finding: 'auth-timeout', action: 'withdraw', head }), '2026-08-26T00:02:00Z'),
      event('review-bot', accept, '2026-08-26T00:03:00Z'),
    ],
  })
  assert.equal(reaccepted.satisfied, true)
})

test('malformed marker、未知 finding、越权 actor 一律 fail-closed', () => {
  const malformed = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', '<!-- filoai:product-disposition finding=x action=approve head=short -->')],
  })
  assert.equal(malformed.satisfied, false)
  assert.match(malformed.reason, /格式错误/)

  const unknown = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', defer.replace('auth-timeout', 'missing'))],
  })
  assert.equal(unknown.satisfied, false)
  assert.match(unknown.reason, /没有对应/)

  const wrongActor = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('review-bot', finding), event('bob', defer)],
  })
  assert.equal(wrongActor.satisfied, false)
  assert.match(wrongActor.reason, /只能由 PR 作者/)
})

test('编辑时间不改变事件顺序；只按 created_at 计时', () => {
  const markers = parseProductDecisionMarkers([
    { login: 'alice', body: defer, created_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-27T00:00:00Z' },
  ])
  assert.equal(markers[0].created_at, '2026-08-26T00:00:00Z')
  assert.equal(markers[0].event.updated_at, undefined)
})

