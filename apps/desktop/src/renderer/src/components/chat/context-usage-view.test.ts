import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentContextUsage } from '@cerebro/core'
import {
  contextSliceColors,
  contextUsageView,
  messageGroupColor,
  type ContextUsageRow,
  type ContextUsageViewModel
} from './context-usage-view'

const claude: AgentContextUsage = {
  usedTokens: 70800,
  contextWindow: 200000,
  percentage: 35,
  claude: {
    categories: [
      { name: 'System prompt', tokens: 4400, kind: 'used' },
      { name: 'System tools', tokens: 12800, kind: 'used' },
      { name: 'MCP tools', tokens: 3200, kind: 'used' },
      { name: 'Custom agents', tokens: 1600, kind: 'used' },
      { name: 'Memory files', tokens: 2200, kind: 'used' },
      { name: 'Skills', tokens: 1200, kind: 'used' },
      { name: 'Messages', tokens: 45400, kind: 'used' },
      { name: 'Unused skills', tokens: 0, kind: 'used' },
      { name: 'Free space', tokens: 116200, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 13000, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 6420, kind: 'deferred' }
    ],
    messageBreakdown: {
      userMessageTokens: 8600,
      assistantMessageTokens: 11200,
      toolCallTokens: 4800,
      toolResultTokens: 18400,
      attachmentTokens: 2400,
      redirectedContextTokens: 0,
      unattributedTokens: 0
    }
  }
}

const codex: AgentContextUsage = {
  usedTokens: 43550,
  contextWindow: 258400,
  percentage: 17,
  codex: {
    inputTokens: 42000,
    cachedInputTokens: 28400,
    cacheWriteInputTokens: 6200,
    outputTokens: 1550,
    reasoningOutputTokens: 480
  }
}

const flat = (view: ContextUsageViewModel): ContextUsageRow[] =>
  view.sections.flatMap((section) => section.rows)

const percentSum = (rows: ContextUsageRow[]): number =>
  rows.reduce((sum, row) => sum + (row.percentLabel ? Number.parseFloat(row.percentLabel) : 0), 0)

test('claude window rows, message split, buffer, free space, and deferred stay apart', () => {
  const view = contextUsageView(claude, { harness: 'claude', modelLabel: 'Sonnet 5' })
  assert.equal(view.title, 'Context · Claude · Sonnet 5')
  assert.equal(view.headline, '35% of context used')
  assert.equal(view.summary, '70,800 used · 129,200 available · 200,000 window')
  assert.equal(view.ringPercent, 35)
  assert.match(view.note, /200,000 window/)
  assert.match(view.note, /Deferred schemas are not in that sum/)
  const labels = view.sections.map((section) => section.label)
  assert.deepEqual(labels, ['IN THE WINDOW', 'RESERVED', 'REMAINING', 'OUTSIDE THE WINDOW'])
  const rows = flat(view)
  assert.deepEqual(
    rows.map((row) => [row.label, row.tokensLabel, row.percentLabel]),
    [
      ['System prompt', '4,400', '2.2%'],
      ['System tools', '12,800', '6.4%'],
      ['MCP tools', '3,200', '1.6%'],
      ['Custom agents', '1,600', '0.8%'],
      ['Memory files', '2,200', '1.1%'],
      ['Skills', '1,200', '0.6%'],
      ['Messages', '45,400', '22.7%'],
      ['Autocompact buffer', '13,000', '6.5%'],
      ['Free space', '116,200', '58.1%'],
      ['MCP tools (deferred)', '6,420', null]
    ]
  )
  assert.equal(
    rows.some((row) => row.label === 'Unused skills'),
    false
  )
  const messages = rows.find((row) => row.id === 'messages')
  assert.equal(messages?.expandable, true)
  assert.equal(messages?.color, messageGroupColor)
  assert.deepEqual(
    messages?.children.map((row) => [row.label, row.tokensLabel, row.percentLabel, row.color]),
    [
      ['User prompt', '8,600', '4.3%', contextSliceColors.userPrompt],
      ['Assistant messages', '11,200', '5.6%', contextSliceColors.assistant],
      ['Tool calls', '4,800', '2.4%', contextSliceColors.toolCalls],
      ['Tool results', '18,400', '9.2%', contextSliceColors.toolResults],
      ['Attachments', '2,400', '1.2%', contextSliceColors.attachments]
    ]
  )
  assert.equal(percentSum(rows.filter((row) => row.percentLabel)), 100)
  const bar = view.bar ?? []
  assert.equal(
    bar.reduce((sum, segment) => sum + segment.tokens, 0),
    70800 + 13000
  )
  assert.equal(
    bar.some((segment) => segment.id === 'mcp-tools-deferred'),
    false
  )
  assert.equal(
    bar.some((segment) => segment.id === 'free-space'),
    false
  )
  assert.equal(
    bar.some((segment) => segment.id === 'messages'),
    false
  )
  assert.equal(bar.find((segment) => segment.id === 'autocompact-buffer')?.hatch, true)
  assert.deepEqual(
    bar.filter((segment) => segment.id !== 'autocompact-buffer').map((segment) => segment.tokens),
    [4400, 12800, 3200, 1600, 2200, 1200, 8600, 11200, 4800, 18400, 2400]
  )
})

