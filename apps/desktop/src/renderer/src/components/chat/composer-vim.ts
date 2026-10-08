import type { Editor } from '@tiptap/core'
import type { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  createVimPlugin,
  getVimStateFromEditorState,
  vimPluginKey,
  type Mode
} from 'vim-prosemirror'
import type { ComposerVimMode } from '@shared/types'
import 'vim-prosemirror/style.css'

export type ComposerVimOptions = { enabled: boolean; initialMode: ComposerVimMode }

export const composerVimKey = vimPluginKey

/** Vim plugin wired to the composer's undo history; registered only while vim mode is on. */
export function createComposerVimPlugin(editor: Editor): Plugin {
  return createVimPlugin({
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo()
  })
}

/** Keys that edit text by default; outside insert mode a command that vim leaves unhandled must not run them. */
const textEditKeys = ['Enter', 'Backspace', 'Delete', 'Tab']

/**
 * Key handling for every mode but insert. Tiptap's keymap runs ahead of plugins registered later, so
 * the editor calls this first: vim gets the key (search and operators included), and anything vim
 * leaves unhandled still cannot split, join or delete text. Returns null when the key is not ours.
 */
export function handleComposerVimKey(
  plugin: Plugin | null,
  view: EditorView,
  event: KeyboardEvent
): boolean | null {
  const mode = getVimStateFromEditorState(view.state)?.mode
  if (!plugin || !mode || mode === 'insert') return null
  if (plugin.props.handleKeyDown?.call(plugin, view, event)) return true
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (!textEditKeys.includes(event.key)) return null
  event.preventDefault()
  return true
}

export function composerVimMode(editor: Editor): Mode | null {
  return getVimStateFromEditorState(editor.state)?.mode ?? null
}

/** The vim state object is shared by the plugin, so mutate it and repaint with an empty transaction. */
export function setComposerVimMode(editor: Editor, mode: ComposerVimMode): void {
  const state = getVimStateFromEditorState(editor.state)
  if (!state) return
  state.mode = mode
  state.visualAnchor = null
  state.visualHead = null
  state.count = null
  state.operator = null
  editor.view.dispatch(editor.state.tr)
}

export const vimModeLabel: Record<Mode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  replace: 'REPLACE'
}
