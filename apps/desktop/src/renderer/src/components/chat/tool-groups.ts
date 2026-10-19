import type { AgentBackgroundTask, AgentSubagent, ChatItem } from '@cerebro/core'

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

/**
 * Turns that hold back End of response while the session still has a child agent or background
 * task running: the turn that started the earliest of that work and every turn after it. When
 * no running work names its turn, only the latest turn waits.
 */
export function heldTurnIds(
  items: readonly Pick<ChatItem, 'id' | 'turnId'>[],
  work: {
    subagents?: ReadonlyArray<Pick<AgentSubagent, 'status' | 'turnId'>>
    background?: ReadonlyArray<Pick<AgentBackgroundTask, 'status' | 'itemId'>>
  }
): Set<string> {
  const children = (work.subagents ?? []).filter(
    (child) => child.status === 'created' || child.status === 'running'
  )
  const tasks = (work.background ?? []).filter((task) => task.status === 'running')
  if (!children.length && !tasks.length) return new Set()
  const order = [...new Set(items.map((item) => item.turnId))]
  // Session item ids are `${turnId}:${native id}`. A task names its item by the native id.
  const turnOfNative = new Map<string, string>()
  for (const item of items)
    if (item.id.startsWith(`${item.turnId}:`))
      turnOfNative.set(item.id.slice(item.turnId.length + 1), item.turnId)
  const launched = new Set<string>()
  for (const child of children) if (child.turnId) launched.add(child.turnId)
  for (const task of tasks) {
    const origin = task.itemId ? turnOfNative.get(task.itemId) : undefined
    if (origin) launched.add(origin)
  }
  const first = order.findIndex((turnId) => launched.has(turnId))
  return new Set(first === -1 ? order.slice(-1) : order.slice(first))
}

/** Turns made only of agent or background-task outcome lines. They are not a response to end. */
export function outcomeTurnIds(
  items: readonly Pick<ChatItem, 'kind' | 'turnId' | 'agent' | 'task'>[]
): Set<string> {
  const outcome = new Set<string>()
  const other = new Set<string>()
  for (const item of items)
    (item.kind === 'notice' && (item.agent || item.task) ? outcome : other).add(item.turnId)
  for (const turnId of other) outcome.delete(turnId)
  return outcome
}
