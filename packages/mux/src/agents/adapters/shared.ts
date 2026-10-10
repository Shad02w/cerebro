import type { AgentHarness, AgentModality, AgentModel, ChatItem } from '@cerebro/core'
import { readFileSync } from 'node:fs'
import type { RunAttachment, RunContext } from './adapter'

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
  context: RunContext,
  id: string,
  kind: ChatItem['kind'],
  text: string,
  extra: Partial<ChatItem> = {},
  append = false
): void => context.emit({ type: 'item', item: { id, kind, text, ...extra }, append })
