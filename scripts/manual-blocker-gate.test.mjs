import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateManualBlockers } from './manual-blocker-gate.mjs'

const headOid = 'abcdef0123456789abcdef0123456789abcdef01'

test('外部机器人风险评论不构成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'cursor', permission: null, body: 'Risk: high. 未批准，转人工。',
      created_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
})

test('Chris 或 Bobo 的明确 veto 不受仓库 collaborator 权限字段影响', () => {
  for (const login of ['zqchris', 'xd-bobo']) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login, permission: 'none', body: '当前不要合并，仍有安全风险。',
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, login)
    assert.deepEqual(result.blockers, [login], login)
  }
})

test('有权限者明确不要合并会阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write', body: '当前不要合并，功能仍有阻断。',
      created_at: '2026-08-24T00:00:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('CHANGES_REQUESTED 会阻塞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'maintain', state: 'CHANGES_REQUESTED',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, false)
})

test('同一阻止者批准当前 head 后解除', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED',
        commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('旧 head 批准不能解除阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', state: 'APPROVED',
        commit_id: '1111111111111111111111111111111111111111',
        submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('其他人的批准不能覆盖原阻止者', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      {
        login: 'blocker', permission: 'write', state: 'CHANGES_REQUESTED',
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'approver', permission: 'admin', state: 'APPROVED',
        commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('原阻止者转述或引用第三方批准不能解除自己的 veto', () => {
  for (const body of [
    `Alice approved ${headOid.slice(0, 7)}.`,
    `Alice hereby approved ${headOid.slice(0, 7)}.`,
    `The security team has approved ${headOid.slice(0, 7)}.`,
    `Alice said LGTM ${headOid.slice(0, 7)}.`,
    `Alice: LGTM ${headOid.slice(0, 7)}.`,
    `Alice gave LGTM ${headOid.slice(0, 7)}.`,
    `Alice LGTM ${headOid.slice(0, 7)}.`,
    `alice LGTM ${headOid.slice(0, 7)}.`,
    `@alice LGTM ${headOid.slice(0, 7)}.`,
    `Security Team LGTM ${headOid.slice(0, 7)}.`,
    `Alice's LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)} from Alice.`,
    `I heard Alice approved ${headOid.slice(0, 7)}.`,
    `According to Alice, approved ${headOid.slice(0, 7)}.`,
    `Alice 表示确认可以合并 ${headOid.slice(0, 7)}。`,
    `我听说 Alice 已确认可以合并 ${headOid.slice(0, 7)}。`,
    `“LGTM ${headOid.slice(0, 7)}” — Alice`,
    `'LGTM ${headOid.slice(0, 7)}' — Alice`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    }).satisfied, false, body)
  }
})

test('带第一人称修饰词的 current-head approval 可以解除自己的 veto', () => {
  for (const body of [
    `I hereby approve ${headOid.slice(0, 7)}.`,
    `I have hereby approved ${headOid.slice(0, 7)}.`,
    `We explicitly now approve ${headOid.slice(0, 7)}.`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    }).satisfied, true, body)
  }
})

test('原阻止者第一人称或直接批准当前 head 可以解除 veto', () => {
  for (const body of [
    `I approve ${headOid.slice(0, 7)}.`,
    `We have approved ${headOid.slice(0, 7)}.`,
    `Approved ${headOid.slice(0, 7)}.`,
    `我确认可以合并 ${headOid.slice(0, 7)}。`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    }).satisfied, true, body)
  }
})

