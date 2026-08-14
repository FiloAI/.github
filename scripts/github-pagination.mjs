/**
 * Parse the JSON emitted by `gh api --paginate --slurp` and return one flat
 * collection. Keeping pagination parsing in one place prevents a later
 * `--paginate` call from accidentally combining multiple JSON documents.
 */
export function flattenPaginatedPages(pages) {
  if (!Array.isArray(pages)) throw new TypeError('分页响应必须是数组')
  if (pages.length === 0) return []
  return pages.every(Array.isArray) ? pages.flat() : pages
}
