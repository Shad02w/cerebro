import { useId, useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AgentContextUsage, AgentHarness } from '@cerebro/core'
import { ContextUsagePanel, ContextUsageTrigger } from '@/components/chat/context-usage-panel'

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

function Harness({
  usage,
  harness,
  modelLabel
}: {
  usage?: AgentContextUsage
  harness?: AgentHarness
  modelLabel?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div>
      <ContextUsagePanel
        usage={usage}
        harness={harness}
        modelLabel={modelLabel}
        open={open}
        id={id}
        onClose={() => setOpen(false)}
      />
      <ContextUsageTrigger
        usage={usage}
        harness={harness}
        modelLabel={modelLabel}
        open={open}
        controls={id}
        onToggle={() => setOpen((value) => !value)}
      />
    </div>
  )
}

describe('ContextUsageTrigger and ContextUsagePanel', () => {
  it('renders nothing when the session has no usage', () => {
    render(<Harness />)
    expect(screen.queryByTestId('context-usage-ring')).toBeNull()
    expect(screen.queryByTestId('context-usage-panel')).toBeNull()
  })

  it('opens the claude split above the composer and keeps the tooltip away', async () => {
    const user = userEvent.setup()
    render(<Harness usage={claude} harness="claude" modelLabel="Sonnet 5" />)
    const ring = screen.getByTestId('context-usage-ring')
    expect(ring).toHaveAttribute('aria-label', '35% of context used')
    expect(ring).toHaveAttribute('aria-expanded', 'false')
    expect(ring).not.toHaveTextContent('35%')
    expect(screen.queryByTestId('context-usage-panel')).toBeNull()
    await user.hover(ring)
    expect(screen.queryByText('70,800 / 200,000 tokens')).toBeNull()
    await user.click(ring)
    const panel = await screen.findByTestId('context-usage-panel')
    expect(ring).toHaveAttribute('aria-expanded', 'true')
    expect(ring).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveTextContent('Context · Claude · Sonnet 5')
    expect(panel).toHaveTextContent('35% of context used')
    expect(panel).toHaveTextContent('70,800 used · 129,200 available · 200,000 window')
    expect(panel).toHaveTextContent('IN THE WINDOW')
    expect(panel).toHaveTextContent('User prompt')
    expect(panel).toHaveTextContent('8,600')
    expect(panel).toHaveTextContent('4.3%')
    expect(within(panel).queryByText('Unused skills')).toBeNull()
    const deferred = within(panel).getByText('MCP tools (deferred)').closest('li')
    expect(deferred).toHaveTextContent('6,420')
    expect(deferred).toHaveTextContent('—')
    expect(deferred).not.toHaveTextContent('%')
    const bar = within(panel).getByTestId('context-usage-bar')
    const slices = within(bar)
      .getAllByTestId('context-usage-segment')
      .map((segment) => segment.getAttribute('data-slice'))
    expect(slices).not.toContain('free-space')
    expect(slices).not.toContain('mcp-tools-deferred')
    expect(slices).toContain('user-prompt')
    expect(slices).toContain('autocompact-buffer')
    const messages = within(panel).getByRole('button', { name: /Messages/ })
    expect(messages).toHaveAttribute('aria-expanded', 'true')
    await user.click(messages)
    expect(messages).toHaveAttribute('aria-expanded', 'false')
    expect(within(panel).queryByText('User prompt')).toBeNull()
    await user.click(ring)
    expect(screen.queryByTestId('context-usage-panel')).toBeNull()
    expect(ring).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes from the panel close control', async () => {
    const user = userEvent.setup()
    render(<Harness usage={claude} harness="claude" modelLabel="Sonnet 5" />)
    await user.click(screen.getByTestId('context-usage-ring'))
    const panel = await screen.findByTestId('context-usage-panel')
    await user.click(within(panel).getByRole('button', { name: 'Close context usage' }))
    expect(screen.queryByTestId('context-usage-panel')).toBeNull()
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
    render(<Harness usage={usage} harness="codex" modelLabel="GPT-5.4" />)
    await user.click(screen.getByTestId('context-usage-ring'))
    const panel = await screen.findByTestId('context-usage-panel')
    expect(panel).toHaveTextContent('17% of context used')
    expect(panel).toHaveTextContent('43,550 used · 214,850 available · 258,400 window')
    expect(within(panel).queryByText('System prompt')).toBeNull()
    expect(within(panel).queryByText('User prompt')).toBeNull()
    expect(panel).toHaveTextContent('Cached input')
    expect(panel).toHaveTextContent('Reasoning')
    const tokens = within(panel)
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
    render(
      <Harness
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
    const panel = await screen.findByTestId('context-usage-panel')
    expect(panel).toHaveTextContent('Context · Pi')
    expect(panel).not.toHaveTextContent('Kimi K2')
    expect(panel).toHaveTextContent('6,000 used · 194,000 available · 200,000 window')
    expect(panel).toHaveTextContent('Pi reports only the total')
    expect(within(panel).getByText('Used')).toBeInTheDocument()
  })

  it('opens an empty usage panel after a compaction clears the estimate', async () => {
    const user = userEvent.setup()
    render(
      <Harness
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
    const panel = await screen.findByTestId('context-usage-panel')
    expect(panel).toHaveTextContent('Nothing to report yet')
    expect(panel).toHaveTextContent('Window 200,000 · used and available unknown')
    expect(panel).toHaveTextContent('Compaction cleared the estimate')
    expect(within(panel).queryByTestId('context-usage-bar')).toBeNull()
    expect(within(panel).queryByTestId('context-usage-row')).toBeNull()
  })
})
