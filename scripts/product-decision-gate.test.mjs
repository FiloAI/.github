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
    edits: [], edits_complete: true,
  })
  assert.deepEqual(normalizeProductDecisionIssueComment({
    author: { login: 'jerboy' }, body: 'approved after edit',
    createdAt: '2026-08-25T03:00:00Z', updatedAt: '2026-08-25T03:02:00Z',
    userContentEdits: {
      pageInfo: { hasNextPage: false },
      nodes: [{ editedAt: '2026-08-25T03:02:00Z', diff: 'approved after edit' }],
    },
  }), {
    login: 'jerboy', body: 'approved after edit',
    created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
    edits: [{ edited_at: '2026-08-25T03:02:00Z', diff: 'approved after edit' }],
    edits_complete: true,
  })
  assert.deepEqual(normalizeProductDecisionThread({
    isResolved: true, isOutdated: false, resolvedBy: { login: 'codex' },
    comments: { nodes: [{
      author: { login: 'author' }, body: 'out of scope',
      createdAt: '2026-08-25T03:00:00Z', updatedAt: '2026-08-25T03:02:00Z',
      pullRequestReview: { databaseId: 1234 },
      userContentEdits: {
        pageInfo: { hasNextPage: false },
        nodes: [{ editedAt: '2026-08-25T03:02:00Z', diff: 'out of scope' }],
      },
    }] },
  }), {
    is_resolved: true, is_outdated: false, resolved_by: 'codex',
    comments: [{
      login: 'author', body: 'out of scope',
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      review_id: 1234,
      edits: [{ edited_at: '2026-08-25T03:02:00Z', diff: 'out of scope' }],
      edits_complete: true,
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

test('by-design 产品取舍必须取得 reviewer 或 current-head owner 放行', () => {
  for (const authorReply of [
    'This is by design; no change needed.',
    'This is expected behavior.',
    'We will keep this as-is.',
    'This is working as intended; no changes needed.',
    'This is intended behavior.',
    'No changes are needed.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    }).satisfied, false, authorReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply,
        reviewerReply: 'Accepted as a product trade-off; non-blocking.',
      })],
    }).satisfied, true, authorReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
      reviews: [{
        login: 'zqchris', state: 'APPROVED', commit_id: head,
        submitted_at: '2026-08-25T03:02:00Z',
      }],
    }).satisfied, true, authorReply)
  }
})

test('否定 by-design 取舍并声明修复不会误触发产品决策门', () => {
  for (const authorReply of [
    'This is not by design; fixed and covered by tests.',
    'This is not expected behavior; fixed and covered by tests.',
    'We should not keep this as-is; fixed and covered by tests.',
    'The expected behavior is restored; fixed and covered by tests.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    }).satisfied, true, authorReply)
  }
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

test('孤立 non-blocking 说明不能冒充 reviewer 接受产品取舍', () => {
  for (const reviewerReply of [
    'The CI failure is non-blocking.',
    'The test failure is not a blocker.',
    'This general risk is non-blocking.',
    'The CI failure for this finding is non-blocking.',
    "This finding's test failure is not a blocker.",
    'This finding may be non-blocking.',
    'This deferral is probably non-blocking.',
    'CI 不阻塞合并。',
    '测试失败属于非阻塞风险。',
    '这个 finding 的 CI 失败不阻塞合并。',
    '这个产品取舍可能不阻塞合并。',
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
})

test('明确绑定 finding 或产品取舍的 non-blocking 说明仍可接受', () => {
  for (const reviewerReply of [
    'This finding is non-blocking.',
    'The proposed deferral is not a blocker.',
    'This product trade-off is non-blocking.',
    'The current scope decision is not a blocker.',
    'This separate concern is non-blocking.',
    'Non-blocking for this finding.',
    '这个产品取舍不再阻塞。',
    '当前 finding 属于非阻塞。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: 'Out of scope; defer to a follow-up PR.',
        reviewerReply,
      })],
    }).satisfied, true, reviewerReply)
  }
})

