import type {
  AgentContextUsage,
  AgentHarness,
  ClaudeContextCategory,
  ClaudeMessageBreakdown,
  CodexContextCall
} from '@cerebro/core'

/** Fixed swatches so the same slice stays the same color across harnesses. */
export const contextSliceColors = {
  systemPrompt: '#c4b5fd',
  systemTools: '#93c5fd',
  mcpTools: '#67e8f9',
  customAgents: '#f9a8d4',
  memoryFiles: '#fcd34d',
  skills: '#86efac',
  userPrompt: '#fdba74',
  assistant: '#a5b4fc',
  toolCalls: '#e879f9',
  toolResults: '#fca5a5',
  attachments: '#d6d3d1',
  buffer: '#71717a',
  free: '#3f3f46',
  deferred: '#a1a1aa',
  used: '#d4d4d8'
} as const

const messagePartColors = [
  contextSliceColors.userPrompt,
  contextSliceColors.assistant,
  contextSliceColors.toolCalls,
  contextSliceColors.toolResults,
  contextSliceColors.attachments
]

/** Messages is one group. Its dot blends the five rows nested under it. */
export const messageGroupColor = (() => {
  let red = 0
  let green = 0
  let blue = 0
  for (const color of messagePartColors) {
    red += Number.parseInt(color.slice(1, 3), 16)
    green += Number.parseInt(color.slice(3, 5), 16)
    blue += Number.parseInt(color.slice(5, 7), 16)
  }
  const channel = (value: number): string =>
    Math.round(value / messagePartColors.length)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`
})()

const namedColors: Record<string, string> = {
  'system prompt': contextSliceColors.systemPrompt,
  'system tools': contextSliceColors.systemTools,
  'mcp tools': contextSliceColors.mcpTools,
  'custom agents': contextSliceColors.customAgents,
  'memory files': contextSliceColors.memoryFiles,
  skills: contextSliceColors.skills,
  messages: messageGroupColor,
  'user prompt': contextSliceColors.userPrompt,
  'assistant messages': contextSliceColors.assistant,
  'tool calls': contextSliceColors.toolCalls,
  'tool results': contextSliceColors.toolResults,
  attachments: contextSliceColors.attachments,
  'autocompact buffer': contextSliceColors.buffer,
  'free space': contextSliceColors.free,
  'mcp tools (deferred)': contextSliceColors.deferred
}

const harnessTitle: Record<AgentHarness, string> = {
  claude: 'Claude',
  codex: 'Codex',
  pi: 'Pi'
}

export type ContextUsageSwatch = 'fill' | 'hollow' | 'hatch'

export type ContextUsageRow = {
  id: string
  label: string
  tokensLabel: string
  /** Null for a deferred row, which is outside the window and has no share. */
  percentLabel: string | null
  color: string
  swatch: ContextUsageSwatch
  expandable: boolean
  children: ContextUsageRow[]
}

export type ContextUsageSection = {
  id: string
  label: string
  rows: ContextUsageRow[]
}

export type ContextUsageSegment = {
  id: string
  tokens: number
  color: string
  hatch: boolean
}

export type ContextUsageViewModel = {
  title: string
  headline: string
  summary: string
  note: string
  ringPercent: number | null
  bar: ContextUsageSegment[] | null
  sections: ContextUsageSection[]
}

const formatTokens = (value: number): string => value.toLocaleString('en-US')

const percentText = (tenths: number): string => `${(tenths / 10).toFixed(1)}%`

/** One-decimal shares. When the tokens fill the window, the labels sum to 100. */
const percentLabels = (tokens: number[], window: number): string[] => {
  if (window <= 0) return tokens.map(() => '0.0%')
  const tenths = tokens.map((count) => Math.round((count / window) * 1000))
  const filled = tokens.reduce((sum, count) => sum + count, 0) === window
  if (filled && tenths.length) {
    const drift = 1000 - tenths.reduce((sum, count) => sum + count, 0)
    if (drift !== 0) {
      let index = 0
      for (let i = 1; i < tenths.length; i++) if (tenths[i] >= tenths[index]) index = i
      tenths[index] += drift
    }
  }
  return tenths.map(percentText)
}

const shareLabel = (tokens: number, window: number): string =>
  percentText(window <= 0 ? 0 : Math.round((tokens / window) * 1000))

const titleFor = (harness: AgentHarness | undefined, modelLabel?: string): string => {
  const name = harness ? harnessTitle[harness] : undefined
  const model = harness === 'pi' ? undefined : modelLabel?.trim() || undefined
  return ['Context', name, model].filter(Boolean).join(' · ')
}

const ringPercentFor = (usage: AgentContextUsage): number | null => {
  if (usage.usedTokens == null) return null
  if (typeof usage.percentage === 'number' && Number.isFinite(usage.percentage))
    return Math.min(100, Math.max(0, Math.round(usage.percentage)))
  if (usage.contextWindow <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((usage.usedTokens / usage.contextWindow) * 100)))
}

const usedSummary = (usage: AgentContextUsage): string => {
  const used = usage.usedTokens ?? 0
  const available = Math.max(0, usage.contextWindow - used)
  return `${formatTokens(used)} used · ${formatTokens(available)} available · ${formatTokens(usage.contextWindow)} window`
}

type DraftRow = {
  id: string
  label: string
  tokens: number
  color: string
  swatch: ContextUsageSwatch
  /** Deferred rows stay out of the percent sum and the bar. */
  outside: boolean
  expandable: boolean
  children: ContextUsageRow[]
  /** Bar pieces for this row. Omitted for free space and deferred rows. */
  segments: ContextUsageSegment[]
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'slice'

const finish = (drafts: DraftRow[], window: number, seen: Set<string>): ContextUsageRow[] => {
  const counted = drafts.filter((row) => !row.outside)
  const labels = percentLabels(
    counted.map((row) => row.tokens),
    window
  )
  let labelIndex = 0
  return drafts.map((row) => {
    const id = uniqueId(row.id, seen)
    const percentLabel = row.outside ? null : labels[labelIndex++]
    return {
      id,
      label: row.label,
      tokensLabel: formatTokens(row.tokens),
      percentLabel,
      color: row.color,
      swatch: row.swatch,
      expandable: row.expandable && row.children.length > 0,
      children: row.children
    }
  })
}

const uniqueId = (base: string, seen: Set<string>): string => {
  let id = base || 'slice'
  let n = 2
  while (seen.has(id)) id = `${base}-${n++}`
  seen.add(id)
  return id
}

const section = (
  id: string,
  label: string,
  rows: ContextUsageRow[]
): ContextUsageSection | undefined => (rows.length ? { id, label, rows } : undefined)

const messageParts: {
  key: keyof ClaudeMessageBreakdown
  id: string
  label: string
  color: string
}[] = [
  {
    key: 'userMessageTokens',
    id: 'user-prompt',
    label: 'User prompt',
    color: contextSliceColors.userPrompt
  },
  {
    key: 'assistantMessageTokens',
    id: 'assistant-messages',
    label: 'Assistant messages',
    color: contextSliceColors.assistant
  },
  {
    key: 'toolCallTokens',
    id: 'tool-calls',
    label: 'Tool calls',
    color: contextSliceColors.toolCalls
  },
  {
    key: 'toolResultTokens',
    id: 'tool-results',
    label: 'Tool results',
    color: contextSliceColors.toolResults
  },
  {
    key: 'attachmentTokens',
    id: 'attachments',
    label: 'Attachments',
    color: contextSliceColors.attachments
  },
  {
    key: 'redirectedContextTokens',
    id: 'redirected-context',
    label: 'Redirected context',
    color: contextSliceColors.deferred
  },
  {
    key: 'unattributedTokens',
    id: 'unattributed',
    label: 'Unattributed',
    color: contextSliceColors.deferred
  }
]

const messageChildren = (
  breakdown: ClaudeMessageBreakdown | undefined,
  window: number
): { rows: ContextUsageRow[]; tokens: number } => {
  if (!breakdown) return { rows: [], tokens: 0 }
  const rows: ContextUsageRow[] = []
  let tokens = 0
  for (const part of messageParts) {
    const count = breakdown[part.key]
    if (typeof count !== 'number' || count <= 0) continue
    tokens += count
    rows.push({
      id: part.id,
      label: part.label,
      tokensLabel: formatTokens(count),
      percentLabel: shareLabel(count, window),
      color: part.color,
      swatch: 'fill',
      expandable: false,
      children: []
    })
  }
  return { rows, tokens }
}

const claudeSegments = (
  category: ClaudeContextCategory,
  children: ContextUsageRow[],
  childTokens: number
): ContextUsageSegment[] => {
  if (category.kind !== 'used' && category.kind !== 'buffer') return []
  const name = category.name.trim().toLowerCase()
  if (name !== 'messages' || !children.length) {
    return [
      {
        id: slug(category.name),
        tokens: category.tokens,
        color: category.kind === 'buffer' ? contextSliceColors.buffer : colorFor(category),
        hatch: category.kind === 'buffer'
      }
    ]
  }
  let room = category.tokens
  const segments: ContextUsageSegment[] = []
  for (const child of children) {
    const tokens = Math.min(tokenCount(child.tokensLabel), room)
    if (tokens <= 0) continue
    room -= tokens
    segments.push({ id: child.id, tokens, color: child.color, hatch: false })
  }
  if (room > 0 && childTokens < category.tokens)
    segments.push({ id: 'messages-rest', tokens: room, color: messageGroupColor, hatch: false })
  return segments
}

const tokenCount = (label: string): number => Number(label.replace(/,/g, ''))

const colorFor = (category: ClaudeContextCategory): string => {
  if (category.kind === 'buffer') return contextSliceColors.buffer
  if (category.kind === 'free') return contextSliceColors.free
  if (category.kind === 'deferred') return contextSliceColors.deferred
  return namedColors[category.name.trim().toLowerCase()] ?? contextSliceColors.used
}

const claudeView = (
  usage: AgentContextUsage,
  meta: { harness?: AgentHarness; modelLabel?: string }
): ContextUsageViewModel => {
  const detail = usage.claude!
  const window = usage.contextWindow
  const messages = messageChildren(detail.messageBreakdown, window)
  const seen = new Set<string>()
  const groups: Record<ClaudeContextCategory['kind'], DraftRow[]> = {
    used: [],
    buffer: [],
    free: [],
    deferred: []
  }
  for (const category of detail.categories) {
    if (category.tokens <= 0) continue
    const name = category.name.trim().toLowerCase()
    const isMessages = category.kind === 'used' && name === 'messages'
    const children = isMessages ? messages.rows : []
    groups[category.kind].push({
      id: slug(category.name),
      label: category.name,
      tokens: category.tokens,
      color: colorFor(category),
      swatch:
        category.kind === 'deferred' ? 'hollow' : category.kind === 'buffer' ? 'hatch' : 'fill',
      outside: category.kind === 'deferred',
      expandable: isMessages && children.length > 0,
      children,
      segments: claudeSegments(category, children, messages.tokens)
    })
  }
  const used = finish(groups.used, window, seen)
  const reserved = finish(groups.buffer, window, seen)
  const remaining = finish(groups.free, window, seen)
  const outside = finish(groups.deferred, window, seen)
  const counted = [...groups.used, ...groups.buffer, ...groups.free]
  // Percents are assigned per section. Recompute across the in-window rows so they sum to 100.
  const labels = percentLabels(
    counted.map((row) => row.tokens),
    window
  )
  const inWindow = [...used, ...reserved, ...remaining]
  inWindow.forEach((row, index) => {
    row.percentLabel = labels[index]
  })
  const deferred = outside.length > 0
  return {
    title: titleFor(meta.harness ?? 'claude', meta.modelLabel),
    headline: `${ringPercentFor(usage) ?? 0}% of context used`,
    summary: usedSummary(usage),
    note: deferred
      ? `Percents are shares of the ${formatTokens(window)} window. Deferred schemas are not in that sum.`
      : `Percents are shares of the ${formatTokens(window)} window.`,
    ringPercent: ringPercentFor(usage),
    bar: counted.flatMap((row) => row.segments),
    sections: [
      section('window', 'IN THE WINDOW', used),
      section('reserved', 'RESERVED', reserved),
      section('remaining', 'REMAINING', remaining),
      section('outside', 'OUTSIDE THE WINDOW', outside)
    ].filter((item): item is ContextUsageSection => item != null)
  }
}

const nested = (
  id: string,
  label: string,
  tokens: number,
  color: string,
  window: number
): ContextUsageRow => ({
  id,
  label,
  tokensLabel: formatTokens(tokens),
  percentLabel: shareLabel(tokens, window),
  color,
  swatch: 'fill',
  expandable: false,
  children: []
})

const take = (amount: number, room: number): number => Math.max(0, Math.min(amount, room))

const codexView = (
  usage: AgentContextUsage,
  meta: { harness?: AgentHarness; modelLabel?: string }
): ContextUsageViewModel => {
  const call: CodexContextCall = usage.codex ?? {}
  const window = usage.contextWindow
  const input = Math.max(0, call.inputTokens ?? 0)
  const cached = Math.max(0, call.cachedInputTokens ?? 0)
  const write = Math.max(0, call.cacheWriteInputTokens ?? 0)
  const output = Math.max(0, call.outputTokens ?? 0)
  const reasoning = Math.max(0, call.reasoningOutputTokens ?? 0)
  const used = Math.max(0, usage.usedTokens ?? 0)
  const free = Math.max(0, window - used)
  const rows: DraftRow[] = []
  const segments: ContextUsageSegment[] = []
  if (input > 0) {
    let room = input
    const cachedDraw = call.cachedInputTokens == null ? 0 : take(cached, room)
    room -= cachedDraw
    const writeDraw = call.cacheWriteInputTokens == null ? 0 : take(write, room)
    room -= writeDraw
    const children: ContextUsageRow[] = []
    if ((call.cachedInputTokens ?? 0) > 0)
      children.push(
        nested('cached-input', 'Cached input', cached, contextSliceColors.systemTools, window)
      )
    if ((call.cacheWriteInputTokens ?? 0) > 0)
      children.push(
        nested('cache-write', 'Cache write', write, contextSliceColors.mcpTools, window)
      )
    if (room > 0)
      segments.push({
        id: 'input',
        tokens: room,
        color: contextSliceColors.systemPrompt,
        hatch: false
      })
    if (cachedDraw > 0)
      segments.push({
        id: 'cached-input',
        tokens: cachedDraw,
        color: contextSliceColors.systemTools,
        hatch: false
      })
    if (writeDraw > 0)
      segments.push({
        id: 'cache-write',
        tokens: writeDraw,
        color: contextSliceColors.mcpTools,
        hatch: false
      })
    rows.push({
      id: 'input',
      label: 'Input',
      tokens: input,
      color: contextSliceColors.systemPrompt,
      swatch: 'fill',
      outside: false,
      expandable: false,
      children,
      segments: []
    })
  }
  if (output > 0) {
    let room = output
    const reasoningDraw = call.reasoningOutputTokens == null ? 0 : take(reasoning, room)
    room -= reasoningDraw
    const children: ContextUsageRow[] = []
    if ((call.reasoningOutputTokens ?? 0) > 0)
      children.push(
        nested('reasoning', 'Reasoning', reasoning, contextSliceColors.toolCalls, window)
      )
    if (room > 0)
      segments.push({
        id: 'output',
        tokens: room,
        color: contextSliceColors.assistant,
        hatch: false
      })
    if (reasoningDraw > 0)
      segments.push({
        id: 'reasoning',
        tokens: reasoningDraw,
        color: contextSliceColors.toolCalls,
        hatch: false
      })
    rows.push({
      id: 'output',
      label: 'Output',
      tokens: output,
      color: contextSliceColors.assistant,
      swatch: 'fill',
      outside: false,
      expandable: false,
      children,
      segments: []
    })
  }
  const seen = new Set<string>()
  const latest = finish(rows, window, seen)
  const remaining =
    free > 0
      ? finish(
          [
            {
              id: 'free-space',
              label: 'Free space',
              tokens: free,
              color: contextSliceColors.free,
              swatch: 'fill',
              outside: false,
              expandable: false,
              children: [],
              segments: []
            }
          ],
          window,
          seen
        )
      : []
  const labels = percentLabels(
    [...rows.map((row) => row.tokens), ...(free > 0 ? [free] : [])],
    window
  )
  ;[...latest, ...remaining].forEach((row, index) => {
    row.percentLabel = labels[index]
  })
  return {
    title: titleFor(meta.harness ?? 'codex', meta.modelLabel),
    headline: `${ringPercentFor(usage) ?? 0}% of context used`,
    summary: usedSummary(usage),
    note: 'Cached input and cache write sit inside input. Reasoning sits inside output. The bar uses those pieces once.',
    ringPercent: ringPercentFor(usage),
    bar: segments,
    sections: [
      section('latest', 'LATEST CALL', latest),
      section('remaining', 'REMAINING', remaining)
    ].filter((item): item is ContextUsageSection => item != null)
  }
}

const estimateView = (
  usage: AgentContextUsage,
  meta: { harness?: AgentHarness; modelLabel?: string }
): ContextUsageViewModel => {
  const window = usage.contextWindow
  const used = Math.max(0, usage.usedTokens ?? 0)
  const free = Math.max(0, window - used)
  const seen = new Set<string>()
  const drafts: DraftRow[] = []
  if (used > 0)
    drafts.push({
      id: 'used',
      label: 'Used',
      tokens: used,
      color: contextSliceColors.used,
      swatch: 'fill',
      outside: false,
      expandable: false,
      children: [],
      segments: [{ id: 'used', tokens: used, color: contextSliceColors.used, hatch: false }]
    })
  if (free > 0)
    drafts.push({
      id: 'free-space',
      label: 'Free space',
      tokens: free,
      color: contextSliceColors.free,
      swatch: 'fill',
      outside: false,
      expandable: false,
      children: [],
      segments: []
    })
  const rows = finish(drafts, window, seen)
  const harness = meta.harness
  return {
    title: titleFor(harness, meta.modelLabel),
    headline: `${ringPercentFor(usage) ?? 0}% of context used`,
    summary: usedSummary(usage),
    note: harness === 'pi' ? 'Pi reports only the total. No category split.' : '',
    ringPercent: ringPercentFor(usage),
    bar: drafts.flatMap((row) => row.segments),
    sections: [section('estimate', '', rows)].filter(
      (item): item is ContextUsageSection => item != null
    )
  }
}

const emptyView = (
  usage: AgentContextUsage,
  meta: { harness?: AgentHarness; modelLabel?: string }
): ContextUsageViewModel => ({
  title: titleFor(meta.harness, meta.modelLabel),
  headline: 'Nothing to report yet',
  summary: `Window ${formatTokens(usage.contextWindow)} · used and available unknown`,
  note:
    meta.harness === 'pi'
      ? 'Compaction cleared the estimate. The ring stays empty until the next reply.'
      : '',
  ringPercent: null,
  bar: null,
  sections: []
})

const hasClaudeRows = (usage: AgentContextUsage): boolean =>
  usage.claude?.categories.some((category) => category.tokens > 0) ?? false

const hasCodexCall = (usage: AgentContextUsage): boolean => usage.codex != null

/** Rows, bar slices, and header copy for the context panel above the composer. */
export function contextUsageView(
  usage: AgentContextUsage,
  meta: { harness?: AgentHarness; modelLabel?: string } = {}
): ContextUsageViewModel {
  if (hasClaudeRows(usage)) return claudeView(usage, meta)
  if (hasCodexCall(usage)) return codexView(usage, meta)
  if (usage.usedTokens == null) return emptyView(usage, meta)
  return estimateView(usage, meta)
}
