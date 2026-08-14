function requirementKey(requirement) {
  return `${requirement.context}:${requirement.integrationId ?? 'any'}`
}

function checkTime(check) {
  return Date.parse(check.at || 0) || 0
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

function producerKey(check) {
  if (check.producer) return check.producer
  return check.integrationId == null ? 'status' : 'check'
}

function latestMatchingChecks(requirement, checks) {
  const matching = checks.filter((candidate) => candidate.name === requirement.context
    && (requirement.integrationId == null
      || Number(candidate.integrationId) === Number(requirement.integrationId)))
  const latestByProducer = new Map()
  for (const check of matching) {
    const key = producerKey(check)
    if (!latestByProducer.has(key) || checkTime(check) > checkTime(latestByProducer.get(key))) {
      latestByProducer.set(key, check)
    }
  }
  return [...latestByProducer.values()]
}

export function evaluateRequiredChecks({ requirements = [], checks = [] }) {
  const unique = new Map()
  for (const requirement of requirements) {
    if (requirement?.context) unique.set(requirementKey(requirement), requirement)
  }
  const required = [...unique.values()]
  if (required.length === 0) return { satisfied: true, reason: null }

  const blocked = required.filter((requirement) => {
    const latest = latestMatchingChecks(requirement, checks)
    return latest.length === 0 || latest.some((check) =>
      check.status !== 'completed' || !PASSING_CONCLUSIONS.has(check.conclusion))
  })
  if (blocked.length === 0) return { satisfied: true, reason: null }

  const reason = blocked.map((requirement) => {
    const latest = latestMatchingChecks(requirement, checks)
    const label = requirement.integrationId == null
      ? requirement.context
      : `${requirement.context}@app:${requirement.integrationId}`
    if (latest.length === 0) return `${label}=缺失`
    const states = latest
      .map((check) => `${producerKey(check)}:${check.status}/${check.conclusion}`)
      .join('+')
    return `${label}=${states}`
  }).join(', ')
  return { satisfied: false, reason: `required checks 未通过: ${reason}` }
}
