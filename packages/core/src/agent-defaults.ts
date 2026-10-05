import { agentHarnesses, type AgentHarness, type AgentModel } from './chat'
import type { AgentModelDefaults, LastAgent } from './types'

export type AgentPreferenceState = {
  agentModelDefaults: AgentModelDefaults
  lastAgent: LastAgent | null
}

const availableFirst = (models: readonly AgentModel[]): AgentModel[] => {
  const available = models.filter((model) => model.available)
  return available.length ? available : [...models]
}

/** Model a new agent pane should open with. */
export function resolveNewAgentModel(
  models: readonly AgentModel[],
  defaults: AgentModelDefaults,
  lastAgent: LastAgent | null
): AgentModel | undefined {
  const pool = availableFirst(models)
  if (!pool.length) return undefined
  const pick = (harness: AgentHarness, provider: string): AgentModel | undefined => {
    const scoped = pool.filter((model) => model.harness === harness && model.provider === provider)
    if (!scoped.length) return undefined
    const key = defaults[harness]?.[provider]
    return scoped.find((model) => model.key === key) ?? scoped[0]
  }
  if (lastAgent) {
    const exact = pick(lastAgent.harness, lastAgent.provider)
    if (exact) return exact
    const sameHarness = pool.find((model) => model.harness === lastAgent.harness)
    if (sameHarness) return pick(sameHarness.harness, sameHarness.provider) ?? sameHarness
  }
  const first = pool[0]
  return pick(first.harness, first.provider) ?? first
}

/** Model shown for one harness provider, including the provider's current first model. */
export function defaultModelForScope(
  models: readonly AgentModel[],
  defaults: AgentModelDefaults,
  harness: AgentHarness,
  provider: string
): AgentModel | undefined {
  const scoped = models.filter((model) => model.harness === harness && model.provider === provider)
  const pool = availableFirst(scoped)
  if (!pool.length) return undefined
  const key = defaults[harness]?.[provider]
  return pool.find((model) => model.key === key) ?? pool[0]
}

/**
 * Drop saved model keys the catalog no longer offers and point the last harness at a provider
 * that still has a model. Unset defaults stay unset so the provider's current first model applies.
 */
export function reconcileAgentPreferences(
  models: readonly AgentModel[],
  defaults: AgentModelDefaults,
  lastAgent: LastAgent | null
): AgentPreferenceState & { changed: boolean } {
  const nextDefaults: AgentModelDefaults = {}
  let defaultsChanged = false
  for (const harness of agentHarnesses) {
    const stored = defaults[harness]
    if (!stored) continue
    const providers: Record<string, string> = {}
    for (const [provider, key] of Object.entries(stored)) {
      const scoped = models.filter(
        (model) => model.available && model.harness === harness && model.provider === provider
      )
      if (scoped.some((model) => model.key === key)) {
        providers[provider] = key
        continue
      }
      defaultsChanged = true
      if (scoped[0]) providers[provider] = scoped[0].key
    }
    if (Object.keys(providers).length) nextDefaults[harness] = providers
    else defaultsChanged = true
  }
  let nextLast = lastAgent
  if (lastAgent) {
    const usable = models.some(
      (model) =>
        model.available &&
        model.harness === lastAgent.harness &&
        model.provider === lastAgent.provider
    )
    if (!usable) {
      const sameHarness = models.find(
        (model) => model.available && model.harness === lastAgent.harness
      )
      nextLast = sameHarness
        ? { harness: sameHarness.harness, provider: sameHarness.provider }
        : null
    }
  }
  const lastChanged =
    (nextLast?.harness ?? null) !== (lastAgent?.harness ?? null) ||
    (nextLast?.provider ?? null) !== (lastAgent?.provider ?? null)
  return {
    agentModelDefaults: nextDefaults,
    lastAgent: nextLast,
    changed: defaultsChanged || lastChanged
  }
}

/** Remember a picked model as that provider's default and as the harness for new panes. */
export function rememberAgentModel(
  current: AgentPreferenceState,
  model: AgentModel
): AgentPreferenceState | null {
  const lastAgent = { harness: model.harness, provider: model.provider }
  const previous = current.agentModelDefaults[model.harness]?.[model.provider]
  const sameLast =
    current.lastAgent?.harness === lastAgent.harness &&
    current.lastAgent.provider === lastAgent.provider
  if (sameLast && previous === model.key) return null
  return {
    lastAgent,
    agentModelDefaults: {
      ...current.agentModelDefaults,
      [model.harness]: {
        ...current.agentModelDefaults[model.harness],
        [model.provider]: model.key
      }
    }
  }
}
