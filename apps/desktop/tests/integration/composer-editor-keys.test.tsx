import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerEditor } from '@/components/chat/composer-editor'

type ComposerDom = HTMLElement & { editor: Editor }

function renderComposer(
  defaultText: string,
  options?: { variant?: 'composer' | 'message'; onSubmit?: () => void }
): { onSubmit: ReturnType<typeof vi.fn> } {
  const onSubmit = options?.onSubmit ?? vi.fn()
  function Harness(): React.JSX.Element {
    const [text, setText] = useState(defaultText)
    return (
      <ComposerEditor
        defaultText={text}
        attachments={[]}
        skills={[]}
        getAttachments={() => []}
        onDocument={(next) => setText(next)}
        onAttachFiles={() => {}}
        onSubmit={onSubmit}
        variant={options?.variant}
      />
    )
  }
  render(<Harness />)
  return { onSubmit }
}

function composer(): ComposerDom {
  return screen.getByRole('textbox') as ComposerDom
}

/** Puts the caret at the end of the first text block of `typeName` (the list or code, not the trailing paragraph). */
function focusTextblock(typeName: string): void {
  const editor = composer().editor
  let target: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (target != null) return false
    if (node.type.name === typeName && node.isTextblock) {
      target = pos + node.nodeSize - 1
      return false
    }
    return true
  })
  if (target == null) throw new Error(`no ${typeName} textblock`)
  act(() => {
    editor.commands.setTextSelection(target)
  })
}

function press(key: string, init: KeyboardEventInit = {}): void {
  const target = composer()
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    )
  })
}

describe('composer Enter keys', () => {
  it('sends on Enter inside a bullet and keeps the list', () => {
    const { onSubmit } = renderComposer('- Ship it')
    focusTextblock('paragraph')
    const before = composer().getAttribute('data-composer-text')
    press('Enter')
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(composer().querySelectorAll('li')).toHaveLength(1)
    expect(composer()).toHaveAttribute('data-composer-text', before)
  })

  it('uses Shift+Enter to add a bullet and then leave the list', () => {
    const { onSubmit } = renderComposer('- Ship it')
    focusTextblock('paragraph')
    press('Enter', { shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer().querySelectorAll('li')).toHaveLength(2)
    expect(composer()).toHaveAttribute('data-composer-text', '- Ship it\n- \n')
    press('Enter', { shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer().querySelectorAll('li')).toHaveLength(1)
    expect(composer()).toHaveAttribute('data-composer-text', '- Ship it\n')
  })

  it('leaves a lone empty bullet on Shift+Enter without sending', () => {
    const { onSubmit } = renderComposer('- ')
    focusTextblock('paragraph')
    press('Enter', { shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer().querySelectorAll('li')).toHaveLength(0)
    expect(composer()).toHaveAttribute('data-composer-text', '')
  })

  it('inserts a plain newline on Shift+Enter and sends on Enter', () => {
    const { onSubmit } = renderComposer('hello')
    focusTextblock('paragraph')
    press('Enter', { shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer()).toHaveAttribute('data-composer-text', 'hello\n')
    press('Enter')
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(composer()).toHaveAttribute('data-composer-text', 'hello\n')
  })

  it('sends on Enter inside a code block and breaks the line on Shift+Enter', () => {
    const { onSubmit } = renderComposer('```\nconst a = 1\n```')
    focusTextblock('codeBlock')
    const before = composer().getAttribute('data-composer-text')
    press('Enter')
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(composer().editor.isActive('codeBlock')).toBe(true)
    expect(composer()).toHaveAttribute('data-composer-text', before)
    press('Enter', { shiftKey: true })
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(composer().editor.isActive('codeBlock')).toBe(true)
    expect(composer()).toHaveAttribute('data-composer-text', '```\nconst a = 1\n\n```\n')
  })

  it('keeps Enter as a newline while editing a sent prompt', () => {
    const { onSubmit } = renderComposer('- Ship it', { variant: 'message' })
    focusTextblock('paragraph')
    press('Enter')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer().querySelectorAll('li')).toHaveLength(2)
  })
})
