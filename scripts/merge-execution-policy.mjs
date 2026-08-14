export function buildMergeArgs({ repo, number, method, headOid, admin = false }) {
  const args = [
    'pr', 'merge', String(number), '--repo', repo, method,
    '--match-head-commit', headOid,
  ]
  if (admin) args.push('--admin')
  return args
}

export function validateAdminFallbackSnapshot({
  expectedHeadOid,
  checkedBaseOid,
  snapshot,
}) {
  if (snapshot.state !== 'OPEN') {
    return { satisfied: false, reason: `fallback 前 PR state=${snapshot.state}` }
  }
  if (snapshot.headRefOid !== expectedHeadOid) {
    return { satisfied: false, reason: 'fallback 前 head 已变化' }
  }
  if (snapshot.baseRefOid !== checkedBaseOid) {
    return { satisfied: false, reason: 'fallback 前 base 已变化' }
  }
  return { satisfied: true, reason: null }
}