test('仅限 CI 或测试的 non-blocking 说明不能接受产品取舍', () => {
  for (const reviewerReply of [
    'This finding is non-blocking in CI only.',
    'This finding is non-blocking in CI.',
    'The proposed deferral is not a blocker for tests only.',
    'This product trade-off is non-blocking only in CI.',
    'This separate concern is non-blocking only if CI passes.',
    'The current scope decision is non-blocking. In CI only.',
    'The current scope decision is non-blocking. Subject to the CI check.',
    '这个产品取舍不阻塞，仅限 CI。',
    '当前 finding 属于非阻塞，但只针对测试。',
    '这个延期决定不阻塞，但前提是 CI 通过。',
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
})

test('reviewer 明确否定接受时不能因关键词误放行', () => {
  for (const reviewerReply of [
    '我不同意，这仍然阻塞合并。',
    '我撤回同意。',
    "I don't accept this; it remains a blocker.",
    'I have not agreed to this deferral.',
    "I haven't accepted this as a separate concern.",
    "The reviewer hasn't agreed to this as a separate concern.",
    "We hadn't accepted this as a separate concern.",
    'I haven’t agreed to this deferral.',
    'The reviewer hasn’t accepted this as a separate concern.',
    'We hadn’t agreed to this deferral.',
    'I no longer agree.',
    'I withdraw my acceptance.',
    'Understood, but this still needs to be fixed before merge.',
    'This is not a separate concern; please address it in this PR.',
    '这个问题不能单独处理，必须在本 PR 修复。',
    'I do not consider this non-blocking; please fix it before merge.',
    '我不认为这是非阻塞问题，必须在本 PR 修复。',
    'I cannot confirm this is fixed.',
    'I have not verified this is resolved.',
    'I have not withdrawn the objection.',
    "I haven't withdrawn the blocker.",
    'I did not retract the concern.',
    'I did not accept this as a separate concern.',
    "I didn't agree to this deferral.",
    'I never agreed to this deferral.',
    'We never accepted this as a separate concern.',
    'I had never accepted this as a separate concern.',
    'We were not accepting this as a separate concern.',
    'The objection has not been withdrawn.',
    '我无法确认已经修复。',
    '我尚未核实问题已解决。',
    "I'm not accepting this as a separate concern.",
    "We're not agreeing to this deferral.",
    'I am not accepting this as a separate issue.',
    'I am not willing to accept this as a separate concern.',
    'I am not ready to accept this as a separate concern.',
    'We are not prepared to agree to this deferral.',
    'I cannot currently accept this as a separate concern.',
    'I do not yet accept this as a separate concern.',
    "I can't now agree to this deferral.",
    'I am unwilling to accept this as a separate concern.',
    'I am currently unable to accept this as a separate concern.',
    'I am not yet accepting this as a separate concern.',
    'We are still not agreeing to this deferral.',
    'I am not in a position to accept this as a separate concern.',
    "I don't think we should accept this as a separate concern.",
    'I do not believe we can agree to this deferral.',
    "I wouldn't accept this as a separate concern.",
    'We would not be willing to agree to this deferral.',
    'I could not currently accept this as a separate concern.',
    'I am hesitant to accept this as a separate concern.',
    'We are not sure we can agree to this deferral.',
    'I would hesitate to accept this as a separate concern.',
    'I am not comfortable treating this as a separate concern.',
    'We are uncomfortable handling this as a separate concern.',
    'I am uneasy about regarding this as a separate concern.',
    'I am hesitant to treat this as a separate concern.',
    'We are reluctant to handle this as a separate concern.',
    'I would not be comfortable treating this as a separate concern.',
    'I would only be comfortable treating this as a separate concern if the owner approves.',
    'I am comfortable treating this as a separate concern only if the owner approves.',
    'I do not support treating this as a separate concern.',
    "I can't support handling this as a separate concern.",
    'We do not currently support treating this as a separate concern.',
    'We do not yet support treating this as a separate concern.',
    'I cannot continue to support handling this as a separate concern.',
    'I no longer support treating this as a separate concern.',
    'I am unable to support handling this as a separate concern.',
    'I support not treating this as a separate concern.',
    'We endorse the proposal not to handle this as a separate concern.',
    '我不支持把它作为独立问题处理。',
    '我不再支持把它作为独立问题处理。',
    '我支持不要把它作为独立问题处理。',
    'I would only accept this as a separate concern if the owner approves.',
    'I can accept this as a separate concern only if the migration lands.',
    'I accept this as a separate concern subject to owner approval.',
    'If the owner signs off, I accept this as a separate concern.',
    "I don't see how we can accept this as a separate concern.",
    'We cannot see why we should agree to this deferral.',
    'I am not convinced we should accept this as a separate concern.',
    'There is no basis to accept this as a separate concern.',
    'We have no grounds to agree to this deferral.',
    'Confirmed this is not fixed.',
    'Verified this is not resolved.',
    "Confirmed this isn't addressed.",
    'Verified this has not been resolved.',
    "Confirmed the finding hasn't been fixed.",
    'Confirmed this is not yet fully fixed.',
    'Verified this has yet to be resolved.',
    'Confirmed this is far from fixed.',
    'Verified this is anything but resolved.',
    'Verified this remains unresolved.',
    'Confirmed this is still unaddressed.',
    '确认仍未修复。',
    '核实尚未解决。',
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
    'I have withdrawn the blocker; non-blocking.',
    'We retract the objection.',
    '我们已收回异议。',
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

test('reviewer 仅表示愿意或可能撤回时不能当作已经撤回', () => {
  for (const reviewerReply of [
    'I do not refuse to withdraw the blocker.',
    'I am willing to withdraw the blocker.',
    'I may withdraw the blocker.',
    'We are ready to retract the objection.',
    '我不拒绝撤回阻止。',
    '我愿意撤回阻止。',
    '我可能收回异议。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: '超出本 PR 范围，不改。',
        reviewerReply,
      })],
    }).satisfied, false, reviewerReply)
  }
})

test('reviewer 带 willing 或 ready 的肯定接受仍可放行', () => {
  for (const reviewerReply of [
    'I am willing to accept this as a separate concern.',
    'I am ready to accept this as a separate concern.',
    'We are prepared to agree to this deferral.',
    'I am comfortable treating this as a separate concern.',
    'We are willing to handle this as a separate concern.',
    'I am not uncomfortable treating this as a separate concern.',
    'I would be comfortable treating this as a separate concern if useful.',
    'I am comfortable treating this as a separate concern if helpful.',
    'I support treating this as a separate concern.',
    'We endorse handling this as a separate concern.',
    '我支持把它作为独立问题处理。',
    'I accepted this as a separate concern.',
    'I agreed to this deferral.',
    'I accept this as a separate concern and can file a follow-up if useful.',
    'I agree to this deferral; I can add more detail later if needed.',
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

test('reviewer 对 fixed claim 的肯定确认仍可放行', () => {
  for (const reviewerReply of [
    'Confirmed this is fixed and resolved.',
    'Verified this has been resolved.',
    'Confirmed this is not only fixed but also resolved.',
    'Confirmed this is fixed, not unresolved.',
  ]) {
    const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
    candidate.comments.push({
      login: 'author', body: 'Fixed this and added tests.',
      created_at: '2026-08-25T03:02:00Z',
    })
    candidate.comments.push({
      login: 'codex', body: reviewerReply,
      created_at: '2026-08-25T03:03:00Z',
    })

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, reviewerReply)
  }
})

test('reviewer 对 fixed claim 的否定确认继续保留产品取舍门', () => {
  for (const reviewerReply of [
    'Confirmed this is not fixed.',
    'Verified this is not resolved.',
    "Confirmed this wasn't addressed.",
    "Verified the issue hasn't been resolved.",
    'Confirmed this has yet to be fixed.',
    'Verified this is far from resolved.',
    'Confirmed this is anything but addressed.',
    'Confirmed this remains unfixed.',
    '确认仍未修复。',
  ]) {
    const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
    candidate.comments.push({
      login: 'author', body: 'Fixed this and added tests.',
      created_at: '2026-08-25T03:02:00Z',
    })
    candidate.comments.push({
      login: 'codex', body: reviewerReply,
      created_at: '2026-08-25T03:03:00Z',
    })

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, reviewerReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      reviews: [{
        login: 'zqchris', state: 'APPROVED', commit_id: head,
        submitted_at: '2026-08-25T03:04:00Z',
      }],
    }).satisfied, true, reviewerReply)
  }
})

test('reviewer 否定撤回会覆盖较早 acceptance', () => {
  for (const reviewerReply of [
    'I have not withdrawn the objection.',
    "I haven't withdrawn the blocker.",
    'The objection has not been withdrawn.',
  ]) {
    const candidate = thread({
      authorReply: '超出本 PR 范围，不改。',
      reviewerReply: 'I withdraw the blocker; accepted as a separate concern.',
    })
    candidate.comments.push({
      login: 'codex', body: reviewerReply,
      created_at: '2026-08-25T03:03:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, reviewerReply)
  }
})

test('reviewer 未来时态明确不撤回 blocker 时继续阻塞', () => {
  for (const reviewerReply of [
    'I will not withdraw the blocker.',
    "I won't withdraw the blocker.",
    'I shall not retract the objection.',
    'I will not be withdrawing the blocker.',
    'I will never retract the objection.',
    "I'm not withdrawing the blocker.",
    "We're not retracting the objection.",
    "They aren't retracting the concern.",
    'I am not going to withdraw the blocker.',
    'I am not planning to retract the concern.',
    'I do not intend to withdraw the request for changes.',
    "I don't plan to retract the concern.",
    'I have no intention of withdrawing the blocker.',
    'I have no plans to retract the concern.',
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
})

test('reviewer 明确拒绝撤回 blocker 时继续阻塞', () => {
  for (const reviewerReply of [
    'I refuse to withdraw the blocker.',
    'I declined to retract the objection.',
    'We have refused to withdraw the request for changes.',
    "I've declined to retract the concern.",
    'I am refusing to withdraw the blocker.',
    'I am unwilling to withdraw the blocker.',
    'We are not willing to retract the objection.',
    '我拒绝撤回阻止。',
    '我不愿收回异议。',
    '我不愿意撤回阻塞。',
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
})

test('reviewer 后续肯定撤回可覆盖较早的明确拒绝', () => {
  for (const reviewerReply of [
    'I refuse to withdraw the blocker.',
    'I am unwilling to retract the objection.',
    '我拒绝撤回阻止。',
  ]) {
    const candidate = thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply,
    })
    candidate.comments.push({
      login: 'codex', body: 'I have withdrawn the blocker; accepted as a separate concern.',
      created_at: '2026-08-25T03:03:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, reviewerReply)
  }
})

test('reviewer 后续肯定撤回可覆盖较早的未来不撤回声明', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'I will not withdraw the blocker.',
  })
  candidate.comments.push({
    login: 'codex', body: 'I have withdrawn the blocker; non-blocking.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('辅助产物无需改动不能覆盖明确的实现修复', () => {
  for (const authorReply of [
    'No changes are needed to the tests; fixed the implementation.',
    'No change is needed for the documentation; addressed the issue.',
  ]) {
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply,
        reviewerReply: 'Confirmed fixed and resolved.',
      })],
    })
    assert.equal(result.satisfied, true, authorReply)
  }
})

test('否定 follow-up 或 separate PR 不会误记为产品延期', () => {
  for (const authorReply of [
    'No follow-up issue is needed; fixed here.',
    'We do not need a separate PR; fixed in this PR.',
    'A follow-up pull request is not required; fixed here.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply,
        reviewerReply: 'Confirmed fixed and resolved.',
      })],
    }).satisfied, true, authorReply)
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

