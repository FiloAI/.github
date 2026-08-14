export function evaluateRequiredChecks({ requiredNames = [], checks = {} }) {
  const names = [...new Set(requiredNames.filter(Boolean))]
  if (names.length === 0) return { satisfied: true, reason: null }

  const blocked = names.filter((name) => {
    const check = checks[name]
    return !check || check.status !== 'completed' || check.conclusion !== 'success'
  })
  if (blocked.length === 0) return { satisfied: true, reason: null }

  const reason = blocked.map((name) => {
    const check = checks[name]
    return `${name}=${check ? `${check.status}/${check.conclusion}` : '缺失'}`
  }).join(', ')
  return { satisfied: false, reason: `required checks 未通过: ${reason}` }
}
