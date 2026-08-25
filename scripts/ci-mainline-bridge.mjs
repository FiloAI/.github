import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_CI_BRIDGE_FILE = path.join(
  os.homedir(),
  '.agents/skills/git-workflow/sweeps/_merge-steward-ci.json',
)
export const DEFAULT_CI_BRIDGE_ACK_FILE = path.join(
  os.homedir(),
  '.agents/skills/git-workflow/sweeps/_merge-steward-ci-consumed.json',
)

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

export function readCiBridge(file = DEFAULT_CI_BRIDGE_FILE, now = Date.now()) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { version: 1, events: {} }
  }
  const events = {}
  for (const [key, value] of Object.entries(isObject(parsed?.events) ? parsed.events : {})) {
    if (!isObject(value)) continue
    const updatedAt = Number(value.updatedAt || 0)
    if (updatedAt > 0 && now - updatedAt > 7 * 24 * 60 * 60 * 1000) continue
    events[key] = value
  }
  return { version: 1, events }
}

export function bridgeEntriesFor(repo, bridge = readCiBridge()) {
  return Object.values(bridge.events || {})
    .filter((event) => !repo || event.repo === repo)
    .sort((a, b) => Number(a.pr || 0) - Number(b.pr || 0))
}

export function formatCiBridgeEvent(event) {
  const status = event.status === 'recovered' ? 'CI 已恢复' : 'CI 失败'
  const checks = (event.checks || [])
    .map((check) => `${check.name || 'unknown'}=${check.conclusion || check.status || 'unknown'}`)
    .join(', ')
  return `${event.repo}#${event.pr} head=${String(event.head || '').slice(0, 12)} ${status}` +
    (checks ? ` [${checks}]` : '')
}

export function consumeCiBridgeEvents({
  bridge = readCiBridge(),
  ackFile = DEFAULT_CI_BRIDGE_ACK_FILE,
  now = Date.now(),
} = {}) {
  let ack = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(ackFile, 'utf8'))
    if (isObject(parsed)) ack = parsed
  } catch {}
  const fresh = []
  for (const [key, event] of Object.entries(bridge.events || {})) {
    const token = `${event.status || 'unknown'}:${event.fingerprint || event.updatedAt || ''}`
    const previous = ack[key]
    if (previous === token || previous?.token === token) continue
    fresh.push(event)
    ack[key] = { token, updatedAt: Number(event.updatedAt || now) }
  }
  for (const [key, token] of Object.entries(ack)) {
    if (!bridge.events[key] && now - Number(token?.updatedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      delete ack[key]
    }
  }
  fs.mkdirSync(path.dirname(ackFile), { recursive: true })
  const temp = `${ackFile}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(ack, null, 2) + '\n')
  fs.renameSync(temp, ackFile)
  return fresh
}
