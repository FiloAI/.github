export function buildMergeArgs({ repo, number, method, headOid }) {
  return [
    'pr', 'merge', String(number), '--repo', repo, method,
    '--match-head-commit', headOid,
  ]
}

export function classifyMergeOutcome(pr) {
  if (pr.state === 'MERGED' && pr.mergedAt) return 'merged'
  if (pr.isInMergeQueue || pr.mergeQueueEntry) return 'queued'
  if (pr.autoMergeRequest) return 'scheduled'
  return 'pending'
}

export function shouldRequireUpToDate({ strict = false, mergeQueue = false }) {
  return strict && !mergeQueue
}

export function matchesExpectedHead(expectedHead, actualHead) {
  return String(expectedHead || '').toLowerCase() === String(actualHead || '').toLowerCase()
}