test('approval 分句里的裸限定词在普通评论和 COMMENTED review 中保持 fail-closed', () => {
  const conditionalApprovals = [
    `LGTM ${headOid.slice(0, 7)} once the change freeze ends.`,
    `LGTM ${headOid.slice(0, 7)} after the database migration.`,
    `LGTM ${headOid.slice(0, 7)} when the maintenance window opens.`,
    `LGTM ${headOid.slice(0, 7)} before the rollout meeting.`,
    `LGTM ${headOid.slice(0, 7)} subject to the change freeze.`,
    `LGTM ${headOid.slice(0, 7)} pending the database migration.`,
    `LGTM ${headOid.slice(0, 7)} awaiting the maintenance window.`,
    `LGTM ${headOid.slice(0, 7)}, but please wait for deployment.`,
    `LGTM ${headOid.slice(0, 7)}, but hold until deployment.`,
    `LGTM ${headOid.slice(0, 7)} if the change freeze ends.`,
    `LGTM ${headOid.slice(0, 7)} unless the rollback is ready.`,
    `LGTM ${headOid.slice(0, 7)} until the migration completes.`,
    `LGTM ${headOid.slice(0, 7)} provided that production validation passes.`,
    `LGTM ${headOid.slice(0, 7)} assuming the security review completes.`,
    `LGTM ${headOid.slice(0, 7)} as long as Alice signs off.`,
    `LGTM ${headOid.slice(0, 7)} so long as security approves.`,
    `LGTM ${headOid.slice(0, 7)} on condition that migration completes.`,
    `LGTM ${headOid.slice(0, 7)}，等到变更冻结结束。`,
    `LGTM ${headOid.slice(0, 7)}，在数据库迁移之后。`,
    `LGTM ${headOid.slice(0, 7)}，如果变更冻结结束。`,
    `LGTM ${headOid.slice(0, 7)}，若安全审查完成。`,
    `LGTM ${headOid.slice(0, 7)}，除非回滚方案就绪。`,
    `LGTM ${headOid.slice(0, 7)}，直到数据库迁移完成。`,
    `LGTM ${headOid.slice(0, 7)}，只要生产验证通过。`,
  ]

  for (const source of ['comments', 'reviews']) {
    const priorBlock = source === 'comments'
      ? {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        }
      : {
          login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
          commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
        }

    for (const body of conditionalApprovals) {
      const conditionalEvent = source === 'comments'
        ? {
            login: 'reviewer', permission: 'write', body,
            created_at: '2026-08-24T00:01:00Z',
          }
        : {
            login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
            commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
          }
      assert.equal(evaluateManualBlockers({
        headOid,
        [source]: [priorBlock, conditionalEvent],
      }).satisfied, false, `${source}: ${body}`)
    }

    const thirdPartyEvent = source === 'comments'
      ? {
          login: 'reviewer', permission: 'write',
          body: `Alice LGTM ${headOid.slice(0, 7)} after the database migration.`,
          created_at: '2026-08-24T00:01:00Z',
        }
      : {
          login: 'reviewer', permission: 'write', state: 'COMMENTED',
          body: `Alice LGTM ${headOid.slice(0, 7)} after the database migration.`,
          commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
        }
    assert.equal(evaluateManualBlockers({
      headOid,
      [source]: [priorBlock, thirdPartyEvent],
    }).satisfied, false, `${source}: attributed approval`)

    const directRelease = source === 'comments'
      ? {
          login: 'reviewer', permission: 'write',
          body: `I explicitly approve ${headOid.slice(0, 7)}.`,
          created_at: '2026-08-24T00:01:00Z',
        }
      : {
          login: 'reviewer', permission: 'write', state: 'COMMENTED',
          body: `I explicitly approve ${headOid.slice(0, 7)}.`,
          commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
        }
    assert.equal(evaluateManualBlockers({
      headOid,
      [source]: [priorBlock, directRelease],
    }).satisfied, true, `${source}: direct release`)

    const independentFollowup = source === 'comments'
      ? {
          login: 'reviewer', permission: 'write',
          body: `LGTM ${headOid.slice(0, 7)}, if useful, I can add docs in a follow-up.`,
          created_at: '2026-08-24T00:01:00Z',
        }
      : {
          login: 'reviewer', permission: 'write', state: 'COMMENTED',
          body: `LGTM ${headOid.slice(0, 7)}, if useful, I can add docs in a follow-up.`,
          commit_id: headOid, submitted_at: '2026-08-24T00:01:00Z',
        }
    assert.equal(evaluateManualBlockers({
      headOid,
      [source]: [priorBlock, independentFollowup],
    }).satisfied, true, `${source}: independent follow-up`)
  }
})