test('reviewer 后续否定 support 覆盖较早 acceptance，后续明确支持可再放行', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern.',
  })
  candidate.comments.push({
    login: 'codex', body: "I can't support handling this as a separate concern.",
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'I support treating this as a separate concern.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('reviewer 过去时否定覆盖较早 acceptance，后续明确接受可再放行', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern.',
  })
  candidate.comments.push({
    login: 'codex', body: 'I never agreed to this deferral.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'I accepted this as a separate concern.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('同一 reviewer 评论按最后一个明确 disposition 判定', () => {
  for (const [reviewerReply, satisfied] of [
    ['I accepted this as a separate concern before, but I did not accept this as a separate concern now.', false],
    ['I did not accept this as a separate concern before, but I accept this as a separate concern now.', true],
    ['I agreed to this deferral before; I never agreed to this deferral after the update.', false],
    ['I never agreed to this deferral before; I agree to this deferral now.', true],
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: 'Out of scope; defer to a follow-up PR.',
        reviewerReply,
      })],
    }).satisfied, satisfied, reviewerReply)
  }
})

test('reviewer 把旧 acceptance 编辑为更新 rejection 时按有效编辑时间阻塞', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'This remains a blocker.',
  })
  candidate.comments[2] = {
    ...candidate.comments[2],
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{
      edited_at: '2026-08-25T03:04:00Z',
      diff: 'Accepted as a separate concern; non-blocking.',
    }],
  }
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('较早位置的 reviewer comment 后编辑为 rejection 可否定后续 acceptance', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'This remains a blocker.',
  })
  candidate.comments[2] = {
    ...candidate.comments[2],
    updated_at: '2026-08-25T03:06:00Z',
    edits: [{
      edited_at: '2026-08-25T03:06:00Z',
      diff: 'Accepted as a separate concern; non-blocking.',
    }],
  }
  candidate.comments.push(
    {
      login: 'author', body: 'Fixed this finding.',
      created_at: '2026-08-25T03:03:00Z',
    },
    {
      login: 'codex', body: 'Confirmed fixed and resolved.',
      created_at: '2026-08-25T03:04:00Z',
    },
  )

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:07:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
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

test('reviewer 明确反对 separate-concern 处理不能命中 acceptance', () => {
  for (const rejection of [
    'I disagree that this is a separate concern; fix it.',
    'I disagree with treating this as a separate concern.',
    'I oppose accepting this as a separate concern.',
    'I oppose treating this separately.',
    'I am against treating this as a separate concern.',
    'I am against handling this separately.',
    'My opposition to separate handling remains.',
    'I reject treating this as a separate concern.',
    'I object to treating this as a separate concern.',
    'I refuse to accept this as a separate concern.',
    'I decline to accept this as a separate concern.',
    'I DECLINED TO ACCEPT this as a separate concern.',
    'My refusal to accept this as a separate concern remains unchanged.',
    '我反对把它作为独立问题处理。',
    '我不赞成单独处理这个取舍。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: 'Out of scope; defer to a follow-up PR.',
        reviewerReply: rejection,
      })],
    }).satisfied, false, rejection)
  }

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: "I don't object to treating this as a separate concern.",
    })],
  }).satisfied, true)
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: "I don't disagree that this is a separate concern.",
    })],
  }).satisfied, true)
  for (const reviewerReply of [
    "I don't oppose treating this as a separate concern.",
    'I am not against treating this as a separate concern.',
    'I am not opposed to treating this as a separate concern.',
    'I have no opposition to treating this as a separate concern.',
    '我不反对单独处理这个取舍。',
    '我不是反对；我接受单独处理这个取舍。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: 'Out of scope; defer to a follow-up PR.',
        reviewerReply,
      })],
    }).satisfied, true, reviewerReply)
  }
})

