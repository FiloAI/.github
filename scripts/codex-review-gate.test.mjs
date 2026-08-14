import assert from 'node:assert/strict'
import test from 'node:test'

import { hasCurrentHeadCodexReview } from './codex-review-gate.mjs'

const HEAD = 'd669ace540e8d58c8c2817aaa453c4c3308551f1'

test('只接受当前 head 的正式 Codex review', () => {
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: HEAD,
    }],
  }), true)

  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: '876dc7fd3896feeb4fd6df7d7290636853339ee2',
    }],
  }), false)
})

test('无问题评论必须明确绑定当前 head', () => {
  const body = `Codex Review: Didn't find any major issues.\n\nReviewed commit: ${HEAD.slice(0, 12)}`
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    comments: [{ user: { login: 'chatgpt-codex-connector[bot]' }, body }],
  }), true)

  assert.equal(hasCurrentHeadCodexReview({
    headOid: '876dc7fd3896feeb4fd6df7d7290636853339ee2',
    comments: [{ user: { login: 'chatgpt-codex-connector[bot]' }, body }],
  }), false)
})

test('召唤、进度和人类伪造文本都不算 Codex 结论', () => {
  for (const comment of [
    { user: { login: 'zqchris' }, body: `Codex Review: Didn't find any major issues. Reviewed commit: ${HEAD}` },
    { user: { login: 'chatgpt-codex-connector[bot]' }, body: 'Review in progress' },
    { user: { login: 'zqchris' }, body: '@codex review' },
  ]) {
    assert.equal(hasCurrentHeadCodexReview({ headOid: HEAD, comments: [comment] }), false)
  }
})
