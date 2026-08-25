export const MERGE_OWNER_LOGINS = new Set(['zqchris', 'jerboy'])

export function isMergeOwner(login) {
  return MERGE_OWNER_LOGINS.has(String(login || '').toLowerCase())
}