test('refuse/decline rejection 遵循 reviewer 时序且 current-head owner 可放行', () => {
  const rejectedThenAccepted = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'I refuse to accept this as a separate concern.',
  })
  rejectedThenAccepted.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [rejectedThenAccepted],
  }).satisfied, true)

  const acceptedThenRejected = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  acceptedThenRejected.comments.push({
    login: 'codex', body: 'I decline to accept this as a separate concern.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [acceptedThenRejected],
  }).satisfied, false)

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [acceptedThenRejected],
    reviews: [{
      login: 'zqchris', state: 'APPROVED', commit_id: head,
      submitted_at: '2026-08-25T03:04:00Z',
    }],
  }).satisfied, true)
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

test('未标 severity 的 finding 在作者 deferral 后标为 P1 仍需授权', () => {
  const candidate = {
    is_resolved: true,
    is_outdated: false,
    resolved_by: 'author',
    comments: [
      {
        login: 'codex', body: 'This behavior changes the product contract.',
        created_at: '2026-08-25T03:00:00Z',
      },
      {
        login: 'author', body: 'Out of scope; defer to a follow-up PR.',
        created_at: '2026-08-25T03:01:00Z',
      },
      {
        login: 'codex', body: 'Marking this finding as P1.',
        created_at: '2026-08-25T03:02:00Z',
      },
    ],
  }

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

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

test('finding severity 始终归属原始 reviewer，不被中途参与者抢占', () => {
  const candidate = {
    is_resolved: true,
    is_outdated: false,
    resolved_by: 'author',
    comments: [
      {
        login: 'codex', body: 'This behavior changes the product contract.',
        created_at: '2026-08-25T03:00:00Z',
      },
      {
        login: 'author', body: 'Out of scope; defer to a follow-up PR.',
        created_at: '2026-08-25T03:01:00Z',
      },
      {
        login: 'other-reviewer', body: 'I would classify this as P2.',
        created_at: '2026-08-25T03:02:00Z',
      },
      {
        login: 'codex', body: 'P1: this product behavior must remain gated.',
        created_at: '2026-08-25T03:03:00Z',
      },
    ],
  }

  const blocked = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  })
  assert.equal(blocked.satisfied, false)
  assert.deepEqual(blocked.blockers.map(({ severity, reviewer }) => ({ severity, reviewer })), [
    { severity: 'P1', reviewer: 'codex' },
  ])

  candidate.comments.push({
    login: 'other-reviewer', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:04:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
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

test('P3 严重度生命周期保留 deferral，最终只 gate P0/P1', () => {
  const escalated = thread({
    severity: 'P3',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  escalated.comments.push({
    login: 'codex', body: 'Escalating this finding from P3 to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  const escalatedResult = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [escalated],
  })
  assert.equal(escalatedResult.satisfied, false)
  assert.equal(escalatedResult.blockers[0].severity, 'P1')

  const downgraded = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  downgraded.comments.push({
    login: 'codex', body: 'Downgrading this finding from P1 to P3.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [downgraded],
  }).satisfied, true)
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

test('promoting 或 raising 的严重度升级进入 P1 产品取舍门', () => {
  for (const severityUpdate of [
    'Promoting this from P2 to P1.',
    'Raising this finding from P2 to P1.',
    'Promoted this finding to P1.',
    'Raised this from P2 to P1.',
  ]) {
    const candidate = thread({
      severity: 'P2',
      authorReply: 'Out of scope; defer to a follow-up PR.',
    })
    candidate.comments.push({
      login: 'codex', body: severityUpdate,
      created_at: '2026-08-25T03:02:00Z',
    })
    const result = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    })
    assert.equal(result.satisfied, false, severityUpdate)
    assert.equal(result.blockers[0].severity, 'P1', severityUpdate)
  }
})

test('should be 严重度变更使用目标级别而不是最后出现的否定级别', () => {
  const escalated = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  escalated.comments.push({
    login: 'codex', body: 'This should be P1, not P2.',
    created_at: '2026-08-25T03:02:00Z',
  })
  const escalatedResult = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [escalated],
  })
  assert.equal(escalatedResult.satisfied, false)
  assert.equal(escalatedResult.blockers[0].severity, 'P1')

  const downgraded = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  downgraded.comments.push({
    login: 'codex', body: 'This should be P2, not P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [downgraded],
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

test('编辑后的 severity 按有效时间覆盖线程位置', () => {
  const editedToP1 = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  editedToP1.comments[0] = {
    ...editedToP1.comments[0],
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{
      edited_at: '2026-08-25T03:04:00Z',
      diff: '![P2 Badge] P2 behavior regression',
    }],
  }
  editedToP1.comments.splice(1, 0, {
    login: 'codex', body: 'Downgrading this finding from P1 to P2.',
    created_at: '2026-08-25T03:02:00Z',
  })
  editedToP1.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [editedToP1],
  }).satisfied, false)

  const editedToP2 = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  editedToP2.comments[0] = {
    ...editedToP2.comments[0],
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{
      edited_at: '2026-08-25T03:04:00Z',
      diff: '![P1 Badge] P1 behavior regression',
    }],
  }
  editedToP2.comments.splice(1, 0, {
    login: 'codex', body: 'Escalating this finding from P2 to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  editedToP2.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [editedToP2],
  }).satisfied, true)
})

test('severity 未变化的说明编辑不会重排严重度生命周期', () => {
  const keepP1 = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  keepP1.comments[0] = {
    ...keepP1.comments[0],
    body: '![P2 Badge] P2 behavior regression with clarified context',
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{ body: '![P2 Badge] P2 behavior regression' }],
  }
  keepP1.comments.splice(1, 0, {
    login: 'codex', body: 'Escalating this finding from P2 to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  keepP1.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [keepP1],
  }).satisfied, false)

  const keepP3 = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  keepP3.comments[0] = {
    ...keepP3.comments[0],
    body: '![P1 Badge] P1 behavior regression with clarified context',
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{ body: '![P1 Badge] P1 behavior regression' }],
  }
  keepP3.comments.splice(1, 0, {
    login: 'codex', body: 'Downgrading this finding from P1 to P3.',
    created_at: '2026-08-25T03:02:00Z',
  })
  keepP3.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [keepP3],
  }).satisfied, true)
})

