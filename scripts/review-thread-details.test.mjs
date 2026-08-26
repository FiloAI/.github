import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReviewThreadsQuery,
  formatUnresolvedReviewReason,
  readUnresolvedReviewThreads,
} from './review-thread-details.mjs'

test('review thread 分页会读取第 101 条之后的未解决意见', () => {
  const calls = []
  const pages = [
    { data: { repository: { pullRequest: { reviewThreads: {
      nodes: Array.from({ length: 100 }, (_, index) => ({ id: String(index), isResolved: true })),
      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
    } } } } },
    { data: { repository: { pullRequest: { reviewThreads: {
      nodes: [{
        id: 'open-101', isResolved: false, path: 'desktop/src/example.ts', line: 27,
        comments: { nodes: [{ body: '### Wrong fallback\n<!-- DESCRIPTION START -->插入错误图片<!-- DESCRIPTION END -->', author: { login: 'cursor' } }] },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } } },
  ]
  const result = readUnresolvedReviewThreads({
    repo: 'FiloAI/filoai-frontend',
    prNumber: 3550,
    runGraphql: (query) => {
      calls.push(query)
      return pages[calls.length - 1]
    },
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'open-101')
  assert.equal(calls.length, 2)
  assert.match(calls[1], /after: "cursor-1"/)
})

test('阻塞原因包含作者需要看的位置、来源、级别和问题摘要', () => {
  const reason = formatUnresolvedReviewReason([{
    isResolved: false,
    path: 'desktop/src/components/mailEditor/utils/clipboard-images.ts',
    line: 627,
    comments: { nodes: [{
      body: '### Deferred files claim unrelated slots\n\n**Medium Severity**\n\n<!-- DESCRIPTION START -->When a fingerprint is already in seen but no matching unassigned kept slot remains, claimKeptIndex still binds the file to the next unrelated kept index. Surplus copies can insert the wrong image.<!-- DESCRIPTION END -->',
      author: { login: 'cursor' },
    }] },
  }])
  assert.match(reason, /未解决 review thread：1 条/)
  assert.match(reason, /clipboard-images\.ts:627/)
  assert.match(reason, /Cursor Bugbot，Medium（中风险）/)
  assert.match(reason, /重复图片没有对应的未占用槽位/)
})

test('GraphQL 查询对仓库名和游标做安全转义', () => {
  const query = buildReviewThreadsQuery({ owner: 'Filo"AI', name: 'repo', prNumber: 1, after: 'a"b' })
  assert.match(query, /owner: "Filo\\"AI"/)
  assert.match(query, /after: "a\\"b"/)
})
