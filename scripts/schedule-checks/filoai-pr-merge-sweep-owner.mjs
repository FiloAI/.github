#!/usr/bin/env node
// FiloAI PR merge sweep 预检：org 内存在 open 且非 draft 的 PR 才放行本轮。
// exit 0 = 放行；exit 2 = 跳过（零成本）；其它 = fail-closed 阻止本轮。
import { execFileSync } from 'node:child_process'
try {
  const out = execFileSync('gh', [
    'api', 'search/issues', '-X', 'GET',
    '-f', 'q=org:FiloAI is:pr is:open draft:false',
    '-F', 'per_page=1', '--jq', '.total_count',
  ], { encoding: 'utf8', timeout: 30000 })
  const n = Number(out.trim())
  if (!Number.isFinite(n)) {
    console.error('total_count 解析失败:', out)
    process.exit(1)
  }
  console.error(`open 非 draft PR 数: ${n}`)
  process.exit(n > 0 ? 0 : 2)
} catch (e) {
  console.error('预检意外失败（fail-closed）:', String(e && e.message || e))
  process.exit(1)
}
