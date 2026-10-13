import type { ChatItem } from '@cerebro/core'

export type TranscriptEntry =
  { type: 'item'; item: ChatItem } | { type: 'tools'; items: ChatItem[]; live: boolean }

/**
 * One expandable for every tool call in a turn, placed where the first call appeared.
 * `live` while that turn is still streaming.
 */
export function transcriptEntries(
  items: readonly ChatItem[],
  liveTurnId?: string
): TranscriptEntry[] {
  const toolsByTurn = new Map<string, ChatItem[]>()
  for (const item of items) {
    if (item.kind !== 'tool') continue
    const list = toolsByTurn.get(item.turnId) ?? []
    list.push(item)
    toolsByTurn.set(item.turnId, list)
  }
  const seen = new Set<string>()
  const entries: TranscriptEntry[] = []
  for (const item of items) {
    if (item.kind !== 'tool') {
      entries.push({ type: 'item', item })
      continue
    }
    if (seen.has(item.turnId)) continue
    seen.add(item.turnId)
    entries.push({
      type: 'tools',
      items: toolsByTurn.get(item.turnId) ?? [],
      live: item.turnId === liveTurnId
    })
  }
  return entries
}
