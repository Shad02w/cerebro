/** One user prompt and the assistant text that belongs to it, in session order. */
export type ChatTurnSummary = {
  turnId: string
  /** Flattened user prompt. Empty when the turn has no user text. */
  prompt: string
  /** Flattened assistant text. Empty until the turn produces a text item. */
  response: string
  /** False while this turn is the live running or waiting turn. */
  finished: boolean
}

export type ChatTurnSource = {
  id?: string
  turnId: string
  kind: string
  text: string
}

const titleLimit = 180
const descriptionLimit = 240

/** Distance from the bottom, in pixels, that still counts as the end of the transcript. */
export const chatEndSlack = 80

export function isTranscriptAtEnd(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number
): boolean {
  return scrollHeight - scrollTop - clientHeight < chatEndSlack
}

/** Collapse markdown to a single readable line for the turn preview. */
export function flattenChatPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function preview(value: string, max: number): string {
  const flat = flattenChatPreview(value)
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

/** Turns in first-seen order. The top of the rail is the first question. */
export function chatTurnSummaries(
  items: readonly ChatTurnSource[],
  options: { busyTurnId?: string } = {}
): ChatTurnSummary[] {
  const order: string[] = []
  const prompts = new Map<string, string[]>()
  const responses = new Map<string, string[]>()
  for (const item of items) {
    if (!prompts.has(item.turnId)) {
      order.push(item.turnId)
      prompts.set(item.turnId, [])
      responses.set(item.turnId, [])
    }
    if (item.kind === 'user' && item.text.trim()) prompts.get(item.turnId)?.push(item.text.trim())
    if (item.kind === 'text' && item.text.trim()) responses.get(item.turnId)?.push(item.text.trim())
  }
  return order.map((turnId) => ({
    turnId,
    prompt: preview((prompts.get(turnId) ?? []).join('\n'), titleLimit),
    response: preview((responses.get(turnId) ?? []).join('\n'), descriptionLimit),
    finished: turnId !== options.busyTurnId
  }))
}

/** Item ids that start a turn, in session order. */
export function chatTurnAnchorItemIds(items: readonly { id: string; turnId: string }[]): string[] {
  const seen = new Set<string>()
  const anchors: string[] = []
  for (const item of items) {
    if (seen.has(item.turnId)) continue
    seen.add(item.turnId)
    anchors.push(item.id)
  }
  return anchors
}

/**
 * The turn whose start is nearest above the transcript viewport, or the first turn when none
 * has reached the top yet.
 */
export function activeChatTurn(
  anchors: readonly { turnId: string; top: number }[],
  viewportTop: number,
  slack = 24
): string | null {
  if (!anchors.length) return null
  const ordered = [...anchors].sort((a, b) => a.top - b.top)
  let active = ordered[0].turnId
  for (const anchor of ordered) {
    if (anchor.top <= viewportTop + slack) active = anchor.turnId
  }
  return active
}
