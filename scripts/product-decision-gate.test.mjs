import assert from 'node:assert/strict'
import test from 'node:test'

import { ownerApprovalMarker } from './high-risk-review-gate.mjs'
import {
  evaluateProductDecisionGate,
  normalizeProductDecisionIssueComment,
  normalizeProductDecisionThread,
} from './product-decision-gate.mjs'

const head = '031a541a57944cf7dfcb772489a73f3d10866afa'

function thread({ severity = 'P1', authorReply, replyAuthor = 'author', reviewerReply = null, reviewer = 'codex', outdated = false, resolvedBy = replyAuthor }) {
  return {
    is_resolved: true,
    is_outdated: outdated,
    resolved_by: resolvedBy,
    comments: [
      { login: reviewer, body: `![${severity} Badge] ${severity} behavior regression`, created_at: '2026-08-25T03:00:00Z' },
      { login: replyAuthor, body: authorReply, created_at: '2026-08-25T03:01:00Z' },
      ...(reviewerReply ? [{ login: reviewer, body: reviewerReply, created_at: '2026-08-25T03:02:00Z' }] : []),
    ],
  }
}

test('live GitHub 字段归一化保留 created/updated 时间', () => {
  assert.deepEqual(normalizeProductDecisionIssueComment({
    user: { login: 'jerboy' }, body: 'approved',
    created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:01:00Z',
  }), {
    login: 'jerboy', body: 'approved',
    created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:01:00Z',
  })
  assert.deepEqual(normalizeProductDecisionThread({
    isResolved: true, isOutdated: false, resolvedBy: { login: 'codex' },
    comments: { nodes: [{
      author: { login: 'author' }, body: 'out of scope',
      createdAt: '2026-08-25T03:00:00Z', updatedAt: '2026-08-25T03:02:00Z',
    }] },
  }), {
    is_resolved: true, is_outdated: false, resolved_by: 'codex',
    comments: [{
      login: 'author', body: 'out of scope',
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
    }],
  })
})

test('非 owner 作者不能自行用产品决定关闭 P0/P1', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({ authorReply: '这是产品决定，不在本 PR 修。' })],
  })
  assert.equal(result.satisfied, false)
  assert.equal(result.needsOwnerReview, true)
  assert.deepEqual(result.blockers, [{ severity: 'P1', reviewer: 'codex', at: Date.parse('2026-08-25T03:01:00Z') }])
})

test('当前 head 的 owner 批准可以放行产品取舍', () => {
  for (const approval of [
    { reviews: [{ login: 'zqchris', state: 'APPROVED', commit_id: head, submitted_at: '2026-08-25T03:02:00Z' }] },
    { comments: [{ login: 'jerboy', body: ownerApprovalMarker(head), created_at: '2026-08-25T03:02:00Z' }] },
  ]) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })],
      ...approval,
    })
    assert.equal(result.satisfied, true)
  }
})

test('Chris 或 Bobo 自己提交时不要求交叉确认', () => {
  for (const authorLogin of ['zqchris', 'jerboy']) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin,
      threads: [thread({ authorReply: '产品取舍，不改。', replyAuthor: authorLogin })],
    })
    assert.equal(result.satisfied, true, authorLogin)
    assert.equal(result.evidence, `owner-author:${authorLogin}`, authorLogin)
  }
})

test('原 reviewer 明确接受范围解释后不再阻塞', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: '超出本 PR 范围，不改。',
      reviewerReply: 'Understood — this is a separate concern. Makes sense to keep the scope tight here.',
    })],
  })
  assert.equal(result.satisfied, true)
})

test('reviewer 明确否定接受时不能因关键词误放行', () => {
  for (const reviewerReply of [
    '我不同意，这仍然阻塞合并。',
    '我撤回同意。',
    "I don't accept this; it remains a blocker.",
    'I have not agreed to this deferral.',
    'I no longer agree.',
    'I withdraw my acceptance.',
    'Understood, but this still needs to be fixed before merge.',
  ]) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: '超出本 PR 范围，不改。',
        reviewerReply,
      })],
    })
    assert.equal(result.satisfied, false, reviewerReply)
  }
})

test('reviewer 只撤回阻止时仍可构成明确接受', () => {
  for (const reviewerReply of [
    '我撤回阻止，这个问题可以另开处理。',
    'I withdraw the blocker; accepted as a separate concern.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: '超出本 PR 范围，不改。',
        reviewerReply,
      })],
    }).satisfied, true, reviewerReply)
  }
})

test('reviewer 最新相关 disposition 覆盖较早接受', () => {
  const candidate = thread({
    authorReply: '超出本 PR 范围，不改。',
    reviewerReply: 'Accepted as a separate concern.',
  })
  candidate.comments.push({
    login: 'codex', body: 'I retract that acceptance; this remains a blocker.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({ authorReply: '不在本 PR 处理。' })],
    reviews: [
      {
        login: 'codex', state: 'APPROVED', commit_id: head,
        submitted_at: '2026-08-25T03:02:00Z',
      },
      {
        login: 'codex', state: 'CHANGES_REQUESTED', commit_id: head,
        submitted_at: '2026-08-25T03:03:00Z',
      },
    ],
  }).satisfied, false)
})

