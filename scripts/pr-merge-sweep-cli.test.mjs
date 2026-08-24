import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptPath = fileURLToPath(new URL('./pr-merge-sweep.mjs', import.meta.url))

test('实合并拒绝无 --pr 的裸跑', () => {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /实合并必须使用 --repo/)
  assert.equal(result.stdout, '')
})