test('编辑新增 severity 时按编辑后的有效时间排序', () => {
  const editedToP1 = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  editedToP1.comments[0] = {
    ...editedToP1.comments[0],
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{ body: 'Behavior regression without a severity label.' }],
  }
  editedToP1.comments.splice(1, 0, {
    login: 'codex', body: 'Downgrading this finding to P3.',
    created_at: '2026-08-25T03:02:00Z',
  })
  editedToP1.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [editedToP1],
  }).satisfied, false)

  const editedToP3 = thread({
    severity: 'P3',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  editedToP3.comments[0] = {
    ...editedToP3.comments[0],
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{ body: 'Behavior regression without a severity label.' }],
  }
  editedToP3.comments.splice(1, 0, {
    login: 'codex', body: 'Escalating this finding to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  editedToP3.comments[2].created_at = '2026-08-25T03:03:00Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [editedToP3],
  }).satisfied, true)
})

test('severity 同秒并列时保守保留 P0/P1', () => {
  const candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments[0] = {
    ...candidate.comments[0],
    updated_at: '2026-08-25T03:02:00Z',
    edits: [{
      edited_at: '2026-08-25T03:02:00Z',
      diff: '![P1 Badge] P1 behavior regression',
    }],
  }
  candidate.comments.splice(1, 0, {
    login: 'codex', body: 'Escalating this finding from P2 to P1.',
    created_at: '2026-08-25T03:02:00Z',
  })
  candidate.comments[2].created_at = '2026-08-25T03:03:00Z'

  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  })
  assert.equal(result.satisfied, false)
  assert.equal(result.blockers[0].severity, 'P1')
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

test('旧 review 的序号不能让同秒 current-head APPROVED 覆盖 thread rejection', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments.push({
    login: 'codex', body: 'This remains a blocker.',
    created_at: '2026-08-25T03:02:00Z', review_id: 101,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
    reviews: [{
      id: 101,
      login: 'codex', state: 'COMMENTED', commit_id: 'old-head',
      submitted_at: '2026-08-25T02:00:00Z',
    }, {
      id: 102,
      login: 'codex', state: 'APPROVED', commit_id: head,
      submitted_at: '2026-08-25T03:02:00Z',
    }],
  }).satisfied, false)
})

test('同秒 CHANGES_REQUESTED 后关联到后续 review 的 thread acceptance 可以放行', () => {
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
  }).satisfied, true)
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

