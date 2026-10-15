import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentContextUsage } from '@cerebro/core'
import { ContextUsageRing } from '@/components/chat/context-usage-ring'

const claude: AgentContextUsage = {
  usedTokens: 70800,
  contextWindow: 200000,
  percentage: 35,
  claude: {
    categories: [
      { name: 'System prompt', tokens: 4400, kind: 'used' },
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
      attachmentTokens: 2400
    }
  }
}

describe('ContextUsageRing', () => {
  it('hides the ring when the session has no usage', () => {
    const { container } = render(<ContextUsageRing />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the claude split above the ring and drops the tooltip', async () => {
    const user = userEvent.setup()
    render(<ContextUsageRing usage={claude} harness="claude" modelLabel="Sonnet 5" />)
    const ring = screen.getByTestId('context-usage-ring')
    expect(ring).toHaveAttribute('aria-label', '35% of context used')
    expect(ring).not.toHaveTextContent('35%')
    expect(ring).not.toHaveTextContent('High')
    await user.hover(ring)
    expect(screen.queryByText('70,800 / 200,000 tokens')).toBeNull()
    expect(screen.queryByTestId('context-usage-popover')).toBeNull()
    await user.click(ring)
    const popover = await screen.findByTestId('context-usage-popover')
    expect(ring).toHaveAttribute('data-popup-open')
    expect(popover).toHaveTextContent('Context · Claude · Sonnet 5')
    expect(popover).toHaveTextContent('35% of context used')
    expect(popover).toHaveTextContent('70,800 used · 129,200 available · 200,000 window')
    expect(popover).toHaveTextContent('IN THE WINDOW')
    expect(popover).toHaveTextContent('User prompt')
    expect(popover).toHaveTextContent('8,600')
    expect(popover).toHaveTextContent('4.3%')
    expect(within(popover).queryByText('Unused skills')).toBeNull()
    const deferred = within(popover).getByText('MCP tools (deferred)').closest('li')
    expect(deferred).toHaveTextContent('6,420')
    expect(deferred).toHaveTextContent('—')
    expect(deferred).not.toHaveTextContent('%')
    const bar = within(popover).getByTestId('context-usage-bar')
    const slices = within(bar)
      .getAllByTestId('context-usage-segment')
      .map((segment) => segment.getAttribute('data-slice'))
    expect(slices).not.toContain('free-space')
    expect(slices).not.toContain('mcp-tools-deferred')
    expect(slices).toContain('user-prompt')
    expect(slices).toContain('autocompact-buffer')
    const messages = within(popover).getByRole('button', { name: /Messages/ })
    expect(messages).toHaveAttribute('aria-expanded', 'true')
    await user.click(messages)
    expect(messages).toHaveAttribute('aria-expanded', 'false')
    expect(within(popover).queryByText('User prompt')).toBeNull()
  })

  it('nests codex cache and reasoning inside the latest call', async () => {
    const user = userEvent.setup()
    const usage: AgentContextUsage = {
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
    render(<ContextUsageRing usage={usage} harness="codex" modelLabel="GPT-5.4" />)
    await user.click(screen.getByTestId('context-usage-ring'))
    const popover = await screen.findByTestId('context-usage-popover')
    expect(popover).toHaveTextContent('17% of context used')
    expect(popover).toHaveTextContent('43,550 used · 214,850 available · 258,400 window')
    expect(within(popover).queryByText('System prompt')).toBeNull()
    expect(within(popover).queryByText('User prompt')).toBeNull()
    expect(popover).toHaveTextContent('Cached input')
    expect(popover).toHaveTextContent('Reasoning')
    const tokens = within(popover)
      .getByTestId('context-usage-bar')
      .querySelectorAll('[data-testid="context-usage-segment"]')
    const drawn = [...tokens].reduce(
      (sum, segment) => sum + Number(segment.getAttribute('data-tokens')),
      0
    )
    expect(drawn).toBe(43550)
  })

  it('shows pi used versus free, and an empty ring after compaction', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ContextUsageRing
        usage={{ usedTokens: 6000, contextWindow: 200000, percentage: 3 }}
        harness="pi"
        modelLabel="Kimi K2"
      />
    )
    expect(screen.getByTestId('context-usage-ring')).toHaveAttribute(
      'aria-label',
      '3% of context used'
    )
    expect(screen.getByTestId('context-usage-ring')).not.toHaveTextContent('3%')
    await user.click(screen.getByTestId('context-usage-ring'))
    let popover = await screen.findByTestId('context-usage-popover')
    expect(popover).toHaveTextContent('Context · Pi')
    expect(popover).not.toHaveTextContent('Kimi K2')
    expect(popover).toHaveTextContent('6,000 used · 194,000 available · 200,000 window')
    expect(popover).toHaveTextContent('Pi reports only the total')
    expect(within(popover).getByText('Used')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    rerender(
      <ContextUsageRing
        usage={{ usedTokens: null, contextWindow: 200000, percentage: null }}
        harness="pi"
        modelLabel="Kimi K2"
      />
    )
    const ring = screen.getByTestId('context-usage-ring')
    expect(ring).toHaveAttribute('aria-label', 'Context usage, nothing to report yet')
    expect(ring).not.toHaveTextContent('%')
    expect(ring).not.toHaveTextContent('—')
    await user.click(ring)
    popover = await screen.findByTestId('context-usage-popover')
    expect(popover).toHaveTextContent('Nothing to report yet')
    expect(popover).toHaveTextContent('Window 200,000 · used and available unknown')
    expect(popover).toHaveTextContent('Compaction cleared the estimate')
    expect(within(popover).queryByTestId('context-usage-bar')).toBeNull()
    expect(within(popover).queryByTestId('context-usage-row')).toBeNull()
  })
})
