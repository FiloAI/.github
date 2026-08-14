import assert from 'node:assert/strict'
import test from 'node:test'

import { flattenPaginatedPages } from './github-pagination.mjs'

test('多页响应展平为单一集合', () => {
  assert.deepEqual(flattenPaginatedPages([[{ id: 1 }], [{ id: 2 }, { id: 3 }]]), [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ])
})

test('空分页响应返回空集合', () => {
  assert.deepEqual(flattenPaginatedPages([]), [])
})

test('单页集合保持不变', () => {
  assert.deepEqual(flattenPaginatedPages([{ id: 1 }]), [{ id: 1 }])
})

test('对象分页保留每页容器供调用方展平字段', () => {
  const pages = [
    { statuses: [{ id: 1 }] },
    { statuses: [{ id: 2 }] },
  ]
  assert.deepEqual(
    flattenPaginatedPages(pages).flatMap((page) => page.statuses),
    [{ id: 1 }, { id: 2 }],
  )
})