test('同一阻止者引用当前 SHA 明确放行后解除', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `确认可以合并 ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('不引用当前 SHA 的普通确认不能解除跨 head 阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: '确认可以合并',
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('合并管家自己的终审与失败评论不反向生成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'owner', permission: 'admin',
        body: 'Cursor 风险评级不能单独卡住合并。\n<!-- merge-steward-verdict:repo#1:abcdef -->',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'owner', permission: 'admin',
        body: '<!-- filoai-merge-steward:failure head=abcdef -->\n【合并管家】本轮未合并',
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, true)
})

test('高风险 owner 请求评论不会在 owner 已批准后留下永久阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'zqchris',
      permission: 'admin',
      body: '<!-- filoai-merge-steward:owner-review-request -->\n高风险改动需要 owner 确认',
    }],
  })
  assert.equal(result.satisfied, true)
})

test('不同意合并不能因包含同意合并子串而解除阻止', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: '不要合并。',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `不同意合并 ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('not approved 不能因包含 approved 而解除阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `Not approved ${headOid.slice(0, 8)}`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  }).satisfied, false)
})

test('当前 head 的 contracted approval negation 保持 fail-closed', () => {
  for (const body of [
    `I haven't approved ${headOid.slice(0, 8)} yet.`,
    `I can't approve ${headOid.slice(0, 8)}.`,
    `I haven’t approved ${headOid.slice(0, 8)} yet. LGTM ${headOid.slice(0, 8)}.`,
    `We won't approve ${headOid.slice(0, 8)}.`,
    `我尚未确认可以合并 ${headOid.slice(0, 8)}。`,
    `我们尚未批准合并 ${headOid.slice(0, 8)}。`,
    `我不能批准合并 ${headOid.slice(0, 8)}。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('其它 head 的 approval negation 不会伪造当前 head blocker', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write',
      body: 'I haven\'t approved 1111111 yet.',
      created_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
})

test('否认存在 merge blocker 的说明不是阻止', () => {
  for (const body of [
    'No merge blockers',
    'No merge blocker found',
    'This is not a release blocker.',
    "This isn't a functionality blocker!",
    'There is no release blocker.',
    'There is no known release blocker.',
    "There aren't any functionality blockers.",
    'This does not constitute a release blocker.',
    "That doesn't constitute a functionality blocker!",
    'NO RELEASE BLOCKER;',
    '没有合并阻塞',
    '未发现 merge blocker',
    'Cursor 风险评级不能单独阻塞合并',
    "I'm not blocking this merge.",
    'We are no longer blocking the merge.',
    'We stopped blocking this merge.',
    "Don't block the merge.",
    'We should not block the merge.',
    "We shouldn't block this merge.",
    '我们不应该阻止合并。',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('否定 blocker 名词不会吞掉同句中的真实阻止', () => {
  for (const body of [
    'This is not a release blocker, but this is a functionality blocker.',
    'There is no functionality blocker; however, do not merge.',
    'There is no known release blocker, but this is a functionality blocker.',
    'This does not constitute a release blocker; however, do not merge.',
  ]) {
    for (const source of ['comments', 'reviews']) {
      const event = source === 'comments'
        ? { login: 'reviewer', permission: 'write', body, created_at: '2026-08-24T00:00:00Z' }
        : {
            login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
            commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
          }
      assert.equal(evaluateManualBlockers({
        headOid,
        [source]: [event],
      }).satisfied, false, `${source}: ${body}`)
    }
  }
})

test('肯定的 release/functionality blocker 仍保持 fail-closed', () => {
  for (const body of [
    'This is a release blocker.',
    'There is a functionality blocker.',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, false, body)
  }
})

test('同消息的 current-head 放行与非阻止说明不会被误判为 veto', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}. We should not block the merge.`,
    `LGTM ${headOid.slice(0, 7)}。我们不应该阻止合并。`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    }).satisfied, true, body)
  }
})

