import type { AgentModel } from '@cerebro/core'

/**
 * Claude's `default` alias follows the account default. That currently resolves to the same
 * model as another row (Sonnet 5.5), and the alias label names it (`Default · Sonnet 5.5`).
 * The named row is the one to show.
 */
export function claudeDefaultAliasTarget(
  model: Pick<AgentModel, 'key' | 'harness' | 'provider' | 'id' | 'label'>,
  models: readonly Pick<AgentModel, 'key' | 'harness' | 'provider' | 'id' | 'label'>[]
): (typeof models)[number] | undefined {
  if (model.harness !== 'claude' || model.id !== 'default') return
  // A saved selection can still carry yesterday's label. Prefer the catalog's current one.
  const source = models.find((other) => other.key === model.key) ?? model
  const named = source.label.split(' · ').slice(1).join(' · ').trim()
  const targetLabel = named || (/^default\b/i.test(source.label) ? '' : source.label)
  if (!targetLabel) return
  return models.find(
    (other) =>
      other.key !== source.key &&
      other.harness === 'claude' &&
      other.provider === source.provider &&
      other.id !== 'default' &&
      other.label === targetLabel
  )
}

/** Drop a default alias, and show the model it names in its place. */
export function collapseClaudeDefaultAliases<T extends AgentModel>(
  rows: readonly T[],
  catalog: readonly T[]
): T[] {
  const hidden = new Map<string, T>()
  for (const model of catalog) {
    const target = claudeDefaultAliasTarget(model, catalog)
    if (target) hidden.set(model.key, target as T)
  }
  const seen = new Set<string>()
  const next: T[] = []
  for (const row of rows) {
    const model = hidden.get(row.key) ?? row
    if (hidden.has(model.key) || seen.has(model.key)) continue
    seen.add(model.key)
    next.push(model)
  }
  return next
}

/** The row a selection should highlight. A hidden default alias highlights the model it names. */
export function claudeAliasSelection<T extends AgentModel>(
  selected: T | undefined,
  catalog: readonly T[]
): T | undefined {
  if (!selected) return selected
  const target = claudeDefaultAliasTarget(selected, catalog)
  return (target as T | undefined) ?? selected
}
