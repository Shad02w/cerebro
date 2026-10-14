const RESULT_LIMIT = 30

/** How well `query` sits inside `text`. Null when a character is missing. Consecutive hits score higher. */
const subsequence = (text: string, query: string): number | null => {
  let from = 0
  let score = 0
  let run = 0
  for (const char of query) {
    const found = text.indexOf(char, from)
    if (found < 0) return null
    run = found === from ? run + 1 : 1
    score += run * 8 - (found - from)
    from = found + 1
  }
  return score
}

const rank = (path: string, query: string): number | null => {
  const folded = path.toLowerCase()
  const slash = folded.lastIndexOf('/')
  const base = slash < 0 ? folded : folded.slice(slash + 1)
  if (!query) return 100 - folded.split('/').length * 10
  if (base === query) return 10_000 - folded.length
  if (base.startsWith(query)) return 8_000 - folded.length
  const baseScore = subsequence(base, query)
  const pathScore = subsequence(folded, query)
  if (baseScore == null && pathScore == null) return null
  let score = pathScore ?? 0
  if (folded.startsWith(query)) score += 2_000
  if (baseScore != null) score += 1_000 + baseScore
  return score - folded.length * 0.01
}

/**
 * Best file paths for a composer query. An empty query lists shallower paths first.
 * Scoring prefers the file name, then a prefix, then a fuzzy subsequence.
 */
export function searchFiles(
  files: readonly string[],
  query: string,
  limit = RESULT_LIMIT
): string[] {
  const needle = query.trim().toLowerCase()
  const ranked: Array<{ path: string; score: number }> = []
  for (const path of files) {
    const score = rank(path, needle)
    if (score == null) continue
    ranked.push({ path, score })
  }
  ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
  return ranked.slice(0, limit).map((hit) => hit.path)
}
