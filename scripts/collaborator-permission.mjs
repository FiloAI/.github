export function isConfirmedMissingCollaborator(error) {
  const detail = String(error?.stderr || error?.message || error || '')
  return /HTTP 404|\bNot Found\b|is not a user/i.test(detail)
}

export function isAutomatedAccount(user) {
  const login = String(user?.login || '')
  return user?.type === 'Bot'
    || /(?:\[bot\]$|^cursor$|^chatgpt-codex-connector$|^greptile)/i.test(login)
}