test('codex draws the latest call once and ignores a lifetime total', () => {
  const view = contextUsageView(codex, { harness: 'codex', modelLabel: 'GPT-5.4' })
  assert.equal(view.title, 'Context · Codex · GPT-5.4')
  assert.equal(view.headline, '17% of context used')
  assert.equal(view.summary, '43,550 used · 214,850 available · 258,400 window')
  assert.match(view.note, /bar uses those pieces once/)
  const rows = flat(view)
  assert.deepEqual(
    rows.map((row) => [row.label, row.tokensLabel, row.percentLabel]),
    [
      ['Input', '42,000', '16.3%'],
      ['Output', '1,550', '0.6%'],
      ['Free space', '214,850', '83.1%']
    ]
  )
  assert.deepEqual(
    rows[0].children.map((row) => [row.label, row.tokensLabel, row.percentLabel, row.color]),
    [
      ['Cached input', '28,400', '11.0%', contextSliceColors.systemTools],
      ['Cache write', '6,200', '2.4%', contextSliceColors.mcpTools]
    ]
  )
  assert.deepEqual(
    rows[1].children.map((row) => [row.label, row.percentLabel, row.color]),
    [['Reasoning', '0.2%', contextSliceColors.toolCalls]]
  )
  assert.equal(
    rows.some((row) => /system prompt|user prompt/i.test(row.label)),
    false
  )
  assert.equal(
    rows.some((row) => row.tokensLabel === '900,000'),
    false
  )
  assert.equal(percentSum(rows), 100)
  const bar = view.bar ?? []
  assert.deepEqual(
    bar.map((segment) => [segment.id, segment.tokens, segment.color]),
    [
      ['input', 7400, contextSliceColors.systemPrompt],
      ['cached-input', 28400, contextSliceColors.systemTools],
      ['cache-write', 6200, contextSliceColors.mcpTools],
      ['output', 1070, contextSliceColors.assistant],
      ['reasoning', 480, contextSliceColors.toolCalls]
    ]
  )
  assert.equal(
    bar.reduce((sum, segment) => sum + segment.tokens, 0),
    43550
  )
})

test('codex without nested slices does not invent them', () => {
  const view = contextUsageView(
    {
      usedTokens: 43759,
      contextWindow: 258400,
      percentage: 17,
      codex: { inputTokens: 42000, outputTokens: 1759 }
    },
    { harness: 'codex', modelLabel: 'Test Model' }
  )
  const rows = flat(view)
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Input', 'Output', 'Free space']
  )
  assert.equal(rows[0].children.length, 0)
  assert.equal(rows[1].children.length, 0)
})

test('pi with a number is one used-versus-free bar', () => {
  const view = contextUsageView(
    { usedTokens: 6000, contextWindow: 200000, percentage: 3 },
    { harness: 'pi', modelLabel: 'Kimi K2' }
  )
  assert.equal(view.title, 'Context · Pi')
  assert.equal(view.headline, '3% of context used')
  assert.equal(view.summary, '6,000 used · 194,000 available · 200,000 window')
  assert.equal(view.note, 'Pi reports only the total. No category split.')
  assert.equal(view.sections[0].label, '')
  const rows = flat(view)
  assert.deepEqual(
    rows.map((row) => [row.label, row.tokensLabel, row.percentLabel, row.color]),
    [
      ['Used', '6,000', '3.0%', contextSliceColors.used],
      ['Free space', '194,000', '97.0%', contextSliceColors.free]
    ]
  )
  assert.equal(percentSum(rows), 100)
  assert.deepEqual(view.bar, [
    { id: 'used', tokens: 6000, color: contextSliceColors.used, hatch: false }
  ])
})

test('pi after compaction has an empty ring and no bar', () => {
  const view = contextUsageView(
    { usedTokens: null, contextWindow: 200000, percentage: null },
    { harness: 'pi', modelLabel: 'Kimi K2' }
  )
  assert.equal(view.title, 'Context · Pi')
  assert.equal(view.headline, 'Nothing to report yet')
  assert.equal(view.summary, 'Window 200,000 · used and available unknown')
  assert.match(view.note, /Compaction cleared the estimate/)
  assert.equal(view.ringPercent, null)
  assert.equal(view.bar, null)
  assert.equal(view.sections.length, 0)
})

test('rounding drift on a full window still sums to 100', () => {
  const view = contextUsageView({
    usedTokens: 2,
    contextWindow: 3,
    percentage: 67,
    codex: { inputTokens: 1, outputTokens: 1 }
  })
  const rows = flat(view)
  assert.equal(percentSum(rows), 100)
})