test('同秒 acceptance 必须在线程中严格晚于 author disposition', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  candidate.comments[1].created_at = '2026-08-25T03:02:00Z'
  candidate.comments.splice(1, 0, {
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z',
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

test('同秒 acceptance 必须在线程中严格晚于 P2 到 P1 escalation', () => {
  const candidate = thread({
    severity: 'P2',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.push(
    {
      login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
      created_at: '2026-08-25T03:02:00Z',
    },
    {
      login: 'codex', body: 'Escalating this finding from P2 to P1.',
      created_at: '2026-08-25T03:02:00Z',
    },
  )

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.push({
    login: 'codex', body: 'P1 deferral accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('severity 语义编辑与 acceptance 同秒时无法证明顺序，继续 fail-closed', () => {
  const candidate = thread({
    severity: 'P1',
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments[0] = {
    ...candidate.comments[0],
    updated_at: '2026-08-25T03:02:00Z',
    edits: [{ body: '![P2 Badge] P2 behavior regression' }],
  }
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:02:00Z',
  })

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

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

test('deferral 的错字或格式编辑不会清除已有 acceptance', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: '**Out of scope** — defer to a follow-up PR.',
    updated_at: '2026-08-25T03:03:00Z',
    edits: [
      { body: '**Out of scope** — defer to a follow-up PR.' },
      { body: 'Out of scope; defer to a follow-up PR.' },
    ],
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments[1] = {
    ...candidate.comments[1],
    body: '**Out of scpoe** — defer to a follow-up PR.',
    edits: [
      { body: '**Out of scpoe** — defer to a follow-up PR.' },
      { body: 'Out of scope; defer to a follow-up PR.' },
    ],
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments[1] = {
    ...candidate.comments[1],
    body: '**Out of scpoe** — defer to a follow-up PR.',
    updated_at: '2026-08-25T03:04:00Z',
    edits: [{ edited_at: '2026-08-25T03:04:00Z', diff: '**' }],
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('长篇 deferral 的有界编辑距离保留阈值内 acceptance 并拒绝阈值外复用', () => {
  const prefix = 'Out of scope; defer to a follow-up PR. '
  const original = `${prefix}${'a'.repeat(10_000)}`
  const candidate = thread({
    authorReply: original,
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    body: `${prefix}${'a'.repeat(9_994)}${'b'.repeat(6)}`,
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{ body: original }],
  }

  const startedAt = performance.now()
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
  assert.ok(performance.now() - startedAt < 1_000, '长文本比较应受阈值带宽约束')

  candidate.comments[1].body = `${prefix}${'a'.repeat(9_993)}${'b'.repeat(7)}`
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('UserContentEdit patch 的格式或错字编辑不会清除已有 acceptance', () => {
  for (const { body, diff } of [
    {
      body: '**Out of scope** — defer to a follow-up PR.',
      diff: '@@ -1 +1 @@\n-Out of scope; defer to a follow-up PR.\n+**Out of scope** — defer to a follow-up PR.',
    },
    {
      body: 'Out of scope; defer to a followup PR.',
      diff: '@@ -1 +1 @@\n-Out of scope; defer to a follow-up PR.\n+Out of scope; defer to a followup PR.',
    },
    {
      body: 'Out of scope; defer to a follow-up PR. Clarified details.',
      diff: '@@ -1 +1 @@\n-Original background.\n+Clarified background.',
    },
  ]) {
    const candidate = thread({
      authorReply: body,
      reviewerReply: 'Accepted as a separate concern; non-blocking.',
    })
    candidate.comments[1] = {
      ...candidate.comments[1],
      updated_at: '2026-08-25T03:03:00Z',
      edits: [{ edited_at: '2026-08-25T03:03:00Z', diff }],
      edits_complete: true,
    }
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, diff)
  }
})

test('severity 的完整格式 patch 不会把 P1 evidence boundary 推到 acceptance 之后', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[0] = {
    ...candidate.comments[0],
    body: '**![P1 Badge] P1 behavior regression**',
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{
      diff: '@@ -1 +1 @@\n-![P1 Badge] P1 behavior regression\n+**![P1 Badge] P1 behavior regression**',
    }],
    edits_complete: true,
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)

  candidate.comments[0].edits = [{ diff: '@@ -1 +1 @@\n+**![P1 Badge] P1 behavior regression**' }]
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)
})

test('UserContentEdit patch 只有可证明的 disposition 改写才推进 evidence boundary', () => {
  const candidate = thread({
    authorReply: 'Fixed and covered by regression tests.',
    reviewerReply: 'Accepted as a separate concern; non-blocking.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{
      edited_at: '2026-08-25T03:03:00Z',
      diff: '@@ -1 +1 @@\n-Out of scope; defer to a follow-up PR.\n+Fixed and covered by regression tests.',
    }],
    edits_complete: true,
  }
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
})

test('reviewer 的单边 patch 不能伪造为 deferral 之后的新 acceptance', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments.splice(1, 0, {
    login: 'codex',
    body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:00:30Z',
    updated_at: '2026-08-25T03:02:00Z',
    edits: [{ diff: '@@ -1 +1 @@\n+Accepted as a separate concern; non-blocking.' }],
    edits_complete: true,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments[1].edits = [{
    diff: '@@ -1 +1 @@\n-This remains a blocker.\n+Accepted as a separate concern; non-blocking.',
  }]
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('不完整、空或单边 patch 编辑保持 fail-closed', () => {
  for (const edit of [
    { edits_complete: false, edits: [{ diff: '@@ -1 +1 @@\n-Out of scope.\n+Out of scope!' }] },
    { edits_complete: true, edits: [{ diff: '' }] },
    { edits_complete: true, edits: [{ diff: '@@ -1 +1 @@\n+Clarified wording.' }] },
  ]) {
    const candidate = thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: 'Accepted as a separate concern; non-blocking.',
    })
    candidate.comments[1] = {
      ...candidate.comments[1],
      updated_at: '2026-08-25T03:03:00Z',
      ...edit,
    }
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, JSON.stringify(edit))
  }
})

test('deferral 编辑为 fixed 时单边或不完整历史仍保留 latestDeferral', () => {
  for (const edit of [
    { edits_complete: true, edits: [{ diff: '@@ -1 +1 @@\n+Fixed and covered by regression tests.' }] },
    { edits_complete: true, edits: [{ diff: '+Fixed and covered by regression tests.' }] },
    { edits_complete: true, edits: [{ diff: '' }] },
    { edits_complete: false, edits: [{ diff: '@@ -1 +1 @@\n+Fixed and covered by regression tests.' }] },
  ]) {
    const candidate = thread({
      authorReply: 'Fixed and covered by regression tests.',
      reviewerReply: null,
    })
    candidate.comments[1] = {
      ...candidate.comments[1],
      updated_at: '2026-08-25T03:03:00Z',
      ...edit,
    }
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, JSON.stringify(edit))

    candidate.comments.push({
      login: 'codex', body: 'Confirmed fixed and resolved.',
      created_at: '2026-08-25T03:04:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, JSON.stringify(edit))
  }
})

test('同秒单边或不完整编辑证据仍保留历史 deferral', () => {
  for (const edit of [
    { edits_complete: true, edits: [{ diff: '@@ -1 +1 @@\n+Fixed and covered by regression tests.' }] },
    { edits_complete: true, edits: [{ diff: '+Fixed and covered by regression tests.' }] },
    { edits_complete: true, edits: [{ diff: 'Fixed and covered by regression tests.' }] },
    { edits_complete: true, edits: [{ diff: '' }] },
    { edits_complete: false, edits: [{ diff: '@@ -1 +1 @@\n+Fixed and covered by regression tests.' }] },
  ]) {
    const candidate = thread({
      authorReply: 'Fixed and covered by regression tests.',
      reviewerReply: null,
    })
    candidate.comments[1] = {
      ...candidate.comments[1],
      updated_at: candidate.comments[1].created_at,
      ...edit,
    }
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, false, JSON.stringify(edit))

    candidate.comments.push({
      login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
      created_at: '2026-08-25T03:02:00Z',
    })
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, JSON.stringify(edit))

    candidate.comments.pop()
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      comments: [{
        login: 'jerboy', body: ownerApprovalMarker(head),
        created_at: '2026-08-25T03:02:00Z',
      }],
    }).satisfied, true, JSON.stringify(edit))
  }
})

test('长纯正文单边编辑无法证明历史时保守保留 deferral', () => {
  const longOpaqueDiff = [
    'Implementation completed with regression coverage and detailed verification notes.',
    'This text is intentionally long enough that length heuristics cannot treat it as a fragment.',
  ].join(' ')
  const candidate = thread({
    authorReply: 'Fixed and covered by regression tests.',
    reviewerReply: null,
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{ diff: longOpaqueDiff }],
    edits_complete: true,
  }

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
})

test('无 disposition 的 opaque 中性正文不能凭空制造产品取舍', () => {
  for (const [body, diff] of [
    [
      'Clarified the reply after the discussion.',
      'The earlier response contained context that is no longer relevant to the implementation details.',
    ],
    [
      'The implementation now uses the validated cache key.',
      'The implementation previously used the request path directly.',
    ],
  ]) {
    const candidate = thread({ authorReply: body, reviewerReply: null })
    candidate.comments[1] = {
      ...candidate.comments[1],
      updated_at: '2026-08-25T03:03:00Z',
      edits: [{ diff }],
      edits_complete: true,
    }
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
    }).satisfied, true, body)
  }
})

test('作者编辑删除 deferral 措辞仍保留产品取舍门', () => {
  const candidate = thread({
    authorReply: 'Clarified the reply.',
    reviewerReply: null,
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{
      edited_at: '2026-08-25T03:03:00Z',
      diff: 'Out of scope; defer to a follow-up PR.',
    }],
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

test('生产形状的 UserContentEdit.diff 保留被删除的 deferral 历史', () => {
  const normalized = normalizeProductDecisionThread({
    isResolved: true,
    isOutdated: false,
    resolvedBy: { login: 'author' },
    comments: { nodes: [
      {
        author: { login: 'codex' },
        body: '![P1 Badge] P1 behavior regression',
        createdAt: '2026-08-25T03:00:00Z',
        updatedAt: '2026-08-25T03:00:00Z',
        pullRequestReview: null,
        userContentEdits: { pageInfo: { hasNextPage: false }, nodes: [] },
      },
      {
        author: { login: 'author' },
        body: 'Clarified the reply.',
        createdAt: '2026-08-25T03:01:00Z',
        updatedAt: '2026-08-25T03:03:00Z',
        pullRequestReview: null,
        userContentEdits: {
          pageInfo: { hasNextPage: false },
          nodes: [
            { editedAt: '2026-08-25T03:03:00Z', diff: 'Clarified the reply.' },
            { editedAt: '2026-08-25T03:01:00Z', diff: 'Out of scope; defer to a follow-up PR.' },
          ],
        },
      },
    ] },
  })

  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [normalized],
  }).satisfied, false)

  normalized.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:04:00Z', updated_at: '2026-08-25T03:04:00Z',
    review_id: null, edits: [], edits_complete: true,
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [normalized],
  }).satisfied, true)
})

