import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bridgeEntriesFor,
  appendCiBridgeReason,
  consumeCiBridgeEvents,
  formatCiBridgeEvent,
  readCiBridge,
} from './ci-mainline-bridge.mjs'

test('读取并按时间淘汰过期 CI bridge 事件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-bridge-'))
  const file = path.join(dir, 'bridge.json')
  const now = Date.parse('2026-08-25T00:00:00Z')
  fs.writeFileSync(file, JSON.stringify({
    events: {
      fresh: { repo: 'FiloAI/filoai-frontend', pr: 3590, updatedAt: now },
      stale: { repo: 'FiloAI/filoai-frontend', pr: 1, updatedAt: now - 8 * 24 * 60 * 60 * 1000 },
    },
  }))
  const bridge = readCiBridge(file, now)
  assert.deepEqual(Object.keys(bridge.events), ['fresh'])
  assert.equal(bridgeEntriesFor('FiloAI/filoai-frontend', bridge)[0].pr, 3590)
})

test('格式化 CI bridge 事件包含 head、状态和失败检查', () => {
  assert.match(
    formatCiBridgeEvent({
      repo: 'FiloAI/filoai-frontend',
      pr: 3590,
      head: '6add7311372cb10082001965a736418940e9c58c',
      status: 'failed',
      checks: [{ name: 'PR · Dispatcher', conclusion: 'failure' }],
    }),
    /filoai-frontend#3590 head=6add7311372c CI 失败 \[PR · Dispatcher=failure\]/,
  )
})

test('同一 bridge 指纹只消费一次', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-bridge-ack-'))
  const ackFile = path.join(dir, 'consumed.json')
  const bridge = {
    version: 1,
    events: {
      'FiloAI/filoai-frontend#3590': {
        repo: 'FiloAI/filoai-frontend',
        pr: 3590,
        status: 'failed',
        fingerprint: 'head|summary=failure',
        updatedAt: Date.now(),
      },
    },
  }
  assert.equal(consumeCiBridgeEvents({ bridge, ackFile }).length, 1)
  assert.equal(consumeCiBridgeEvents({ bridge, ackFile }).length, 0)
})

test('当前 head 的 CI bridge 失败会补进 PR 阻塞原因，旧 head 不会污染', () => {
  const event = {
    status: 'failed',
    head: 'a'.repeat(40),
    checks: [{ name: 'PR · Dispatcher', conclusion: 'failure' }],
  }
  assert.match(
    appendCiBridgeReason('required checks 未通过: summary=failure', event, event.head, { liveCiFailed: true }),
    /PR · Dispatcher=failure.*head=aaaaaaaaaaaa/,
  )
  assert.equal(
    appendCiBridgeReason('unresolved review thread', event, event.head),
    'unresolved review thread',
  )
  assert.equal(
    appendCiBridgeReason('required checks 未通过: summary=failure', event, 'b'.repeat(40), { liveCiFailed: true }),
    'required checks 未通过: summary=failure',
  )
})
