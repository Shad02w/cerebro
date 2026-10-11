import type { AgentHarness, AgentModality, AgentModel, ChatItem } from '@cerebro/core'
import { readFileSync } from 'node:fs'
import type { AutonomousTurn, RunAttachment, RunContext } from './adapter'

// Helpers shared by every harness adapter. Anything one harness alone needs lives in its own file.
export const modalities = (value: unknown): AgentModality[] =>
  Array.isArray(value)
    ? (value.filter((entry) => entry === 'text' || entry === 'image') as AgentModality[])
    : ['text', 'image']
export const model = (
  harness: AgentHarness,
  provider: string,
  id: string,
  label: string,
  reasoning: string[] = [],
  input: AgentModality[] = ['text', 'image']
): AgentModel => ({
  key: JSON.stringify([harness, 'local', provider, id]),
  instance: 'local',
  harness,
  provider,
  id,
  label,
  reasoning,
  source: 'native',
  available: true,
  modalities: input
})
export const inline = (attachment: RunAttachment): string =>
  readFileSync(attachment.path).toString('base64')
export const item = (
  context: Pick<RunContext, 'emit'>,
  id: string,
  kind: ChatItem['kind'],
  text: string,
  extra: Partial<ChatItem> = {},
  append = false
): void => context.emit({ type: 'item', item: { id, kind, text, ...extra }, append })
/** Grace period for a native interrupt to settle the turn before the process is killed. */
export const interruptGrace = 5000
/**
 * The one in-flight turn of a live connection. A native end-of-turn signal, an interrupt that the
 * harness never acknowledges, or process exit settles it exactly once.
 */
export function activeTurn(
  context: AutonomousTurn['context'],
  settle: AutonomousTurn['settle'],
  native: { interrupt: () => void; close: () => void }
): AutonomousTurn {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const abort = (): void => {
    native.interrupt()
    timer = setTimeout(() => {
      turn.settle(new Error('Turn interrupted.'))
      native.close()
    }, interruptGrace)
  }
  const turn: AutonomousTurn = {
    context,
    settle: (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      context.signal.removeEventListener('abort', abort)
      settle(error)
    }
  }
  if (context.signal.aborted) abort()
  else context.signal.addEventListener('abort', abort, { once: true })
  return turn
}