test('逗号分隔的中文非阻止说明不会被跨标点误判为 veto', () => {
  for (const body of [
    '不要阻止，这个合并是安全的。',
    '不应阻塞，该 merge 可以继续。',
  ]) {
    const commentResult = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(commentResult.satisfied, true, body)

    const reviewResult = evaluateManualBlockers({
      headOid,
      reviews: [{
        login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(reviewResult.satisfied, true, body)
  }
})

test('否定安全结论不能被非阻止清理吞掉', () => {
  for (const body of [
    '不要阻止，这个合并不安全。',
    '不要阻止，这个合并不可以。',
    'Do not block this merge, this merge is not safe.',
    'Do not block this merge, the merge is unsafe.',
  ]) {
    for (const source of ['comments', 'reviews']) {
      const event = source === 'comments'
        ? { login: 'reviewer', permission: 'write', body, created_at: '2026-08-24T00:00:00Z' }
        : {
            login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
            commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
          }
      assert.equal(evaluateManualBlockers({
        headOid,
        [source]: [event],
      }).satisfied, false, `${source}: ${body}`)
    }
  }
})

test('双重否定的安全说明仍可作为非阻止说明', () => {
  for (const body of [
    '不要阻止，这个合并不是不安全。',
    '不要阻止，这个合并并非不可以。',
    'Do not block this merge, the merge is not unsafe.',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('疑问式 blocker mention 不会持久化为明确 veto', () => {
  for (const body of [
    'Is this a release blocker?',
    'Could this be a functionality blocker?',
    '这是发布阻断吗？',
    '这算功能阻塞吗？',
    'This may be a release blocker.',
    'This could be a functionality blocker.',
    'We are investigating whether this is a merge blocker.',
    'This is potentially a release blocker.',
    '这可能是发布阻断。',
    '我们正在调查这是否属于功能阻塞。',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
    assert.equal(evaluateManualBlockers({
      headOid,
      reviews: [{
        login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('不确定 blocker 描述不会压过同句中的明确 veto', () => {
  for (const body of [
    'This may be a release blocker, so do not merge.',
    'We are investigating whether this is a functionality blocker; block the merge until we know.',
    '这可能是发布阻断，当前不要合并。',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, false, body)
  }
})

test('不确定 blocker 片段不会吞掉同句中的确定 disposition', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'maintainer',
        permission: 'write',
        created_at: '2026-08-25T00:00:00Z',
        body: 'This may be a release blocker, but this is definitely a functionality blocker.',
      },
    ],
  }).satisfied, false)

  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'maintainer',
        permission: 'write',
        created_at: '2026-08-25T00:00:00Z',
        body: 'Do not merge.',
      },
      {
        login: 'maintainer',
        permission: 'write',
        created_at: '2026-08-25T00:01:00Z',
        body: `This may be a release blocker, but LGTM ${headOid.slice(0, 7)}.`,
      },
    ],
  }).satisfied, true)
})

test('第三方未批准不覆盖评论者本人对当前 head 的明确批准', () => {
  for (const body of [
    `Alice hasn't approved ${headOid.slice(0, 7)}, but I approve ${headOid.slice(0, 7)}.`,
    `Alice 尚未批准 ${headOid.slice(0, 7)}，但我确认可以合并 ${headOid.slice(0, 7)}。`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    }).satisfied, true, body)
  }
})

test('第一人称修饰语和无主体状态不会被当成第三方未批准而移除', () => {
  for (const body of [
    `我个人尚未批准合并 ${headOid.slice(0, 7)}，但 LGTM ${headOid.slice(0, 7)}。`,
    `我们团队尚未批准合并 ${headOid.slice(0, 7)}，但 LGTM ${headOid.slice(0, 7)}。`,
    `当前尚未批准合并 ${headOid.slice(0, 7)}，但 LGTM ${headOid.slice(0, 7)}。`,
    `My team hasn't approved ${headOid.slice(0, 7)}, but LGTM ${headOid.slice(0, 7)}.`,
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, false, body)
  }
})

test('跨消息的非阻止说明不会在 current-head 放行后重新生成 veto', () => {
  for (const body of [
    'We should not block the merge.',
    '我们不应该阻止合并。',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body: `LGTM ${headOid.slice(0, 7)}.`,
          created_at: '2026-08-24T00:01:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:02:00Z',
        },
      ],
    }).satisfied, true, body)
  }
})

