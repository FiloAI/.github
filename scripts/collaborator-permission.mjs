export function isConfirmedMissingCollaborator(error) {
  const detail = String(error?.stderr || error?.message || error || '')
  return /HTTP 404|\bNot Found\b|is not a user/i.test(detail)
}
