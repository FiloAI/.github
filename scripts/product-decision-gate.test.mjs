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
      pullRequestReview: { databaseId: 1234 },
    }] },
  }), {
    is_resolved: true, is_outdated: false, resolved_by: 'codex',
    comments: [{
      login: 'author', body: 'out of scope',
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      review_id: 1234,
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
    'This is not a separate concern; please address it in this PR.',
    '这个问题不能单独处理，必须在本 PR 修复。',
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

test('reviewer 直接要求合并前修复会撤回较早 acceptance', () => {
  for (const rejection of [
    'Actually, please fix this before merging.',
    'Please address the finding before merge.',
    '请在合并前修复这个问题。',
  ]) {
    const candidate = thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: 'Accepted as a separate concern; non-blocking.',
    })
    candidate.comments.push({
      login: 'codex', body: rejection,
      created_at: '2026-08-25T03:03:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, rejection)
  }
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

test('P2 和未曾 deferral 的真实修复回复不触发产品决策门', () => {
  for (const candidate of [
    thread({ severity: 'P2', authorReply: 'Out of scope.' }),
    thread({ authorReply: '已修复并补了回归测试。' }),
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true)
  }
})

test('outdated 只表示 diff 位置变化，不能清除作者关闭的 P0/P1 deferral', () => {
  const candidate = thread({
    authorReply: '这是产品取舍，不在本 PR 修。',
    outdated: true,
    resolvedBy: 'author',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('泛化 agree 不能把仍需修复的问题误判为接受 deferral', () => {
  for (const reviewerReply of [
    'I agree this is a problem and still needs work before merge.',
    'I agree the bug exists; it remains a blocker.',
    '我同意这是一个问题，合并前仍需修复。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: 'Out of scope; defer to a follow-up PR.',
        reviewerReply,
      })],
    }).satisfied, false, reviewerReply)
  }

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: 'I agree to this deferral as a separate follow-up; non-blocking.',
    })],
  }).satisfied, true)

  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments.push({
    login: 'codex', body: 'I agree this is a problem and it still needs work before merge.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
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

test('严重度变更使用目标值而不是 from 后的旧值', () => {
  const candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.push({
    login: 'codex', body: 'Escalating this finding from P2 to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  })
  assert.equal(result.satisfied, false)
  assert.equal(result.blockers[0].severity, 'P1')

  candidate.comments.push({
    login: 'codex', body: 'Downgrading this finding from P1 to P2.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
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

test('严重度跟随最新明确标记，支持 P1 降级 P2 后再升级 P1', () => {
  const candidate = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.push({
    login: 'codex', body: 'Downgrading this finding to P2.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments.push({
    login: 'codex', body: 'The earlier P1 concern is now informational.',
    created_at: '2026-08-25T03:02:30Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments.push({
    login: 'codex', body: 'Escalating this finding back to P1.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('只有原 finding reviewer 可以改变严重级别', () => {
  const p1Candidate = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  p1Candidate.comments.push({
    login: 'other-reviewer', body: 'Downgrading this finding to P2.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [p1Candidate],
  }).satisfied, false)

  p1Candidate.comments.push({
    login: 'codex', body: 'Downgrading this finding to P2.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [p1Candidate],
  }).satisfied, true)

  const p2Candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  p2Candidate.comments.push({
    login: 'other-reviewer', body: 'Escalating this finding to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [p2Candidate],
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

test('作者撤回 fixed claim 会使旧 reviewer 确认和旧 owner 放行失效', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.push(
    {
      login: 'author', body: 'Fixed and covered by regression tests.',
      created_at: '2026-08-25T03:02:00Z',
    },
    {
      login: 'codex', body: 'Confirmed fixed and resolved.',
      created_at: '2026-08-25T03:03:00Z',
    },
    {
      login: 'author', body: 'Correction: this is not fixed.',
      created_at: '2026-08-25T03:04:00Z',
    },
  )
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      login: 'zqchris', state: 'APPROVED', commit_id: head,
      submitted_at: '2026-08-25T03:03:30Z',
    }],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:05:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
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

test('同秒 CHANGES_REQUESTED 与 thread acceptance 无可靠跨来源顺序时保持阻塞', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z', review_id: 102,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      id: 101,
      login: 'codex', state: 'CHANGES_REQUESTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }, {
      id: 102,
      login: 'codex', state: 'COMMENTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }],
  }).satisfied, false)
})

test('CHANGES_REQUESTED 后的 fresh thread acceptance 可以放行', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:01Z', review_id: 102,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      id: 101,
      login: 'codex', state: 'CHANGES_REQUESTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }, {
      id: 102,
      login: 'codex', state: 'COMMENTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:01Z',
    }],
  }).satisfied, true)
})

test('同秒 thread acceptance 与 CHANGES_REQUESTED 无可靠跨来源顺序时保持阻塞', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z', review_id: 101,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      id: 101,
      login: 'codex', state: 'COMMENTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }, {
      id: 102,
      login: 'codex', state: 'CHANGES_REQUESTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }],
  }).satisfied, false)
})

test('跨来源同秒缺少可靠顺序时保持 fail-closed', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      login: 'codex', state: 'CHANGES_REQUESTED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }],
  }).satisfied, false)
})

test('同秒 thread comments 使用可靠顺序决定最终 disposition', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push(
    {
      login: 'codex', body: 'This remains a blocker.',
      created_at: '2026-08-25T03:02:00Z',
    },
    {
      login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
      created_at: '2026-08-25T03:02:00Z',
    },
  )
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments.push({
    login: 'codex', body: 'I retract that acceptance; this remains a blocker.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('编辑既有 deferral 使旧 acceptance 失效并要求 fresh acceptance', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[1].updated_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments.push({
    login: 'codex', body: 'I retract that acceptance; this remains a blocker.',
    created_at: '2026-08-25T03:05:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('Greptile 已接受的 deferral 经语义编辑后必须重新确认', () => {
  const candidate = thread({
    reviewer: 'greptile-apps[bot]',
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments.push({
    login: 'author', body: 'Fixed and covered by regression tests.',
    created_at: '2026-08-25T03:03:00Z',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: 'This is a broader product trade-off; defer it to a follow-up PR.',
    updated_at: '2026-08-25T03:04:00Z',
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'greptile-apps[bot]', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:05:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('作者把 fixed claim 编辑为 deferral 后不能复用旧修复确认', () => {
  const candidate = thread({
    authorReply: '已修复并补了回归测试。',
    reviewerReply: 'Confirmed fixed and resolved.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: 'Out of scope; defer to a follow-up PR.',
    updated_at: '2026-08-25T03:03:00Z',
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
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

test('作者 fixed claim 需要其后的 reviewer 明确确认，不能复用旧 resolution', () => {
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
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Confirmed fixed and resolved.',
    created_at: '2026-08-25T03:04:00Z',
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
  }).satisfied, true)
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
