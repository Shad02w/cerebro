import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerEditor } from '@/components/chat/composer-editor'

type ComposerDom = HTMLElement & { editor: Editor }

function renderComposer(): void {
  function Harness(): React.JSX.Element {
    const [text, setText] = useState('')
    return (
      <ComposerEditor
        defaultText={text}
        attachments={[]}
        skills={[]}
        workspaceId={7}
        getAttachments={() => []}
        onDocument={(next) => setText(next)}
        onAttachFiles={() => {}}
        onSubmit={() => {}}
      />
    )
  }
  render(<Harness />)
}

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

describe('composer @ file list', () => {
  it('shows a file added after the menu was last opened', async () => {
    let files = ['README.md']
    window.cerebro = {
      listWorkspaceFiles: vi.fn(async () => files)
    } as unknown as typeof window.cerebro
    renderComposer()
    const editor = composer().editor
    act(() => {
      editor.commands.focus('end')
    })
    typeIntoComposer('@')
    expect(await screen.findByRole('option', { name: 'README.md' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'src/added.ts' })).toBeNull()

    files = ['README.md', 'src/added.ts']
    act(() => {
      editor.commands.clearContent(true)
    })
    expect(screen.queryByRole('listbox', { name: 'Files' })).toBeNull()
    typeIntoComposer('@')
    expect(await screen.findByRole('option', { name: 'src/added.ts' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'README.md' })).toBeTruthy()
  })
})
