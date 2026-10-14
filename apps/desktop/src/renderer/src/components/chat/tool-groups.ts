import type { ChatItem } from '@cerebro/core'

export type TranscriptEntry =
  { type: 'item'; item: ChatItem } | { type: 'tools'; items: ChatItem[]; live: boolean }

/** Tool calls and reasoning share one Working section. Text and other items stay outside it. */
function inWorkingGroup(item: ChatItem): boolean {
  return item.kind === 'tool' || item.kind === 'reasoning'
}

/** Every turn id in this transcript, including the session turn before any item exists. */
export function transcriptTurnIds(
  items: readonly Pick<ChatItem, 'turnId'>[] | undefined,
  sessionTurnId: string | undefined
): string[] {
  const ids: string[] = []
  if (sessionTurnId) ids.push(sessionTurnId)
  for (const item of items ?? []) if (!ids.includes(item.turnId)) ids.push(item.turnId)
  return ids
}

/**
 * Turn ids to time while a reply is busy. The session turn is included before any
 * tool or reasoning item exists, and item turn ids are included when they differ.
 */
export function watchedTurns(
  items: readonly Pick<ChatItem, 'kind' | 'turnId'>[] | undefined,
  busy: boolean,
  sessionTurnId: string | undefined
): string[] {
  if (!busy) return []
  const ids: string[] = []
  if (sessionTurnId) ids.push(sessionTurnId)
  for (const item of items ?? []) {
    if (!inWorkingGroup(item)) continue
    if (!ids.includes(item.turnId)) ids.push(item.turnId)
  }
  return ids
}

/**
 * One expandable for every tool call and reasoning block in a turn, placed where the first
 * of those appeared. `live` while that turn is still streaming.
 */
export function transcriptEntries(
  items: readonly ChatItem[],
  liveTurnId?: string
): TranscriptEntry[] {
  const groupedByTurn = new Map<string, ChatItem[]>()
  for (const item of items) {
    if (!inWorkingGroup(item)) continue
    const list = groupedByTurn.get(item.turnId) ?? []
    list.push(item)
    groupedByTurn.set(item.turnId, list)
  }
  const seen = new Set<string>()
  const entries: TranscriptEntry[] = []
  for (const item of items) {
    if (!inWorkingGroup(item)) {
      entries.push({ type: 'item', item })
      continue
    }
    if (seen.has(item.turnId)) continue
    seen.add(item.turnId)
    entries.push({
      type: 'tools',
      items: groupedByTurn.get(item.turnId) ?? [],
      live: item.turnId === liveTurnId
    })
  }
  return entries
}

/** First assistant entry in a turn. The live Working status sits above this entry. */
export function workingAnchorId(
  entries: readonly TranscriptEntry[],
  turnId: string | undefined
): string | null {
  if (!turnId) return null
  for (const entry of entries) {
    const item = entry.type === 'item' ? entry.item : entry.items[0]
    if (!item || item.turnId !== turnId) continue
    if (entry.type === 'item' && entry.item.kind === 'user') continue
    return item.id
  }
  return null
}