test('编辑旧 acceptance 不能覆盖后续 rejection', () => {
  const candidate = thread({
    authorReply: '超出本 PR 范围，不改。',
    reviewerReply: 'Accepted as a separate concern.',
  })
  candidate.comments[2].updated_at = '2026-08-25T03:04:00Z'
  candidate.comments.push({
    login: 'codex', body: 'This remains a blocker.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('reviewer 后续明确接受可以覆盖较早拒绝', () => {
  const candidate = thread({
    authorReply: '超出本 PR 范围，不改。',
    reviewerReply: 'This remains a blocker.',
  })
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('作者在 reviewer resolve 后编辑成产品取舍时不能复用旧 resolve', () => {
  const candidate = thread({
    authorReply: '已修复并补了测试。',
    resolvedBy: 'codex',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: '这是产品决定，不在本 PR 修。',
    updated_at: '2026-08-25T03:03:00Z',
  }
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  })
  assert.equal(result.satisfied, false)
})

test('旧 reviewer resolve 不能代替取舍后的明确接受', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: '这是产品决定，不在本 PR 修。',
      resolvedBy: 'codex',
    })],
  })
  assert.equal(result.satisfied, false)
})

test('否定产品取舍并说明已修复不会误触发硬门', () => {
  for (const authorReply of [
    '这不是产品决定，问题已经修复并补了回归测试。',
    'This is not a product decision; fixed and covered by tests.',
  ]) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    })
    assert.equal(result.satisfied, true, authorReply)
  }
})

test('P2、过时 finding 和真实修复回复不触发产品决策门', () => {
  for (const candidate of [
    thread({ severity: 'P2', authorReply: 'Out of scope.' }),
    thread({ authorReply: '产品决定，不改。', outdated: true }),
    thread({ authorReply: '已修复并补了回归测试。' }),
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true)
  }
})

test('P2 后的作者 deferral 在 finding 升级为 P1 后仍需授权', () => {
  const candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.push({
    login: 'codex', body: 'Escalating this finding to P1 because it changes product behavior.',
    created_at: '2026-08-25T03:02:00Z',
  })
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  })
  assert.equal(result.satisfied, false)
  assert.equal(result.blockers[0].severity, 'P1')
})

test('P2 deferral 的旧 acceptance 不能放行随后升级的 P1', () => {
  const candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments.push({
    login: 'codex', body: 'Escalating this finding to P1 because it changes product behavior.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'P1 deferral accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('否定式修复声明不能清除已有产品 deferral', () => {
  for (const body of [
    'This is not fixed.',
    "I haven't addressed the finding.",
    '该问题尚未处理。',
    '这个 finding 还没修复。',
  ]) {
    const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
    candidate.comments.push({
      login: 'author', body, created_at: '2026-08-25T03:03:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, body)
  }
})

test('同秒 APPROVED 与 thread rejection 以阻塞 disposition 为准', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'This remains a blocker.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      login: 'codex', state: 'APPROVED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }],
  }).satisfied, false)
})

test('编辑既有 deferral 保留 reviewer acceptance，后续 rejection 仍可重新阻塞', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[1].updated_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments.push({
    login: 'codex', body: 'I retract that acceptance; this remains a blocker.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('普通以后修措辞属于产品取舍延期', () => {
  for (const authorReply of [
    '这个问题会在后续修复。',
    '将在下个 PR 修复。',
    'I will fix this later.',
  ]) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    })
    assert.equal(result.satisfied, false, authorReply)
  }
})

test('reviewer 在作者真实修复后 resolve 会淘汰旧 deferral', () => {
  const candidate = thread({
    authorReply: 'Out of scope.',
    reviewerReply: 'This remains a blocker.',
    resolvedBy: 'codex',
  })
  candidate.comments.push({
    login: 'author', body: '已修复并补了回归测试。',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.resolved_by = 'author'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('旧 head owner 批准不能放行', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({ authorReply: '不在本 PR 处理。' })],
    reviews: [{ login: 'zqchris', state: 'APPROVED', commit_id: 'a'.repeat(40), submitted_at: '2026-08-25T03:02:00Z' }],
  })
  assert.equal(result.satisfied, false)
})

test('产品取舍之前的 owner 批准不能被复用', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({ authorReply: '这是产品决定，不在本 PR 修。' })],
    reviews: [{
      login: 'zqchris', state: 'APPROVED', commit_id: head,
      submitted_at: '2026-08-25T02:59:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
})

test('owner marker 必须晚于编辑后的产品取舍', () => {
  const candidate = thread({ authorReply: '已修复并补了测试。' })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: 'Out of scope; defer to a follow-up PR.',
    updated_at: '2026-08-25T03:05:00Z',
  }
  for (const created_at of ['2026-08-25T03:04:00Z', '2026-08-25T03:06:00Z']) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      comments: [{ login: 'jerboy', body: ownerApprovalMarker(head), created_at }],
    })
    assert.equal(result.satisfied, created_at.endsWith('06:00Z'), created_at)
  }
})
