import assert from 'node:assert/strict'
import test from 'node:test'

import { isConfirmedMissingCollaborator } from './collaborator-permission.mjs'

test('404 和明确非用户响应表示已确认无协作者权限', () => {
  assert.equal(isConfirmedMissingCollaborator({ stderr: 'gh: Not Found (HTTP 404)' }), true)
  assert.equal(isConfirmedMissingCollaborator({ message: 'github-actions is not a user (HTTP 404)' }), true)
})

test('限流、鉴权和网络失败不能当作无权限跳过', () => {
  assert.equal(isConfirmedMissingCollaborator({ stderr: 'API rate limit exceeded (HTTP 403)' }), false)
  assert.equal(isConfirmedMissingCollaborator({ stderr: 'Bad credentials (HTTP 401)' }), false)
  assert.equal(isConfirmedMissingCollaborator({ message: 'socket hang up' }), false)
})