test('补丁或空 edit diff 无法恢复正文时保持产品取舍门 fail-closed', () => {
  for (const diff of [
    '@@ -1 +1 @@\n-Out of scope; defer to a follow-up PR.\n+Clarified the reply.',
    null,
  ]) {
    const normalized = normalizeProductDecisionThread({
      isResolved: true,
      isOutdated: false,
      resolvedBy: { login: 'author' },
      comments: { nodes: [
        {
          author: { login: 'codex' },
          body: '![P1 Badge] P1 behavior regression',
          createdAt: '2026-08-25T03:00:00Z',
          updatedAt: '2026-08-25T03:00:00Z',
          pullRequestReview: null,
          userContentEdits: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
        {
          author: { login: 'author' },
          body: 'Clarified the reply.',
          createdAt: '2026-08-25T03:01:00Z',
          updatedAt: '2026-08-25T03:03:00Z',
          pullRequestReview: null,
          userContentEdits: {
            pageInfo: { hasNextPage: false },
            nodes: [{ editedAt: '2026-08-25T03:03:00Z', diff }],
          },
        },
      ] },
    })

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [normalized],
    }).satisfied, false, String(diff))
  }

  const ordinaryEdit = thread({
    authorReply: 'Clarified the reply.',
    reviewerReply: null,
  })
  ordinaryEdit.comments[1] = {
    ...ordinaryEdit.comments[1],
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{ diff: 'Clarified reply.' }],
  }
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [ordinaryEdit],
  }).satisfied, true)
})

test('作者语义编辑后的同秒 thread acceptance 无法证明后置时保持阻塞', () => {
  const candidate = thread({
    authorReply: 'This is a broader product trade-off; defer it to a follow-up PR.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{
      edited_at: '2026-08-25T03:03:00Z',
      diff: 'Out of scope; defer to a follow-up PR.',
    }],
  }
  candidate.comments.push({
    login: 'codex', body: 'Accepted as a separate concern; non-blocking.',
    created_at: '2026-08-25T03:03:00Z',
  })
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, false)

  candidate.comments.at(-1).created_at = '2026-08-25T03:03:01Z'
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
  }).satisfied, true)
})

test('同秒 author disposition 含语义编辑时保守保留 deferral', () => {
  const candidate = thread({
    authorReply: 'Out of scope; defer to a follow-up PR.',
  })
  candidate.comments[1] = {
    ...candidate.comments[1],
    created_at: '2026-08-25T03:00:30Z',
    updated_at: '2026-08-25T03:03:00Z',
    edits: [{ body: 'Fixed and covered by regression tests.' }],
  }
  candidate.comments.push(
    {
      login: 'author', body: 'Fixed and covered by regression tests.',
      created_at: '2026-08-25T03:03:00Z',
    },
    {
      login: 'codex', body: 'Confirmed fixed and resolved.',
      created_at: '2026-08-25T03:04:00Z',
    },
  )
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [candidate],
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

  const ordered = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  ordered.comments[1].created_at = '2026-08-25T03:03:00Z'
  ordered.comments.push(
    {
      login: 'author', body: 'Fixed and covered by regression tests.',
      created_at: '2026-08-25T03:03:00Z',
    },
    {
      login: 'codex', body: 'Confirmed fixed and resolved.',
      created_at: '2026-08-25T03:04:00Z',
    },
  )
  assert.equal(evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [ordered],
  }).satisfied, true)
})

test('同秒且无法证明后置的 formal reviewer 或 owner approval 均保持 fail-closed', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  for (const approval of [
    {
      reviews: [{
        login: 'codex', state: 'APPROVED', commit_id: head,
        submitted_at: '2026-08-25T03:01:00Z',
      }],
    },
    {
      reviews: [{
        login: 'zqchris', state: 'APPROVED', commit_id: head,
        submitted_at: '2026-08-25T03:01:00Z',
      }],
    },
    {
      comments: [{
        login: 'jerboy', body: ownerApprovalMarker(head),
        created_at: '2026-08-25T03:01:00Z',
      }],
    },
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      ...approval,
    }).satisfied, false)
  }
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
    '这个问题将由下一个 PR 解决。',
    '未来会处理这个问题。',
    '稍后会修复这个问题。',
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

test('中文当前 PR 的 future-fix 表述不是产品延期', () => {
  for (const authorReply of [
    '本 PR 会修复这个问题，已经补了测试。',
    '这个问题将在本 PR 解决，已经修复并补了测试。',
    '这个问题会修复，已补测试。',
  ]) {
    const withoutConfirmation = evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    })
    assert.equal(withoutConfirmation.satisfied, true, authorReply)
    assert.equal(Boolean(withoutConfirmation.needsOwnerReview), false, authorReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply,
        reviewerReply: '确认已经修复。',
      })],
    }).satisfied, true, authorReply)
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

test('owner marker 的无关编辑不能刷新批准时间', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  const marker = ownerApprovalMarker(head)

  for (const comment of [
    {
      login: 'jerboy', body: marker,
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
    },
    {
      login: 'jerboy', body: `${marker}\nUpdated punctuation.`,
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      edits: [{ edited_at: '2026-08-25T03:02:00Z', body: `${marker}\nUpdated punctuation.` }],
      edits_complete: true,
    },
    {
      login: 'jerboy', body: marker,
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      edits: [{ edited_at: '2026-08-25T03:02:00Z', body: marker }],
      edits_complete: false,
    },
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      comments: [comment],
    }).satisfied, false, JSON.stringify(comment))
  }
})

