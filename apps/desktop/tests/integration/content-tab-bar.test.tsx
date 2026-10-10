import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceTab } from '@cerebro/core'
import { ContentTabBar } from '@/components/content-tab-bar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { KeybindProvider } from '@/keybinds'

const tabs: WorkspaceTab[] = [1, 2].map((id) => ({
  id,
  kind: 'terminal',
  label: `Terminal ${id}`,
  root: { type: 'pane', id, kind: 'terminal' },
  activePaneId: id
}))

function renderTabBar(): void {
  render(
    <KeybindProvider overrides={null}>
      <SidebarProvider>
        <ContentTabBar
          workspaceId={1}
          tabs={tabs}
          activeTabId={1}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onReorder={vi.fn()}
          onNewTab={vi.fn()}
          onOpenChat={vi.fn()}
          onOpenChanges={vi.fn()}
          onAddPane={vi.fn()}
        />
        <textarea aria-label="Pane input" />
      </SidebarProvider>
    </KeybindProvider>
  )
}

describe('ContentTabBar keyboard drag', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    window.cerebro = {
      onFullScreenChange: () => () => {},
      onMenuClose: () => () => {}
    } as unknown as typeof window.cerebro
  })

  it('cancels a Space-started tab drag when the user clicks into a pane', () => {
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'Terminal 1' })
    const bar = screen.getByTestId('content-tab-bar')
    tab.focus()
    fireEvent.keyDown(tab, { key: ' ', code: 'Space' })
    vi.runAllTimers()
    expect(bar).toHaveAttribute('data-dragging', 'true')

    const input = screen.getByRole('textbox', { name: 'Pane input' })
    fireEvent.pointerDown(input)
    input.focus()
    expect(bar).not.toHaveAttribute('data-dragging')

    // Before the fix the still-running drag treated this Space as a drop and refocused the tab.
    const space = fireEvent.keyDown(input, { key: ' ', code: 'Space' })
    expect(space).toBe(true)
    expect(input).toHaveFocus()
  })
})
