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

function event(login, body, created_at = '2026-08-26T00:00:00Z', source = 'review') {
  return { login, body, created_at, source }
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
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
    ],
  })
  assert.equal(blocked.satisfied, false)
  assert.match(blocked.reason, /原 reviewer review-bot.*accept-deferral.*owner.*approve/)

  const accepted = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('review-bot', accept, '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(accepted.satisfied, true)
  assert.deepEqual(accepted.evidence, ['finding:auth-timeout:accept-deferral:review-bot'])
})

test('旧 head approval 不会短路后续当前 head approval', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('zqchris', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head: oldHead }), '2026-08-26T00:02:00Z'),
      event('GaoWeiLiuXD', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head }), '2026-08-26T00:03:00Z'),
    ],
  })
  assert.equal(result.satisfied, true)
})

test('旧 head approval 不单独阻塞，但没有当前 head approval 仍 fail-closed', () => {
  const stale = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('zqchris', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head: oldHead }), '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(stale.satisfied, false)
  assert.match(stale.reason, /没有原 reviewer.*approve/)

  const current = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('GaoWeiLiuXD', productDispositionMarker({ finding: 'auth-timeout', action: 'approve', head }), '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(current.satisfied, true)
})

test('撤回会使旧授权失效，随后新的授权才能恢复', () => {
  const withdrawn = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('review-bot', accept, '2026-08-26T00:02:00Z'),
      event('review-bot', productDispositionMarker({ finding: 'auth-timeout', action: 'withdraw', head }), '2026-08-26T00:03:00Z'),
    ],
  })
  assert.equal(withdrawn.satisfied, false)

  const reaccepted = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('review-bot', accept, '2026-08-26T00:02:00Z'),
      event('review-bot', productDispositionMarker({ finding: 'auth-timeout', action: 'withdraw', head }), '2026-08-26T00:03:00Z'),
      event('review-bot', accept, '2026-08-26T00:04:00Z'),
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
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('bob', defer, '2026-08-26T00:01:00Z'),
    ],
  })
  assert.equal(wrongActor.satisfied, false)
  assert.match(wrongActor.reason, /只能由 PR 作者/)
})

test('作者不能自己创建 finding 后自己接受延期', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', finding), event('alice', defer), event('alice', accept, '2026-08-26T00:01:00Z')],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /非作者 reviewer\/bot/)
})

test('普通 issue comment 不能创建授权 finding', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z', 'issue-comment'),
      event('alice', defer, '2026-08-26T00:01:00Z', 'issue-comment'),
      event('review-bot', accept, '2026-08-26T00:02:00Z', 'issue-comment'),
    ],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /必须来自 GitHub review/)
})

test('owner 作者的显式 defer 视为自身产品决定；撤回后仍然失效', () => {
  const accepted = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'zqchris',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('zqchris', defer, '2026-08-26T00:01:00Z'),
    ],
  })
  assert.equal(accepted.satisfied, true)

  const withdrawn = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'zqchris',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('zqchris', defer, '2026-08-26T00:01:00Z'),
      event('zqchris', productDispositionMarker({ finding: 'auth-timeout', action: 'withdraw', head }), '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(withdrawn.satisfied, false)
})

test('编辑旧评论不能插入 marker 倒签授权事件', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      {
        login: 'alice',
        body: defer,
        created_at: '2026-08-26T00:00:00Z',
        updated_at: '2026-08-27T00:00:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /评论已编辑/)
})

test('同秒 disposition 不建立跨来源顺序，要求重发最后动作', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('review-bot', finding, '2026-08-26T00:00:00Z'),
      event('alice', defer, '2026-08-26T00:01:00Z'),
      event('review-bot', accept, '2026-08-26T00:01:00Z'),
    ],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /同秒 disposition/)
})

test('finding 之前的 disposition 不得授权之后创建的 finding', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [
      event('alice', defer, '2026-08-26T00:00:00Z'),
      event('review-bot', accept, '2026-08-26T00:01:00Z'),
      event('review-bot', finding, '2026-08-26T00:02:00Z'),
    ],
  })
  assert.equal(result.satisfied, true)
  assert.deepEqual(result.evidence, [])
})

test('带协议提示但无法解析的 token 不会被静默丢弃', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', '<!-- typo filoai:product-disposition finding=x action=defer -->')],
  })
  assert.equal(result.satisfied, false)
  assert.match(result.reason, /格式错误/)
  assert.match(result.reason, /自由文本不能替代 marker/)
})

test('门禁诊断不输出可再次解析的 HTML marker', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('alice', '<!-- filoai:product-disposition finding=x action=approve head=short -->')],
  })
  assert.equal(result.satisfied, false)
  assert.doesNotMatch(result.reason, /<!--/)
})

test('普通文档或 bot 摘要提到 marker 名称时不当作协议输入', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'alice',
    events: [event('greptile-apps', '文档提到 filoai:finding 和 filoai:product-disposition，但没有发布 marker。')],
  })
  assert.equal(result.satisfied, true)
})
