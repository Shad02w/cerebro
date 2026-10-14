import type { AgentModel } from '@cerebro/core'

/**
 * One line for a model row. The harness filter already names the harness, so the row
 * does not repeat it. A Pi provider is part of the name when the label does not already
 * say it. A shared label keeps the id that tells the two rows apart.
 */
export function modelRowLabel(
  model: Pick<AgentModel, 'key' | 'label' | 'provider' | 'id'>,
  peers: readonly Pick<AgentModel, 'key' | 'label'>[]
): string {
  const parts = [model.label]
  if (
    model.provider !== 'configured' &&
    !model.label.toLowerCase().includes(model.provider.toLowerCase())
  )
    parts.push(model.provider)
  const collided = peers.some((other) => other.key !== model.key && other.label === model.label)
  const titled = parts.join(' ').toLowerCase()
  if (collided && model.id && !titled.includes(model.id.toLowerCase())) parts.push(model.id)
  return parts.join(' · ')
}
