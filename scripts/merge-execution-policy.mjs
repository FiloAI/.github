export function buildMergeArgs({ repo, number, method, headOid, admin = false }) {
  const args = [
    'pr', 'merge', String(number), '--repo', repo, method,
    '--match-head-commit', headOid,
  ]
  if (admin) args.push('--admin')
  return args
}