test('COMMENTED review 总结里的明确否决会阻塞', () => {
  const result = evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'COMMENTED',
      body: 'Do not merge. The rollout contract is still broken.',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('主动英文 merge veto 会阻塞普通评论与 COMMENTED review', () => {
  for (const body of [
    "I'm blocking this merge.",
    'We are blocking the merge until migration passes.',
    'Block the merge until migration passes.',
    'I veto this merge.',
    'We are vetoing the merge until migration passes.',
    `I'm blocking this merge. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. Block the merge until migration passes.`,
  ]) {
    const commentResult = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(commentResult.satisfied, false, body)

    const reviewResult = evaluateManualBlockers({
      headOid,
      reviews: [{
        login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
        commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(reviewResult.satisfied, false, body)
  }
})

test('明确否定 veto 的说明不会重新生成阻止', () => {
  for (const body of [
    'I do not veto this merge.',
    "We don't veto the merge.",
    'I no longer veto this merge.',
    "I'm not vetoing this merge.",
    "We aren't vetoing the merge.",
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('COMMENTED review 总结里的非阻塞说明不会误判', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'COMMENTED',
      body: 'No merge blockers found.',
      commit_id: headOid, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
})

test('正式 review 状态优先于同一 review 的总结措辞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'APPROVED', commit_id: headOid,
      body: 'Earlier there was a do not merge concern.', submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, true)
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [{
      login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED', commit_id: headOid,
      body: `LGTM ${headOid.slice(0, 7)}`, submitted_at: '2026-08-24T00:00:00Z',
    }],
  }).satisfied, false)
})

test('dismissed review 和自动化账号不构成真人阻止', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    reviews: [
      { login: 'reviewer', permission: 'write', state: 'DISMISSED', body: 'do not merge' },
      { login: 'cursor', permission: 'write', state: 'CHANGES_REQUESTED', is_bot: true },
    ],
  }).satisfied, true)
})

test('编辑后的评论按 updated_at 排序', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: `LGTM ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
      { login: 'reviewer', permission: 'write', body: 'do not merge', created_at: '2026-08-24T00:00:00Z', updated_at: '2026-08-24T00:02:00Z' },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('普通 blocker 字样不误判，逗号分隔的当前 head 放行可识别', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{ login: 'reviewer', permission: 'write', body: 'The test blocker is fixed.' }],
  }).satisfied, true)
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: 'do not merge', created_at: '2026-08-24T00:00:00Z' },
      { login: 'reviewer', permission: 'write', body: `LGTM, ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
    ],
  }).satisfied, true)
})

test('同一段先说无 CI 阻断、随后明确不要合并时仍然阻塞', () => {
  assert.equal(evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write',
      body: 'No merge blockers from CI but do not merge until the migration is fixed.',
    }],
  }).satisfied, false)
})

test('同一分句的局部非阻塞说明不能吞掉真实功能阻断', () => {
  for (const body of [
    'CI 不会阻塞合并，但功能阻断。',
    '不要阻止合并，但功能阻断合并。',
    'No merge blocker from CI, but this is a release blocker.',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, false, body)
  }
})

test('测试通过不能解除人工合并阻止', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      { login: 'reviewer', permission: 'write', body: '不要合并', created_at: '2026-08-24T00:00:00Z' },
      { login: 'reviewer', permission: 'write', body: `测试已通过 ${headOid.slice(0, 7)}`, created_at: '2026-08-24T00:01:00Z' },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('条件性放行无论分句顺序都不能解除人工阻止', () => {
  for (const body of [
    `需要先修复迁移状态。可以合并 ${headOid.slice(0, 7)}`,
    `可以合并 ${headOid.slice(0, 7)}，但需要先修复迁移状态`,
    `OK to merge ${headOid.slice(0, 7)}, but the migration must be fixed first`,
    `The migration must be fixed before merge. LGTM ${headOid.slice(0, 7)}`,
    `LGTM ${headOid.slice(0, 7)} after the migration is fixed`,
    `LGTM ${headOid.slice(0, 7)} when the tests pass`,
    `After the migration is fixed. LGTM ${headOid.slice(0, 7)}`,
    `LGTM ${headOid.slice(0, 7)}. Once the migration is resolved.`,
    `As long as Alice signs off. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. So long as security approves.`,
    `On condition that migration completes. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. The migration must be fixed.`,
    `迁移修复后可以合并 ${headOid.slice(0, 7)}`,
    `等 Alice 签字后，可以合并 ${headOid.slice(0, 7)}`,
    `待 Alice 签字，可以合并 ${headOid.slice(0, 7)}`,
    `等到安全审查通过，可以合并 ${headOid.slice(0, 7)}`,
    `如果 Alice 签字，可以合并 ${headOid.slice(0, 7)}`,
    `若安全审查通过，可以合并 ${headOid.slice(0, 7)}`,
    `可以合并 ${headOid.slice(0, 7)}，如果 Alice 签字`,
    `可以合并 ${headOid.slice(0, 7)}，若安全审查通过`,
    `LGTM ${headOid.slice(0, 7)} pending security review`,
    `LGTM ${headOid.slice(0, 7)} subject to security review`,
    `LGTM ${headOid.slice(0, 7)} awaiting security approval`,
    `LGTM ${headOid.slice(0, 7)} pending architecture review`,
    `LGTM ${headOid.slice(0, 7)} subject to database migration validation`,
    `LGTM ${headOid.slice(0, 7)} pending deployment`,
    `LGTM ${headOid.slice(0, 7)} subject to deployment`,
    `LGTM ${headOid.slice(0, 7)} awaiting rollout`,
    `LGTM ${headOid.slice(0, 7)}，等待安全审查`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        { login: 'reviewer', permission: 'write', body: '不要合并', created_at: '2026-08-24T00:00:00Z' },
        { login: 'reviewer', permission: 'write', body, created_at: '2026-08-24T00:01:00Z' },
      ],
    })
    assert.equal(result.satisfied, false, body)
  }
})

