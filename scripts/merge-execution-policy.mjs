export function buildMergeArgs({ repo, number, method, headOid, admin = false }) {
  const args = [
    'pr', 'merge', String(number), '--repo', repo, method,
    '--match-head-commit', headOid,
  ]
  if (admin) args.push('--admin')
  return args
}

export function classifyMergeOutcome(pr) {
  if (pr.state === 'MERGED' && pr.mergedAt) return 'merged'
  if (pr.isInMergeQueue || pr.mergeQueueEntry) return 'queued'
  return 'pending'
}

export function shouldUseAdmin({ strict = false, mergeQueue = false }) {
  return !strict && !mergeQueue
}
