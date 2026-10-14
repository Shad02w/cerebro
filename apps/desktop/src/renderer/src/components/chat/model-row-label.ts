import type { AgentModel } from '@cerebro/core'

/**
 * One line for a model row. The harness filter already names the harness, so the row
 * does not repeat it. Pi can offer one model through several providers, so the provider
 * is part of the name when the label does not already say it. A shared label keeps the
 * id only when the provider does not already tell the rows apart.
 */
export function modelRowLabel(
  model: Pick<AgentModel, 'key' | 'label' | 'provider' | 'id'>,
  peers: readonly Pick<AgentModel, 'key' | 'label' | 'provider'>[]
): string {
  const parts = [model.label]
  const providerNamed =
    model.provider !== 'configured' &&
    !model.label.toLowerCase().includes(model.provider.toLowerCase())
  if (providerNamed) parts.push(model.provider)
  const sameName = peers.filter((other) => other.key !== model.key && other.label === model.label)
  const providerSeparates =
    providerNamed && sameName.some((other) => other.provider && other.provider !== model.provider)
  const titled = parts.join(' ').toLowerCase()
  if (
    sameName.length > 0 &&
    !providerSeparates &&
    model.id &&
    !titled.includes(model.id.toLowerCase())
  )
    parts.push(model.id)
  return parts.join(' · ')
}
