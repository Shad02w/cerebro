import type { AgentHarness, AgentModel, ChatItem } from '@cerebro/core'

/** Harnesses that keep one native conversation when the model changes. */
const RESEND_HARNESSES = new Set<AgentHarness>(['claude', 'codex'])

/**
 * Text to put back in an empty composer so the last prompt can be sent again
 * after switching models under the same provider. Claude Code and Codex only;
 * a different harness starts a new conversation, and a draft the user already
 * typed is left alone.
 */
export function messageToResend(input: {
  composerText: string
  attachmentCount: number
  current?: Pick<AgentModel, 'key' | 'harness' | 'provider'>
  next: Pick<AgentModel, 'key' | 'harness' | 'provider'>
  items: Array<Pick<ChatItem, 'kind' | 'text' | 'attachments'>>
}): string | null {
  const current = input.current
  if (!current || !RESEND_HARNESSES.has(input.next.harness)) return null
  if (current.harness !== input.next.harness || current.provider !== input.next.provider)
    return null
  if (current.key === input.next.key) return null
  if (input.composerText.trim() || input.attachmentCount > 0) return null
  for (let index = input.items.length - 1; index >= 0; index--) {
    const item = input.items[index]
    if (item.kind !== 'user') continue
    if (item.attachments?.length) return null
    const text = item.text.trim()
    return text || null
  }
  return null
}