test('跨 PR 前置条件不能解除当前 PR 的人工阻止', () => {
  for (const body of [
    `After PR #123 is fixed. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. After PR #123 is fixed.`,
    `Once PR #123 is green. LGTM ${headOid.slice(0, 7)}.`,
    `As long as PR #123 is merged. LGTM ${headOid.slice(0, 7)}.`,
    `PR #123 must be fixed before merge. LGTM ${headOid.slice(0, 7)}.`,
    `PR #123 must be fixed first. LGTM ${headOid.slice(0, 7)}.`,
    `PR #123 must be merged first. LGTM ${headOid.slice(0, 7)}.`,
    `PR #123 must merge before we merge. LGTM ${headOid.slice(0, 7)}.`,
    `PR #123 must be merged before we can merge this. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. PR #123 has to merge before the team can merge.`,
    `PR #123 must merge before this one. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. PR #123 must merge before ours.`,
    `等 PR #123 修复后，可以合并 ${headOid.slice(0, 7)}。`,
    `PR #123 修好才能合并。LGTM ${headOid.slice(0, 7)}。`,
    `先合并 PR #123，当前 PR 才能合并 ${headOid.slice(0, 7)}。`,
    `PR #123 必须在我们合并本 PR 前完成。LGTM ${headOid.slice(0, 7)}。`,
    `PR #123 必须在这个 PR 之前合并。LGTM ${headOid.slice(0, 7)}。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      prNumber: 22,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, false, body)
  }
})

test('已解决或历史 blocker 说明不会生成新的持久 veto', () => {
  for (const body of [
    'The release blocker is fixed.',
    'The functionality blocker has been resolved.',
    'The merge blocker was cleared yesterday.',
    'We resolved the release blocker.',
    'The merge blocker was fixed and is not back.',
    '发布阻断已经修复。',
    '功能阻塞现已解除。',
    '功能阻断已解决，没有再次出现。',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('未解决 blocker 和 resolved 后的新 veto 仍保持 fail-closed', () => {
  for (const body of [
    'The release blocker is not fixed.',
    'The functionality blocker has not been resolved.',
    '发布阻断尚未修复。',
    'The release blocker is fixed, but do not merge.',
    'The merge blocker was fixed but is back.',
    '功能阻断已解决，但当前不要合并。',
    '功能阻断已解决，但又出现了。',
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('放行前后的未完成状态分句继续保留人工阻止', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}. The migration is still broken.`,
    `The migration is still broken. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. The rollout is incomplete.`,
    `The tests are still failing. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}, however production validation remains outstanding.`,
    `The migration is still not fixed. LGTM ${headOid.slice(0, 7)}.`,
    `可以合并 ${headOid.slice(0, 7)}。迁移仍未完成。`,
    `迁移仍未完成。可以合并 ${headOid.slice(0, 7)}。`,
    `可以合并 ${headOid.slice(0, 7)}。生产验证尚未通过。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, false, body)
  }
})

test('已经完成的历史状态说明不会误阻塞当前 head 放行', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}. The migration was broken but is now fixed.`,
    `The rollout was incomplete, but it is now complete. LGTM ${headOid.slice(0, 7)}.`,
    `Alice has signed off. LGTM ${headOid.slice(0, 7)}.`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, true, body)
  }
})

