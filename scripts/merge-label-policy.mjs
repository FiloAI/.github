export function evaluateMergeLabels(labels = []) {
  const names = new Set(labels.map((label) => typeof label === 'string' ? label : label?.name))
  if (names.has('no-automerge')) {
    return { satisfied: false, reason: 'no-automerge 标签' }
  }
  return { satisfied: true, reason: null }
}
