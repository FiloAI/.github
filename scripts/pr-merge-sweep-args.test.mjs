import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('./pr-merge-sweep.mjs', import.meta.url))

test('未知参数在任何 GitHub 调用前 fail-closed', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--dry-rnu', '--repo', 'FiloAI/.github'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /未知参数：--dry-rnu/)
})

test('重复参数和缺值参数均拒绝执行', () => {
  for (const args of [
    ['--repo', 'FiloAI/.github', '--repo', 'FiloAI/filo-www'],
    ['--repo'],
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, /参数缺值或重复/)
  }
})