test('同一条消息的显式 veto 不会被后续条件性放行覆盖', () => {
  for (const body of [
    `Do not merge. LGTM ${headOid.slice(0, 7)}, but the migration is unsafe.`,
    `不要合并。可以合并 ${headOid.slice(0, 7)}，但仍需修复迁移状态。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('同一条消息的显式 veto 不会被后续无条件放行覆盖', () => {
  for (const body of [
    `Do not merge. LGTM ${headOid.slice(0, 7)}.`,
    `不要合并。可以合并 ${headOid.slice(0, 7)}。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('独立消息中的当前 head 无条件放行仍可解除较早 veto', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write', body: `LGTM ${headOid.slice(0, 7)}.`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, true)
})

test('adversative 未签字条件不能伪装成当前 head 无条件放行', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}, but Alice has not signed off.`,
    `LGTM ${headOid.slice(0, 7)}, but Alice should sign off.`,
    `LGTM ${headOid.slice(0, 7)}, but security ought to sign off.`,
    `LGTM ${headOid.slice(0, 7)}, however security has not signed off.`,
    `可以合并 ${headOid.slice(0, 7)}，但 Alice 尚未签字。`,
    `可以合并 ${headOid.slice(0, 7)}，但 Alice 应该签字。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, false, body)
  }
})

test('无关的部署后说明不会压制当前 head 无条件放行', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}. When deployed, this will reduce latency.`,
    `LGTM ${headOid.slice(0, 7)}. After deployment, users will see lower latency.`,
    `可以合并 ${headOid.slice(0, 7)}。上线后延迟会降低。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, true, body)
  }
})

test('疑问式放行不能解除人工阻止', () => {
  for (const body of [
    `可以合并 ${headOid.slice(0, 7)} 吗？`,
    `可以合并 ${headOid.slice(0, 7)} 吗`,
    `OK to merge ${headOid.slice(0, 7)}?`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: '不要合并',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('同一分句的显式 veto 优先于 current-head approval', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)} for the tests — do not merge.`,
    `审核通过 ${headOid.slice(0, 7)}，但当前不要合并。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-24T00:00:00Z',
      }],
    })
    assert.equal(result.satisfied, false, body)
    assert.deepEqual(result.blockers, ['reviewer'], body)
  }
})

test('无关疑问不会污染独立的 current-head 放行', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)}. What happens after deployment?`,
    `LGTM ${headOid.slice(0, 7)}. When is the next release?`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, true, body)
  }
})

test('任意条件谓词都不能解除人工阻止', () => {
  for (const body of [
    `LGTM ${headOid.slice(0, 7)} after the rollout is green`,
    `LGTM ${headOid.slice(0, 7)} after Alice signs off`,
    `LGTM ${headOid.slice(0, 7)} once security review succeeds`,
    `LGTM ${headOid.slice(0, 7)} provided that staging remains healthy`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, false, body)
  }
})

test('其它独立事项的 pending 措辞不会污染 current-head 放行', () => {
  for (const body of [
    `I still need to update another PR. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}. I still need to update another PR.`,
    `LGTM ${headOid.slice(0, 7)}. If useful, I can add docs in a follow-up.`,
    `If useful, I can add docs in a follow-up, LGTM ${headOid.slice(0, 7)}.`,
    `I can add docs in a follow-up if useful. LGTM ${headOid.slice(0, 7)}.`,
    `LGTM ${headOid.slice(0, 7)}。如果有需要，我可以后续补充文档。`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, true, body)
  }
})

test('follow-up 建议不能掩盖同一分句里的真实未完成条件', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write',
        body: `LGTM ${headOid.slice(0, 7)}. If useful, I can add docs in a follow-up, but production validation remains outstanding.`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('解释性分句不能隔断属于当前 PR 的放行条件', () => {
  const result = evaluateManualBlockers({
    headOid,
    prNumber: 22,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write',
        body: `LGTM ${headOid.slice(0, 7)}. 我再确认一下。After the migration is fixed.`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('明确属于其它 PR 的条件不会污染当前 PR 放行', () => {
  for (const body of [
    `For PR #123, security review must complete. LGTM ${headOid.slice(0, 7)} for this PR.`,
    `For another PR, security review must complete. LGTM ${headOid.slice(0, 7)} for this PR.`,
  ]) {
    const result = evaluateManualBlockers({
      headOid,
      prNumber: 22,
      comments: [
        {
          login: 'reviewer', permission: 'write', body: 'Do not merge.',
          created_at: '2026-08-24T00:00:00Z',
        },
        {
          login: 'reviewer', permission: 'write', body,
          created_at: '2026-08-24T00:01:00Z',
        },
      ],
    })
    assert.equal(result.satisfied, true, body)
  }
})

