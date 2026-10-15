import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claudeContextUsage, codexContextUsage, piContextUsage } from './context-usage'

test('claude context usage keeps the window split and drops the last API call', () => {
  const usage = claudeContextUsage({
    totalTokens: 70800,
    rawMaxTokens: 200000,
    percentage: 35.4,
    categories: [
      { name: 'System prompt', tokens: 4400, kind: 'used' },
      { name: 'Messages', tokens: 45400, kind: 'used' },
      { name: 'Unused skills', tokens: 0, kind: 'used' },
      { name: 'Free space', tokens: 116200, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 13000, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 6420, kind: 'deferred' },
      { name: 'Mystery', tokens: 10, kind: 'other' }
    ],
    messageBreakdown: {
      userMessageTokens: 8600,
      assistantMessageTokens: 11200,
      toolCallTokens: 4800,
      toolResultTokens: 18400,
      attachmentTokens: 2400,
      redirectedContextTokens: 0,
      unattributedTokens: 0,
      toolCallsByType: [{ name: 'Bash', callTokens: 10, resultTokens: 20 }]
    } as never
  })
  assert.equal(usage?.usedTokens, 70800)
  assert.equal(usage?.contextWindow, 200000)
  assert.equal(usage?.percentage, 35)
  assert.equal(usage?.claude?.categories.length, 6)
  assert.equal(
    usage?.claude?.categories.some((row) => row.name === 'Mystery'),
    false
  )
  assert.deepEqual(usage?.claude?.messageBreakdown, {
    userMessageTokens: 8600,
    assistantMessageTokens: 11200,
    toolCallTokens: 4800,
    toolResultTokens: 18400,
    attachmentTokens: 2400,
    redirectedContextTokens: 0,
    unattributedTokens: 0
  })
  assert.equal('apiUsage' in (usage ?? {}), false)
  assert.equal(usage?.codex, undefined)
})

test('claude context usage without categories stores only the window totals', () => {
  assert.deepEqual(
    claudeContextUsage({ totalTokens: 12345, rawMaxTokens: 200000, percentage: 6 }),
    { usedTokens: 12345, contextWindow: 200000, percentage: 6 }
  )
  assert.equal(claudeContextUsage({ totalTokens: 1 }), undefined)
})

test('codex context usage keeps the latest call and drops the lifetime total', () => {
  const usage = codexContextUsage({
    modelContextWindow: 258400,
    total: { totalTokens: 900000, inputTokens: 800000, outputTokens: 100000 },
    last: {
      totalTokens: 43550,
      inputTokens: 42000,
      cachedInputTokens: 28400,
      cacheWriteInputTokens: 6200,
      outputTokens: 1550,
      reasoningOutputTokens: 480
    }
  })
  assert.deepEqual(usage, {
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
  })
  assert.equal(JSON.stringify(usage).includes('900000'), false)
})

test('codex context usage omits slices the latest call did not send', () => {
  assert.deepEqual(
    codexContextUsage({
      modelContextWindow: 258400,
      total: { totalTokens: 295697 },
      last: { totalTokens: 43759, inputTokens: 42000, outputTokens: 1759 }
    }),
    {
      usedTokens: 43759,
      contextWindow: 258400,
      percentage: 17,
      codex: { inputTokens: 42000, outputTokens: 1759 }
    }
  )
  assert.equal(codexContextUsage({ total: { totalTokens: 1 } }), undefined)
})

test('pi context usage keeps a number, and a null estimate after compaction', () => {
  assert.deepEqual(piContextUsage({ tokens: 6000, contextWindow: 200000, percent: 3 }), {
    usedTokens: 6000,
    contextWindow: 200000,
    percentage: 3
  })
  assert.deepEqual(piContextUsage({ tokens: null, contextWindow: 200000, percent: null }), {
    usedTokens: null,
    contextWindow: 200000,
    percentage: null
  })
  assert.equal(piContextUsage({ tokens: 1, percent: 1 }), undefined)
})
