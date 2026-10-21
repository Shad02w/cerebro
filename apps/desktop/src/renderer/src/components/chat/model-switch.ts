import type { AgentHarness, AgentModel } from '@cerebro/core'
import { claudeDefaultAliasTarget } from '@/lib/claude-default-alias'

/** Harnesses that keep one native conversation when the model changes. */
const LIVE_SWITCH_HARNESSES = new Set<AgentHarness>(['claude', 'codex'])

type SwitchModel = Pick<AgentModel, 'key' | 'harness' | 'provider' | 'id' | 'label'>

/**
 * What a mid-conversation model change costs, as a notice, or null when nothing changes.
 * Claude Code and Codex keep the conversation but key their prompt cache per model, so the
 * next message re-reads the whole context instead of reusing cached input tokens.
 * A Claude `default` alias resolves to the model it names, so picking between those two
 * rows is not a change.
 */
export function modelSwitchNotice(input: {
  current?: SwitchModel
  next: SwitchModel
  sessionStarted: boolean
  models?: readonly SwitchModel[]
}): string | null {
  const { current, next, sessionStarted, models } = input
  if (!sessionStarted || !current) return null
  if (current.harness !== next.harness) return null
  if (!LIVE_SWITCH_HARNESSES.has(next.harness)) return null
  const resolve = (model: SwitchModel): SwitchModel =>
    (models && claudeDefaultAliasTarget(model, models)) || model
  const before = resolve(current)
  const after = resolve(next)
  if (before.key === after.key) return null
  return `Now using ${after.label}. This conversation stays, but its prompt cache starts over — the next message re-reads the full context.`
}