test('同时约束当前 PR 与其它 PR 的条件必须保留人工阻止', () => {
  const result = evaluateManualBlockers({
    headOid,
    prNumber: 22,
    comments: [
      {
        login: 'reviewer', permission: 'write', body: 'Do not merge.',
        created_at: '2026-08-24T00:00:00Z',
      },
      {
        login: 'reviewer', permission: 'write',
        body: `PR #123 and this PR must both be fixed first. LGTM ${headOid.slice(0, 7)}.`,
        created_at: '2026-08-24T00:01:00Z',
      },
    ],
  })
  assert.equal(result.satisfied, false)
})

test('明确阻止 PR 或 pull request 与阻止 merge 等价', () => {
  for (const source of ['comments', 'reviews']) {
    for (const body of [
      "I'm blocking this PR.",
      'Block this PR until migration passes.',
      'We are blocking the pull request.',
      'I veto this pull request.',
    ]) {
      const event = source === 'comments'
        ? {
            login: 'reviewer', permission: 'write', body,
            created_at: '2026-08-25T04:00:00Z',
          }
        : {
            login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
            commit_id: headOid, submitted_at: '2026-08-25T04:00:00Z',
          }
      const result = evaluateManualBlockers({ headOid, [source]: [event] })
      assert.equal(result.satisfied, false, `${source}: ${body}`)
      assert.deepEqual(result.blockers, ['reviewer'], `${source}: ${body}`)
    }
  }
})

test('否定或撤回 LGTM 不能清除原阻止者的 veto', () => {
  for (const source of ['comments', 'reviews']) {
    for (const body of [
      `I don't consider this LGTM ${headOid.slice(0, 7)}.`,
      `I cannot give this an LGTM ${headOid.slice(0, 7)}.`,
      `I haven't given LGTM ${headOid.slice(0, 7)}.`,
      `I retract my LGTM ${headOid.slice(0, 7)}.`,
    ]) {
      const prior = source === 'comments'
        ? {
            login: 'reviewer', permission: 'write', body: 'Do not merge.',
            created_at: '2026-08-25T04:00:00Z',
          }
        : {
            login: 'reviewer', permission: 'write', state: 'CHANGES_REQUESTED',
            commit_id: headOid, submitted_at: '2026-08-25T04:00:00Z',
          }
      const event = source === 'comments'
        ? {
            login: 'reviewer', permission: 'write', body,
            created_at: '2026-08-25T04:01:00Z',
          }
        : {
            login: 'reviewer', permission: 'write', state: 'COMMENTED', body,
            commit_id: headOid, submitted_at: '2026-08-25T04:01:00Z',
          }
      const result = evaluateManualBlockers({ headOid, [source]: [prior, event] })
      assert.equal(result.satisfied, false, `${source}: ${body}`)
      assert.deepEqual(result.blockers, ['reviewer'], `${source}: ${body}`)
    }
  }
})

test('no longer blocker 是解除说明，不会被持久化为新 veto', () => {
  for (const body of [
    'This is no longer a release blocker.',
    'This is no longer a functionality blocker.',
    'The release blocker is no longer active.',
    'The functionality blocker is no longer blocking.',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-25T04:00:00Z',
      }],
    }).satisfied, true, body)
  }
})

test('no longer blocker 的局部清理不能吞掉同句后续真实 veto', () => {
  const result = evaluateManualBlockers({
    headOid,
    comments: [{
      login: 'reviewer', permission: 'write',
      body: "This is no longer a release blocker, but I'm blocking this PR.",
      created_at: '2026-08-25T04:00:00Z',
    }],
  })
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.blockers, ['reviewer'])
})

test('明确不阻止 PR 或 pull request 不会被主动 veto 规则反向命中', () => {
  for (const body of [
    "I'm not blocking this PR.",
    "We're no longer blocking the pull request.",
    'Do not block this PR.',
    'I do not veto this pull request.',
  ]) {
    assert.equal(evaluateManualBlockers({
      headOid,
      comments: [{
        login: 'reviewer', permission: 'write', body,
        created_at: '2026-08-25T04:00:00Z',
      }],
    }).satisfied, true, body)
  }
})
