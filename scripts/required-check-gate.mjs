function requirementKey(requirement) {
  return `${requirement.context}:${requirement.integrationId ?? 'any'}`
}

function checkTime(check) {
  return Date.parse(check.at || 0) || 0
}

export function evaluateRequiredChecks({ requirements = [], checks = [] }) {
  const unique = new Map()
  for (const requirement of requirements) {
    if (requirement?.context) unique.set(requirementKey(requirement), requirement)
  }
  const required = [...unique.values()]
  if (required.length === 0) return { satisfied: true, reason: null }

  const blocked = required.filter((requirement) => {
    const check = checks
      .filter((candidate) => candidate.name === requirement.context
        && (requirement.integrationId == null
          || Number(candidate.integrationId) === Number(requirement.integrationId)))
      .sort((a, b) => checkTime(b) - checkTime(a))[0]
    return !check || check.status !== 'completed' || check.conclusion !== 'success'
  })
  if (blocked.length === 0) return { satisfied: true, reason: null }

  const reason = blocked.map((requirement) => {
    const check = checks
      .filter((candidate) => candidate.name === requirement.context
        && (requirement.integrationId == null
          || Number(candidate.integrationId) === Number(requirement.integrationId)))
      .sort((a, b) => checkTime(b) - checkTime(a))[0]
    const label = requirement.integrationId == null
      ? requirement.context
      : `${requirement.context}@app:${requirement.integrationId}`
    return `${label}=${check ? `${check.status}/${check.conclusion}` : '缺失'}`
  }).join(', ')
  return { satisfied: false, reason: `required checks 未通过: ${reason}` }
}
