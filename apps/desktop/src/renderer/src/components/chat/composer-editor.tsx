import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  ReactRenderer,
  useEditor,
  useEditorState
} from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension, Node, mergeAttributes, type Editor, type Extensions } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'
import { chatImageMarker, type ChatAttachmentUpload } from '@cerebro/core'
import { cn } from '@/lib/utils'
import { imageFiles, type Chip } from './chat-attachments'
import {
  addTags,
  codeLanguages,
  promoteAddTagTransaction,
  serializeDocument,
  serializedOffset,
  textToContent,
  visitAddTagText,
  type TagOption
} from './composer-document'
import {
  composerVimKey,
  handleComposerVimKey,
  composerVimMode,
  createComposerVimPlugin,
  setComposerVimMode,
  type ComposerVimOptions
} from './composer-vim'
import type { Mode } from 'vim-prosemirror'
import './composer-editor.css'

const lowlight = createLowlight(common)
const addTagKey = new PluginKey('addTag')
const addTagHighlightKey = new PluginKey('addTagHighlight')

const AddTagHighlight = Extension.create({
  name: 'addTagHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: addTagHighlightKey,
        appendTransaction(transactions, _oldState, state) {
          if (
            !transactions.some((transaction) => transaction.docChanged || transaction.selectionSet)
          )
            return null
          if (transactions.some((transaction) => transaction.getMeta('addTagPromotion')))
            return null
          if (transactions.some((transaction) => transaction.getMeta('composition'))) return null
          const tr = promoteAddTagTransaction(state)
          if (!tr) return null
          tr.setMeta('addTagPromotion', true)
          return tr
        },
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            visitAddTagText(state, (_match, from, to) => {
              decorations.push(
                Decoration.inline(from, to, {
                  class: 'composer-tag',
                  'data-testid': 'composer-tag'
                })
              )
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})

export type ComposerEditorHandle = {
  insertAttachment: (attachmentId: string) => void
  removeAttachment: (attachmentId: string) => void
  clear: () => void
  focus: () => void
}

type TagMenuHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const languageLabel = (id: string | null): string =>
  codeLanguages.find(([value]) => value === (id ?? 'plaintext'))?.[1] ?? 'Plain text'

function deleteChip(view: EditorView, attachmentId: string): void {
  let tr = view.state.tr
  const positions: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'imageChip' && node.attrs.attachmentId === attachmentId)
      positions.push(pos)
  })
  for (const pos of positions.reverse()) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    let from = pos
    let to = pos + node.nodeSize
    const after = tr.doc.resolve(Math.min(to, tr.doc.content.size)).nodeAfter
    const before = tr.doc.resolve(from).nodeBefore
    if (after?.isText && after.text?.startsWith(' ')) to += 1
    else if (before?.isText && before.text?.endsWith(' ')) from -= 1
    tr = tr.delete(from, to)
  }
  if (tr.docChanged) view.dispatch(tr)
}

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps): React.JSX.Element {
  const language = (node.attrs.language as string | null) ?? 'plaintext'
  const editable = editor.isEditable
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<DOMRect | null>(null)
  const toggle = (): void => {
    const next = !open
    setBox(button.current?.getBoundingClientRect() ?? null)
    setOpen(next)
  }
  return (
    <NodeViewWrapper className="composer-code-block" data-testid="composer-code-block">
      <div className="flex items-center justify-end px-1.5 pt-1" contentEditable={false}>
        {editable ? (
          <button
            ref={button}
            type="button"
            aria-label="Code block language"
            aria-expanded={open}
            aria-haspopup="listbox"
            data-testid="composer-code-language"
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background"
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            {languageLabel(language)}
          </button>
        ) : (
          <span
            data-testid="composer-code-language"
            className="px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {languageLabel(language)}
          </span>
        )}
      </div>
      <pre>
        <NodeViewContent />
      </pre>
      {editable && open && box
        ? createPortal(
            <div
              data-testid="composer-code-language-menu"
              role="listbox"
              aria-label="Code block language"
              className="fixed z-[80] max-h-52 w-40 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              style={{
                top:
                  box.bottom + 4 + 208 > window.innerHeight
                    ? Math.max(8, box.top - 4 - 208)
                    : box.bottom + 4,
                left: box.left
              }}
            >
              {codeLanguages.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={id === language}
                  data-testid={`composer-code-language-${id}`}
                  className={cn(
                    'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm',
                    id === language && 'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    updateAttributes({ language: id === 'plaintext' ? null : id })
                    setOpen(false)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </NodeViewWrapper>
  )
}

const imageChipOpeners = new WeakMap<Editor, (attachmentId: string) => void>()

function ImageChipView({ node, editor }: ReactNodeViewProps): React.JSX.Element {
  const openImage = imageChipOpeners.get(editor) ?? null
  const label = node.attrs.label as string
  const attachmentId = String(node.attrs.attachmentId ?? '')
  if (openImage)
    return (
      <NodeViewWrapper as="span" data-attachment-id={attachmentId}>
        <button
          type="button"
          className="composer-image-chip"
          data-testid="chat-image-chip"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => imageChipOpeners.get(editor)?.(attachmentId)}
        >
          {label}
        </button>
      </NodeViewWrapper>
    )
  return (
    <NodeViewWrapper
      as="span"
      className="composer-image-chip"
      data-testid="composer-image-chip"
      data-attachment-id={attachmentId}
    >
      {label}
    </NodeViewWrapper>
  )
}

const ImageChip = Node.create({
  name: 'imageChip',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      attachmentId: { default: null },
      label: { default: '' }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-image-chip]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-image-chip': HTMLAttributes.attachmentId })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageChipView)
  }
})

