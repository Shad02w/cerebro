import type {
  AgentContextUsage,
  ClaudeContextCategory,
  ClaudeContextCategoryKind,
  ClaudeMessageBreakdown,
  CodexContextCall
} from '@cerebro/core'

const categoryKinds = ['used', 'free', 'buffer', 'deferred'] as const

const isKind = (value: unknown): value is ClaudeContextCategoryKind =>
  typeof value === 'string' && (categoryKinds as readonly string[]).includes(value)

export type ClaudeContextUsageInput = {
  totalTokens?: number
  rawMaxTokens?: number
  percentage?: number
  categories?: ReadonlyArray<{
    name?: string
    tokens?: number
    kind?: string
  }>
  messageBreakdown?: {
    userMessageTokens?: number
    assistantMessageTokens?: number
    toolCallTokens?: number
    toolResultTokens?: number
    attachmentTokens?: number
    redirectedContextTokens?: number
    unattributedTokens?: number
  } | null
}

const breakdownFields = [
  'userMessageTokens',
  'assistantMessageTokens',
  'toolCallTokens',
  'toolResultTokens',
  'attachmentTokens',
  'redirectedContextTokens',
  'unattributedTokens'
] as const satisfies readonly (keyof ClaudeMessageBreakdown)[]

const messageBreakdown = (
  input: ClaudeContextUsageInput['messageBreakdown']
): ClaudeMessageBreakdown | undefined => {
  if (!input) return
  const breakdown: ClaudeMessageBreakdown = {}
  for (const field of breakdownFields) {
    const value = input[field]
    if (typeof value === 'number' && Number.isFinite(value)) breakdown[field] = value
  }
  return Object.keys(breakdown).length ? breakdown : undefined
}

/** Keep the Claude window split the popover draws. Drop drill-in lists and the last API call. */
export function claudeContextUsage(usage: ClaudeContextUsageInput): AgentContextUsage | undefined {
  if (typeof usage.rawMaxTokens !== 'number' || !(usage.rawMaxTokens > 0)) return
  if (typeof usage.totalTokens !== 'number' || !Number.isFinite(usage.totalTokens)) return
  const categories: ClaudeContextCategory[] = []
  for (const category of usage.categories ?? []) {
    if (typeof category.name !== 'string' || !category.name.trim()) continue
    if (typeof category.tokens !== 'number' || !Number.isFinite(category.tokens)) continue
    if (!isKind(category.kind)) continue
    categories.push({ name: category.name, tokens: category.tokens, kind: category.kind })
  }
  const breakdown = messageBreakdown(usage.messageBreakdown)
  return {
    usedTokens: usage.totalTokens,
    contextWindow: usage.rawMaxTokens,
    percentage:
      typeof usage.percentage === 'number' && Number.isFinite(usage.percentage)
        ? Math.round(usage.percentage)
        : Math.round((usage.totalTokens / usage.rawMaxTokens) * 100),
    ...(categories.length || breakdown
      ? {
          claude: {
            categories,
            ...(breakdown ? { messageBreakdown: breakdown } : {})
          }
        }
      : {})
  }
}

export type CodexContextUsageInput = {
  modelContextWindow?: number
  last?: {
    totalTokens?: number
    inputTokens?: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
    outputTokens?: number
    reasoningOutputTokens?: number
  }
  /** Lifetime sum. Never a share of the window. */
  total?: unknown
}

const codexFields = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens'
] as const satisfies readonly (keyof CodexContextCall)[]

/** Keep the latest Codex call. `total` is the lifetime sum and is not copied. */
export function codexContextUsage(usage: CodexContextUsageInput): AgentContextUsage | undefined {
  const usedTokens = usage.last?.totalTokens
  const contextWindow = usage.modelContextWindow
  if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens)) return
  if (typeof contextWindow !== 'number' || !(contextWindow > 0)) return
  const call: CodexContextCall = {}
  for (const field of codexFields) {
    const value = usage.last?.[field]
    if (typeof value === 'number' && Number.isFinite(value)) call[field] = value
  }
  return {
    usedTokens,
    contextWindow,
    percentage: Math.round((usedTokens / contextWindow) * 100),
    ...(Object.keys(call).length ? { codex: call } : {})
  }
}

export type PiContextUsageInput = {
  tokens?: number | null
  contextWindow?: number | null
  percent?: number | null
}

/**
 * Pi's estimate. After compaction `tokens` and `percent` are null while the window remains.
 * Lifetime session counters are not on this payload and are not stored.
 */
export function piContextUsage(usage: PiContextUsageInput): AgentContextUsage | undefined {
  if (typeof usage.contextWindow !== 'number' || !(usage.contextWindow > 0)) return
  const tokens =
    typeof usage.tokens === 'number' && Number.isFinite(usage.tokens) ? usage.tokens : null
  const percentage =
    tokens == null
      ? null
      : typeof usage.percent === 'number' && Number.isFinite(usage.percent)
        ? Math.round(usage.percent)
        : Math.round((tokens / usage.contextWindow) * 100)
  return {
    usedTokens: tokens,
    contextWindow: usage.contextWindow,
    percentage
  }
}
