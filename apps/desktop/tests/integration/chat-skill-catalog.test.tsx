import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCatalog, AgentModel, AgentSkillList } from '@cerebro/core'
import { ChatView } from '@/components/chat/chat-view'
import { queryClient } from '@/lib/query-client'

type ComposerDom = HTMLElement & { editor: Editor }

const model: AgentModel = {
  key: 'test',
  instance: 'local',
  harness: 'codex',
  provider: 'test',
  id: 'test',
  label: 'Test',
  source: 'native',
  available: true,
  reasoning: []
}

const skills: AgentSkillList = {
  skills: [
    {
      id: 'codex:review',
      name: 'review',
      description: 'Review the diff',
      path: '',
      token: '$review',
      prompt: '$review'
    }
  ]
}

function typeInto(composer: ComposerDom, text: string): void {
  act(() => {
    composer.editor.commands.focus('end')
  })
  for (const char of text) {
    const view = composer.editor.view
    const { from, to } = view.state.selection
    act(() => {
      const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, char))
      if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
    })
  }
}

describe('chat skill catalog', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => queryClient.clear())

  it('loads skills only when / opens the menu, once for every pane in the workspace', async () => {
    let answer: (value: AgentSkillList) => void = () => {}
    const agentSkills = vi.fn(
      () =>
        new Promise<AgentSkillList>((resolve) => {
          answer = resolve
        })
    )
    const agentCommands = vi.fn(async () => ({ commands: [] }))
    window.cerebro = {
      chatCommand: vi.fn(async () => ({ session: null, sessions: [] })),
      agentCatalog: vi.fn(
        async () =>
          ({
            capabilities: {},
            models: [model],
            favorites: [],
            issues: {}
          }) as unknown as AgentCatalog
      ),
      agentSkills,
      agentCommands,
      listWorkspaceFiles: vi.fn(async () => []),
      chatAttachment: vi.fn()
    } as unknown as typeof window.cerebro
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <div data-testid="pane-2">
          <ChatView workspaceId={1} paneId={2} agentModelDefaults={{}} />
        </div>
        <div data-testid="pane-3">
          <ChatView workspaceId={1} paneId={3} agentModelDefaults={{}} />
        </div>
      </QueryClientProvider>
    )
    const composer = (pane: string): ComposerDom =>
      within(screen.getByTestId(pane)).getByRole('textbox', {
        name: 'Message agent'
      }) as ComposerDom
    await waitFor(() => expect(composer('pane-2')).toBeTruthy())
    await waitFor(() => expect(composer('pane-3')).toBeTruthy())
    // Opening agent panes asks no harness for its lists.
    expect(agentSkills).not.toHaveBeenCalled()
    expect(agentCommands).not.toHaveBeenCalled()

    typeInto(composer('pane-2'), '/')
    expect(await screen.findByTestId('composer-skill-menu-loading')).toBeTruthy()
    await waitFor(() => expect(agentSkills).toHaveBeenCalledTimes(1))
    expect(agentSkills).toHaveBeenCalledWith(1, null, 'codex')
    expect(agentCommands).toHaveBeenCalledTimes(1)

    await act(async () => answer(skills))
    expect(await screen.findByTestId('composer-skill-option-review')).toBeTruthy()
    expect(screen.queryByTestId('composer-skill-menu-loading')).toBeNull()

    // The other pane in the same workspace reuses the list instead of asking again.
    typeInto(composer('pane-3'), '/')
    await waitFor(() =>
      expect(
        within(screen.getByTestId('pane-3')).queryByTestId('composer-skill-menu-loading')
      ).toBeNull()
    )
    expect(agentSkills).toHaveBeenCalledTimes(1)
    expect(agentCommands).toHaveBeenCalledTimes(1)
  })
})