function TagMenu({
  ref,
  items,
  command
}: {
  ref?: React.Ref<TagMenuHandle>
  items: TagOption[]
  command: (item: TagOption) => void
}): React.JSX.Element {
  const itemsKey = items.map((item) => item.id).join('\0')
  const [selected, setSelected] = useState(0)
  const [seenItems, setSeenItems] = useState(itemsKey)
  if (seenItems !== itemsKey) {
    setSeenItems(itemsKey)
    setSelected(0)
  }
  const highlighted = items.length ? selected % items.length : 0
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setSelected((current) => (items.length ? (current + 1) % items.length : 0))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((current) => (items.length ? (current - 1 + items.length) % items.length : 0))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[highlighted]
        if (item) command(item)
        return true
      }
      return false
    }
  }))
  return (
    <div
      data-testid="composer-add-menu"
      role="listbox"
      aria-label="Add"
      className="w-52 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Add</p>
      {items.length ? (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            data-testid={`composer-add-option-${item.label}`}
            className={cn(
              'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm',
              index === highlighted && 'bg-accent text-accent-foreground'
            )}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              command(item)
            }}
          >
            {item.label}
          </button>
        ))
      ) : (
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matches</p>
      )}
    </div>
  )
}

const extensionsFor = (menuOpen: { current: boolean }, interactive: boolean): Extensions => {
  const CodeBlock = CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView)
    }
  }).configure({ lowlight, defaultLanguage: null })
  return [
    StarterKit.configure({
      codeBlock: false,
      blockquote: false,
      bold: false,
      heading: false,
      horizontalRule: false,
      italic: false,
      link: false,
      orderedList: false,
      strike: false,
      underline: false
    }),
    CodeBlock,
    ImageChip,
    ...(interactive
      ? [
          AddTagHighlight,
          Placeholder.configure({ placeholder: 'Ask your agent to work on something…' })
        ]
      : []),
    Mention.extend({
      addKeyboardShortcuts() {
        const shortcuts = this.parent?.() ?? {}
        return {
          ...shortcuts,
          Delete: () =>
            this.editor.commands.command(({ tr, state }) => {
              const { selection } = state
              if (!selection.empty) return false
              const mention = selection.$from.nodeAfter
              if (mention?.type.name !== this.name) return false
              tr.delete(selection.from, selection.from + mention.nodeSize)
              return true
            })
        }
      }
    }).configure({
      deleteTriggerWithBackspace: true,
      HTMLAttributes: { class: 'composer-tag', 'data-testid': 'composer-tag' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id ?? ''}`,
      renderHTML: ({ node }) => [
        'span',
        {
          class: 'composer-tag',
          contenteditable: 'false',
          'data-testid': 'composer-tag',
          'data-id': node.attrs.id
        },
        `@${node.attrs.label ?? node.attrs.id ?? ''}`
      ],
      suggestion: {
        char: '@',
        pluginKey: addTagKey,
        placement: 'top-start',
        items: ({ query }) =>
          addTags.filter((tag) => tag.label.toLowerCase().startsWith(query.toLowerCase())),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { id: props.id, label: props.label } },
              { type: 'text', text: ' ' }
            ])
            .run()
        },
        render: () => {
          let component: ReactRenderer<TagMenuHandle>
          let unmount: (() => void) | undefined
          return {
            onStart: (props) => {
              menuOpen.current = true
              component = new ReactRenderer(TagMenu, { props, editor: props.editor })
              unmount = props.mount(component.element)
            },
            onUpdate: (props) => {
              component.updateProps(props)
            },
            onKeyDown: (props) => component.ref?.onKeyDown(props) ?? false,
            onExit: () => {
              menuOpen.current = false
              unmount?.()
              component.destroy()
            }
          }
        }
      }
    })
  ]
}

export function ComposerEditor({
  ref,
  defaultText,
  attachments,
  getAttachments,
  onDocument,
  onAttachFiles,
  onSubmit,
  vim = { enabled: false, initialMode: 'insert' },
  onVimMode
}: {
  ref?: React.Ref<ComposerEditorHandle>
  defaultText: string
  attachments: ChatAttachmentUpload[]
  getAttachments: () => ChatAttachmentUpload[]
  onDocument: (text: string, chips: Chip[]) => void
  onAttachFiles: (files: File[]) => void
  onSubmit: () => void
  vim?: ComposerVimOptions
  /** Current vim mode while vim is on, otherwise null. */
  onVimMode?: (mode: Mode | null) => void
}): React.JSX.Element {
  const vimRef = useRef(vim)
  const vimPlugin = useRef<Plugin | null>(null)
  const onSubmitRef = useRef(onSubmit)
  const onDocumentRef = useRef(onDocument)
  const getAttachmentsRef = useRef(getAttachments)
  const onAttachFilesRef = useRef(onAttachFiles)
  const editorBox = useRef<Editor | null>(null)
  const setup = useMemo(() => {
    const menuOpen = { current: false }
    return { extensions: extensionsFor(menuOpen, true), menuOpen }
  }, [])
  const mirror = (view: EditorView): { text: string; chips: Chip[] } => {
    const attachments = getAttachmentsRef.current()
    const serialized = serializeDocument(view.state.doc, attachments)
    view.dom.setAttribute('data-composer-text', serialized.text)
    view.dom.setAttribute(
      'data-composer-caret',
      String(serializedOffset(view.state.doc, view.state.selection.from, attachments))
    )
    return serialized
  }
  const publish = (view: EditorView): void => {
    const serialized = mirror(view)
    onDocumentRef.current(serialized.text, serialized.chips)
  }
  const editor = useEditor({
    extensions: setup.extensions,
    content: textToContent(defaultText),
    editorProps: {
      attributes: {
        'aria-label': 'Message agent',
        role: 'textbox',
        'aria-multiline': 'true',
        class:
          'composer-editor max-h-48 min-h-20 w-full overflow-y-auto bg-transparent px-2 py-2 text-sm outline-none'
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData)
        if (!files.length) return false
        event.preventDefault()
        onAttachFilesRef.current(files)
        return true
      },
      handleKeyDown: (view, event) => {
        // Outside vim insert mode the vim plugin owns every key, so Enter never sends
        // and the caret, delete and arrow handling below is left to its motions.
        if (vimRef.current.enabled) {
          const handled = handleComposerVimKey(vimPlugin.current, view, event)
          if (handled !== null) return handled
        }
        if (
          (event.key === 'Home' || event.key === 'End') &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          const pos =
            event.key === 'Home'
              ? view.state.selection.$from.start()
              : view.state.selection.$from.end()
          event.preventDefault()
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView()
          )
          return true
        }
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          const direction = event.key === 'ArrowLeft' ? -1 : 1
          const { selection } = view.state
          const $head = view.state.doc.resolve(selection.head)
          const next = Math.max($head.start(), Math.min($head.end(), selection.head + direction))
          event.preventDefault()
          if (next === selection.head && selection.empty) return true
          const anchor = event.shiftKey ? selection.anchor : next
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, anchor, next))
              .scrollIntoView()
          )
          return true
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const { selection } = view.state
          if (selection instanceof NodeSelection && selection.node.type.name === 'imageChip') {
            event.preventDefault()
            deleteChip(view, String(selection.node.attrs.attachmentId))
            return true
          }
          if (selection.empty) {
            const target =
              event.key === 'Backspace' ? selection.$from.nodeBefore : selection.$from.nodeAfter
            if (target?.type.name === 'imageChip') {
              event.preventDefault()
              deleteChip(view, String(target.attrs.attachmentId))
              return true
            }
          }
        }
        if (event.key === 'Enter' && event.shiftKey && !event.isComposing) {
          if (view.state.selection.$from.parent.type.spec.code) return false
          event.preventDefault()
          return editorBox.current?.commands.splitBlock() ?? false
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false
        if (setup.menuOpen.current) return false
        if (view.state.selection.$from.parent.type.spec.code) return false
        event.preventDefault()
        onSubmitRef.current()
        return true
      }
    },
    onCreate: ({ editor: created }) => {
      mirror(created.view)
    },
    onUpdate: ({ editor: updated }) => publish(updated.view),
    onSelectionUpdate: ({ editor: updated }) => {
      mirror(updated.view)
    }
  })
  useEffect(() => {
    onSubmitRef.current = onSubmit
    onDocumentRef.current = onDocument
    getAttachmentsRef.current = getAttachments
    onAttachFilesRef.current = onAttachFiles
    editorBox.current = editor
    vimRef.current = vim
  }, [editor, getAttachments, onAttachFiles, onDocument, onSubmit, vim])
  const vimEnabled = vim.enabled
  useEffect(() => {
    if (!editor || !vimEnabled) return
    const plugin = createComposerVimPlugin(editor)
    editor.registerPlugin(plugin)
    vimPlugin.current = plugin
    setComposerVimMode(editor, vimRef.current.initialMode)
    return () => {
      if (editor.isDestroyed) return
      vimPlugin.current = null
      editor.unregisterPlugin(composerVimKey)
    }
  }, [editor, vimEnabled])
  const vimState = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current && vimEnabled ? { mode: composerVimMode(current) } : { mode: null }
  })
  const onVimModeRef = useRef(onVimMode)
  const vimMode = vimState?.mode ?? null
  useEffect(() => {
    onVimModeRef.current = onVimMode
    onVimModeRef.current?.(vimMode)
  }, [onVimMode, vimMode])
  useEffect(() => {
    if (!editor) return
    let tr = editor.state.tr
    let changed = false
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'imageChip') return
      const index = attachments.findIndex((item) => item.id === node.attrs.attachmentId)
      if (index < 0) return
      const label = chatImageMarker(index + 1)
      if (node.attrs.label === label) return
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, label })
      changed = true
    })
    if (changed) editor.view.dispatch(tr)
  }, [attachments, editor])
  useImperativeHandle(
    ref,
    () => ({
      insertAttachment: (attachmentId) => {
        if (!editor) return
        const index = Math.max(
          0,
          getAttachmentsRef.current().findIndex((item) => item.id === attachmentId)
        )
        const at = editor.isFocused
          ? editor.state.selection.from
          : Math.max(1, editor.state.doc.content.size - 1)
        const $at = editor.state.doc.resolve(at)
        const size = editor.state.doc.content.size
        const before = editor.state.doc.textBetween(Math.max(0, at - 1), at)
        const after = editor.state.doc.textBetween(at, Math.min(size, at + 1))
        const solid = (
          nodeName: string | undefined,
          text: string,
          edge: 'before' | 'after'
        ): boolean =>
          nodeName === 'imageChip' ||
          nodeName === 'mention' ||
          (text !== '' && (edge === 'before' ? !/\s$/.test(text) : !/^\s/.test(text)))
        const lead = solid($at.nodeBefore?.type.name, before, 'before') ? ' ' : ''
        const trail =
          !$at.nodeAfter && after === ''
            ? ' '
            : solid($at.nodeAfter?.type.name, after, 'after')
              ? ' '
              : ''
        const content = [
          ...(lead ? [{ type: 'text', text: lead }] : []),
          {
            type: 'imageChip',
            attrs: { attachmentId, label: chatImageMarker(index + 1) }
          },
          ...(trail ? [{ type: 'text', text: trail }] : [])
        ]
        const chain = editor.chain()
        if (!editor.isFocused) chain.focus()
        chain.insertContentAt(at, content).run()
      },
      removeAttachment: (attachmentId) => {
        if (editor) deleteChip(editor.view, attachmentId)
      },
      clear: () => {
        editor?.commands.clearContent(true)
        if (editor && vimRef.current.enabled) setComposerVimMode(editor, vimRef.current.initialMode)
      },
      focus: () => {
        // A freshly loaded draft has its caret at the start; resume typing after it instead.
        if (editor) editor.commands.focus(editor.state.selection.from <= 1 ? 'end' : null)
      }
    }),
    [editor]
  )
  return <EditorContent editor={editor} />
}

/** The same composer document, without a caret, so a sent message matches what was typed. */
export function ComposerMessage({
  text,
  attachments,
  onImageChip
}: {
  text: string
  attachments: Array<{ id: string }>
  onImageChip?: (attachmentId: string) => void
}): React.JSX.Element {
  const extensions = useMemo(() => extensionsFor({ current: false }, false), [])
  const editor = useEditor({
    editable: false,
    extensions,
    content: textToContent(text, { attachments }),
    editorProps: {
      attributes: {
        class:
          'composer-editor composer-editor-readonly w-full bg-transparent text-sm outline-none',
        role: 'document',
        'aria-label': 'Your message'
      }
    }
  })
  if (editor && onImageChip) imageChipOpeners.set(editor, onImageChip)
  return <EditorContent editor={editor} />
}