test('owner marker 只有编辑历史证明后置新增时才能放行', () => {
  const candidate = thread({ authorReply: 'Out of scope; defer to a follow-up PR.' })
  const marker = ownerApprovalMarker(head)
  for (const comment of [
    {
      login: 'jerboy', body: `Decision recorded.\n${marker}`,
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      edits: [
        { edited_at: '2026-08-25T03:00:30Z', body: 'Decision pending.' },
        { edited_at: '2026-08-25T03:02:00Z', body: `Decision recorded.\n${marker}` },
      ],
      edits_complete: true,
    },
    {
      login: 'jerboy', body: `Decision recorded.\n${marker}`,
      created_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:02:00Z',
      edits: [{
        edited_at: '2026-08-25T03:02:00Z',
        diff: `@@ -1 +1,2 @@\n-Decision pending.\n+Decision recorded.\n+${marker}`,
      }],
      edits_complete: true,
    },
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [candidate],
      comments: [comment],
    }).satisfied, true, JSON.stringify(comment))
  }
})

test('疑问式或不确定式 acceptance 不是 reviewer 明确放行', () => {
  for (const reviewerReply of [
    'Can we accept this as a separate concern?',
    'Would you accept this as a separate concern?',
    'Could we accept this as a separate concern',
    'Do you accept this as a separate concern',
    'Does the team accept this as a separate concern',
    'Does Alice accept this as a separate concern',
    'Will you accept this as a separate concern',
    'Are we accepting this as a separate concern',
    'Are you willing to accept this as a separate concern',
    'Whether we accept this as a separate concern',
    'We might accept this as a separate concern.',
    'Maybe accept this as a separate concern.',
    'Perhaps we accept this as a separate concern.',
    '是否接受这个延期并单独处理',
    '我们能否接受这个延期并单独处理',
    '可否同意这个延期并单独处理',
    '我们能不能接受这个延期并单独处理',
    '是否可以单独处理',
    '我们是不是接受这个延期并单独处理',
    '要不要接受这个延期并单独处理',
    '我们可以接受这个延期吗',
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
})

test('中文明确接受产品取舍仍可放行', () => {
  for (const reviewerReply of [
    '接受这个延期并单独处理。',
    '同意这个产品取舍，后续单独处理。',
    '这个问题不再阻塞，可以另开处理。',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply: '这是产品取舍，后续另开处理。',
        reviewerReply,
      })],
    }).satisfied, true, reviewerReply)
  }
})

test('同一消息中的疑问不压掉其后独立的明确 acceptance', () => {
  const result = evaluateProductDecisionGate({
    headOid: head,
    authorLogin: 'author',
    threads: [thread({
      authorReply: 'Out of scope; defer to a follow-up PR.',
      reviewerReply: 'Can we accept this as a separate concern? Accepted as a separate concern; non-blocking.',
    })],
  })
  assert.equal(result.satisfied, true)
})

test('not going to fix 或 address 是明确产品取舍延期', () => {
  for (const authorReply of [
    'We are not going to fix this.',
    "We're not going to address this.",
    "I'm not going to resolve this in this PR.",
    'We will not address this.',
    "We won't resolve this.",
    'I will not resolve this in this PR.',
    'We do not plan to address this.',
    'We have no plans to fix this.',
    "We won't be fixing this.",
    'We will not be addressing this.',
    'WE WILL NOT BE RESOLVING THIS.',
    "I'm not going to be fixing this.",
    'We do not plan to be addressing this.',
    'We have no plans to be resolving this.',
    "We're not fixing this.",
    'We are not addressing this.',
    "I'm not resolving this in this PR.",
    'WE ARE NOT FIXING THIS.',
    'We are not addressing the issue.',
    'We are not fixing this because it is out of scope.',
    "We're not changing this.",
    'We are not changing this in this PR.',
    'I am not changing the behavior here.',
    'We are not making the requested change.',
    "We're not making this change.",
    'I am not making that change because it is out of scope.',
    'We refuse to fix this.',
    'I decline to make the requested change.',
    'We are refusing to address the issue in this PR.',
    "I'm declining to change the behavior here.",
    'We have refused to resolve this.',
    "We've declined to implement this change.",
    'We refuse to make any changes.',
    'I decline the requested change.',
    'We decided not to fix this.',
    'We have decided not to address this.',
    "We've decided not to resolve this.",
    'I had decided not to change the behavior here.',
    'We decided against fixing this.',
    'We determined not to implement the requested change.',
    'I chose not to make this change.',
    "We've opted not to address the issue.",
    'This will not be fixed in this PR.',
    "We won't change this.",
    'I will not change it.',
    'WE WON’T CHANGE THIS.',
    "We won't make this change.",
    'We will not make the requested change.',
    'WE WON’T MAKE THIS CHANGE.',
    'We are leaving this unchanged.',
    "We're leaving this unchanged.",
    'I am leaving it unchanged.',
    "We'll leave this unchanged.",
    "We'll leave this as-is.",
    'We’ll leave this as-is.',
    'We will leave it as is.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    }).satisfied, false, authorReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({
        authorReply,
        reviewerReply: 'Accepted as a separate concern; non-blocking.',
      })],
    }).satisfied, true, authorReply)

    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
      comments: [{
        login: 'jerboy', body: ownerApprovalMarker(head),
        created_at: '2026-08-25T03:02:00Z',
      }],
    }).satisfied, true, authorReply)
  }
})

test('积极进行中的当前修复不是 no-fix disposition', () => {
  for (const authorReply of [
    'We will be fixing this in this PR.',
    'We are addressing this now.',
    'We plan to be resolving this here.',
    "We won't change this test; fixed the implementation.",
    "We won't change this documentation; fixed the behavior.",
    'We are leaving this fixture unchanged; fixed the implementation.',
    "We're not fixing this test; fixed the implementation.",
    'We are not addressing this documentation; fixed the behavior.',
    'We are not fixing the issue template; fixed the implementation.',
    'We are not addressing the finding metadata; fixed the behavior.',
    "We're not changing this test; fixed the implementation.",
    'We are not changing this documentation; fixed the behavior.',
    'We are not making changes to the fixture; fixed the implementation.',
    'We refuse to fix this test; fixed the implementation.',
    'I decline to change this documentation; fixed the behavior.',
    'We are refusing to address the fixture; fixed the implementation.',
    'We refuse to make changes to the test; fixed the implementation.',
    'We decided not to change this test; fixed the implementation.',
    "We've decided not to address the documentation; fixed the behavior.",
    'We decided not to fix this in tests; fixed the implementation.',
    'We have decided not to address this in documentation; fixed the behavior.',
  ]) {
    assert.equal(evaluateProductDecisionGate({
      headOid: head,
      authorLogin: 'author',
      threads: [thread({ authorReply })],
    }).satisfied, true, authorReply)
  }
})
