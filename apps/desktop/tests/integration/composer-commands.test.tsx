import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { AgentCommand, AgentSkill } from '@cerebro/core'
import { describe, expect, it, vi } from 'vitest'
import { ComposerEditor } from '@/components/chat/composer-editor'

type ComposerDom = HTMLElement & { editor: Editor }

const commands: AgentCommand[] = [
  {
    id: 'claude:compact',
    name: 'compact',
    description: 'Summarize the conversation',
    argumentHint: '[instructions]',
    source: 'builtin'
  },
  {
    id: 'claude:review',
    name: 'review',
    description: 'Duplicate of the skill',
    argumentHint: '',
    source: 'custom'
  }
]
const skills: AgentSkill[] = [
  {
    id: 'claude:review',
    name: 'review',
    description: 'Review the diff',
    path: '',
    token: '/review',
    prompt: '/review'
  }
]

function composer(): ComposerDom {
  return screen.getByRole('textbox', { name: 'Message agent' }) as ComposerDom
}

function typeIntoComposer(text: string): void {
  for (const char of text) {
    const view = composer().editor.view
    const { from, to } = view.state.selection
    act(() => {
      const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, char))
      if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
    })
  }
}

function renderComposer(onDocument = vi.fn()): void {
  render(
    <ComposerEditor
      defaultText=""
      attachments={[]}
      skills={skills}
      commands={commands}
      workspaceId={7}
      getAttachments={() => []}
      onDocument={onDocument}
      onAttachFiles={() => {}}
      onSubmit={() => {}}
    />
  )
}

describe('composer / commands', () => {
  it('lists commands before skills when / opens the message, and inserts plain text', async () => {
    window.cerebro = {
      listWorkspaceFiles: vi.fn(async () => [])
    } as unknown as typeof window.cerebro
    renderComposer()
    act(() => {
      composer().editor.commands.focus('end')
    })
    typeIntoComposer('/')
    expect(await screen.findByTestId('composer-command-option-compact')).toBeTruthy()
    // A name the harness reports as a skill is offered once, as the skill.
    expect(screen.queryByTestId('composer-command-option-review')).toBeNull()
    expect(screen.getByTestId('composer-skill-option-review')).toBeTruthy()

    act(() => {
      screen
        .getByTestId('composer-command-option-compact')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    expect(composer().editor.getText()).toBe('/compact ')
    expect(composer().querySelector('[data-testid="composer-tag"]')).toBeNull()
  })

  it('offers only skills when / is typed after other text', async () => {
    window.cerebro = {
      listWorkspaceFiles: vi.fn(async () => [])
    } as unknown as typeof window.cerebro
    renderComposer()
    act(() => {
      composer().editor.commands.focus('end')
    })
    typeIntoComposer('please /')
    expect(await screen.findByTestId('composer-skill-option-review')).toBeTruthy()
    expect(screen.queryByTestId('composer-command-option-compact')).toBeNull()
  })
})
