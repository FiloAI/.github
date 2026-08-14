import assert from 'node:assert/strict'
import test from 'node:test'

import { hasCurrentHeadCodexReview } from './codex-review-gate.mjs'

const HEAD = 'd669ace540e8d58c8c2817aaa453c4c3308551f1'

test('只接受当前 head 的正式 Codex review', () => {
  const body = `
### 💡 Codex Review

Here are some automated review suggestions for this pull request.

**Reviewed commit:** \`${HEAD.slice(0, 10)}\`

<details> <summary>ℹ️ About Codex in GitHub</summary>
<br/>

[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review".

If Codex has suggestions, it will comment; otherwise it will react with 👍.

Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".
</details>`
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: HEAD,
      body,
    }],
  }), true)

  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: '876dc7fd3896feeb4fd6df7d7290636853339ee2',
      body,
    }],
  }), false)
})

test('Codex 顶层待修文字不能冒充标准结论', () => {
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: HEAD,
      body: 'Please fix the merge race before merging.',
    }],
  }), false)
})

test('Codex 标准 details 内夹带待修文字也不能冒充结论', () => {
  const body = `
### 💡 Codex Review

Here are some automated review suggestions for this pull request.

**Reviewed commit:** \`${HEAD.slice(0, 10)}\`

<details> <summary>ℹ️ About Codex in GitHub</summary>
<br/>
Please fix the merge race before merging.
</details>`
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'COMMENTED',
      commit_id: HEAD,
      body,
    }],
  }), false)
})

test('Codex 正式 APPROVED 仍可直接作为当前 head 结论', () => {
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    reviews: [{
      user: { login: 'chatgpt-codex-connector[bot]' },
      state: 'APPROVED',
      commit_id: HEAD,
      body: '',
    }],
  }), true)
})

test('无问题评论必须明确绑定当前 head', () => {
  const body = `Codex Review: Didn't find any major issues. :+1:

**Reviewed commit:** \`${HEAD.slice(0, 12)}\`

<details> <summary>ℹ️ About Codex in GitHub</summary>
<br/>

[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review".

If Codex has suggestions, it will comment; otherwise it will react with 👍.

Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".
</details>`
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
    comments: [{ user: { login: 'chatgpt-codex-connector[bot]' }, body }],
  }), true)

  assert.equal(hasCurrentHeadCodexReview({
    headOid: '876dc7fd3896feeb4fd6df7d7290636853339ee2',
    comments: [{ user: { login: 'chatgpt-codex-connector[bot]' }, body }],
  }), false)
})

test('无问题评论夹带待修文字不能冒充结论', () => {
  const body = `Codex Review: Didn't find any major issues. :+1:

**Reviewed commit:** \`${HEAD.slice(0, 12)}\`

Please fix the merge race before merging.`
  assert.equal(hasCurrentHeadCodexReview({
    headOid: HEAD,
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
