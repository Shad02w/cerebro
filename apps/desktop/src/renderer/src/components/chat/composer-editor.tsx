import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { Plugin, PluginKey, NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'
import {
  chatImageMarker,
  type AgentSkill,
  type ChatAttachmentUpload,
  type ChatSkillRef
} from '@cerebro/core'
import { cn } from '@/lib/utils'
import { imageFiles, type Chip } from './chat-attachments'
import {
  codeLanguages,
  promoteMentionTransaction,
  serializeDocument,
  serializedOffset,
  textToContent,
  visitFileText,
  visitSkillText
} from './composer-document'
import { searchFiles } from './file-search'
import { ComposerFileMenu, type FileMenuHandle, type FileOption } from './composer-file-menu'
import { useMenuHighlight } from './composer-menu-scroll'
import { loadWorkspaceFiles } from './workspace-files'
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
const skillMentionKey = new PluginKey('skillMention')
const fileMentionKey = new PluginKey('fileMention')
const skillHighlightKey = new PluginKey('skillHighlight')

type SkillCatalog = { current: readonly AgentSkill[] }
type FileIndex = { current: ReadonlySet<string> }

const mentionHighlight = (catalog: SkillCatalog, files: FileIndex): Extension =>
  Extension.create({
    name: 'skillHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: skillHighlightKey,
          appendTransaction(transactions, _oldState, state) {
            const refresh = transactions.some(
              (transaction) =>
                transaction.getMeta('skillRefresh') || transaction.getMeta('filesLoaded')
            )
            if (
              !refresh &&
              !transactions.some(
                (transaction) => transaction.docChanged || transaction.selectionSet
              )
            )
              return null
            if (transactions.some((transaction) => transaction.getMeta('skillPromotion')))
              return null
            if (transactions.some((transaction) => transaction.getMeta('composition'))) return null
            const tr = promoteMentionTransaction(state, catalog.current, files.current)
            if (!tr) return null
            tr.setMeta('skillPromotion', true)
            return tr
          },
          props: {
            decorations(state) {
              const decorations: Decoration[] = []
              const mark = (from: number, to: number): void => {
                decorations.push(
                  Decoration.inline(from, to, {
                    class: 'composer-tag',
                    'data-testid': 'composer-tag'
                  })
                )
              }
              visitSkillText(state, catalog.current, (_match, from, to) => mark(from, to))
              visitFileText(state, files.current, (_match, from, to) => mark(from, to))
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
  replace: (text: string) => void
  clear: () => void
  replaceText: (text: string) => void
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

function SkillMenu({
  ref,
  items,
  query,
  command,
  issue
}: {
  ref?: React.Ref<TagMenuHandle>
  items: AgentSkill[]
  query: string
  command: (item: AgentSkill) => void
  issue?: string
}): React.JSX.Element {
  const itemsKey = items.map((item) => item.id).join('\0')
  const { highlighted, move, highlightIndex, listRef, optionRef } = useMenuHighlight(
    itemsKey,
    items.length
  )
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        move(1)
        return true
      }
      if (event.key === 'ArrowUp') {
        move(-1)
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
      ref={listRef}
      data-testid="composer-skill-menu"
      role="listbox"
      aria-label="Skills"
      className="max-h-64 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Skills</p>
      {items.length ? (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            data-testid={`composer-skill-option-${item.name}`}
            ref={optionRef(index)}
            className={cn(
              'flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left',
              index === highlighted && 'bg-accent text-accent-foreground'
            )}
            onMouseEnter={() => highlightIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              command(item)
            }}
          >
            <span className="text-sm">{item.name}</span>
            {item.description ? (
              <span className="w-full truncate text-xs text-muted-foreground">
                {item.description}
              </span>
            ) : null}
          </button>
        ))
      ) : (
        <p className="px-2 py-3 text-center text-sm break-words text-muted-foreground">
          {query ? 'No matches' : issue || 'No skills'}
        </p>
      )}
    </div>
  )
}

const skillOptions = (catalog: SkillCatalog, query: string): AgentSkill[] =>
  catalog.current
    .filter((skill) => skill.name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 50)

const outsideCode = (state: EditorState, range: { from: number }): boolean => {
  const $from = state.doc.resolve(range.from)
  if ($from.parent.type.spec.code) return false
  return !$from.marks().some((mark) => mark.type.name === 'code')
}

const extensionsFor = (
  menuOpen: { current: boolean },
  catalog: SkillCatalog,
  interactive: boolean,
  menuRefresh?: { current: (() => void) | null },
  issue?: { current: string },
  files?: FileIndex,
  workspaceId?: { current: number | null }
): Extensions => {
  const fileIndex = files ?? { current: new Set<string>() }
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
          mentionHighlight(catalog, fileIndex),
          Placeholder.configure({
            placeholder:
              'Ask your agent to work on something…  / mentions a skill, @ mentions a file'
          })
        ]
      : []),
    Mention.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          path: { default: null },
          prompt: { default: null }
        }
      },
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
      renderText: ({ node }) =>
        `${node.attrs.mentionSuggestionChar ?? '/'}${node.attrs.label ?? node.attrs.id ?? ''}`,
      renderHTML: ({ node }) => [
        'span',
        {
          class: 'composer-tag',
          contenteditable: 'false',
          'data-testid': 'composer-tag',
          'data-id': node.attrs.id
        },
        `${node.attrs.mentionSuggestionChar ?? '/'}${node.attrs.label ?? node.attrs.id ?? ''}`
      ],
      suggestions: [
        {
          char: '/',
          pluginKey: skillMentionKey,
          placement: 'top-start',
          allowToIncludeChar: true,
          allow: ({ state, range }) => outsideCode(state, range),
          items: ({ query }) => skillOptions(catalog, query),
          command: ({ editor, range, props }) => {
            const skill = props as AgentSkill
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: {
                    id: skill.name,
                    label: skill.name,
                    mentionSuggestionChar: '/',
                    path: skill.path,
                    prompt: skill.prompt
                  }
                },
                { type: 'text', text: ' ' }
              ])
              .run()
          },
          render: () => {
            let component: ReactRenderer<TagMenuHandle> | undefined
            let unmount: (() => void) | undefined
            let latest: { query: string; command: (item: AgentSkill) => void } | null = null
            const show = (props: { query: string; command: (item: AgentSkill) => void }): void => {
              latest = props
              component?.updateProps({
                ...props,
                items: skillOptions(catalog, props.query),
                issue: issue?.current
              })
            }
            if (menuRefresh) {
              menuRefresh.current = () => {
                if (menuOpen.current && latest) show(latest)
              }
            }
            return {
              onStart: (props) => {
                menuOpen.current = true
                component = new ReactRenderer(SkillMenu, { props, editor: props.editor })
                unmount = props.mount(component.element)
                show(props)
              },
              onUpdate: (props) => {
                show(props)
              },
              onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
              onExit: () => {
                menuOpen.current = false
                latest = null
                unmount?.()
                component?.destroy()
                component = undefined
              }
            }
          }
        },
        ...(interactive
          ? [
              {
                char: '@',
                pluginKey: fileMentionKey,
                placement: 'top-start' as const,
                debounce: 40,
                allow: ({ state, range }) => outsideCode(state, range),
                items: async ({ query, signal }) => {
                  const id = workspaceId?.current
                  if (id == null) return []
                  try {
                    const listed = await loadWorkspaceFiles(id)
                    if (signal.aborted) return []
                    fileIndex.current = new Set(listed)
                    await new Promise<void>((resolve) => {
                      setTimeout(resolve, 0)
                    })
                    if (signal.aborted) return []
                    return searchFiles(listed, query).map((path) => ({ id: path, label: path }))
                  } catch {
                    return []
                  }
                },
                command: ({ editor, range, props }) => {
                  const file = props as FileOption
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(range, [
                      {
                        type: 'mention',
                        attrs: {
                          id: file.label,
                          label: file.label,
                          mentionSuggestionChar: '@'
                        }
                      },
                      { type: 'text', text: ' ' }
                    ])
                    .run()
                },
                render: () => {
                  let component: ReactRenderer<FileMenuHandle> | undefined
                  let unmount: (() => void) | undefined
                  return {
                    onStart: (props) => {
                      menuOpen.current = true
                      component = new ReactRenderer(ComposerFileMenu, {
                        props: {
                          items: props.items,
                          loading: props.loading,
                          command: props.command
                        },
                        editor: props.editor
                      })
                      unmount = props.mount(component.element)
                    },
                    onUpdate: (props) => {
                      component?.updateProps({
                        items: props.items,
                        loading: props.loading,
                        command: props.command
                      })
                    },
                    onKeyDown: (props: { event: KeyboardEvent }) =>
                      component?.ref?.onKeyDown(props) ?? false,
                    onExit: () => {
                      menuOpen.current = false
                      unmount?.()
                      component?.destroy()
                      component = undefined
                    }
                  }
                }
              }
            ]
          : [])
      ]
    })
  ]
}

/**
 * An empty top-level bullet is the "leave the list" step. Drop that item and continue in the
 * paragraph after the list, instead of lifting a second blank line out beside the trailing one.
 */
function leaveEmptyListItem(state: EditorState, tr: EditorState['tr']): boolean {
  const { selection } = state
  if (!selection.empty) return false
  const { $from } = selection
  if (!$from.parent.isTextblock || $from.parent.content.size !== 0) return false
  let itemDepth = -1
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'listItem') {
      itemDepth = depth
      break
    }
  }
  if (itemDepth < 1) return false
  const item = $from.node(itemDepth)
  if (item.childCount !== 1 || item.textContent.length > 0) return false
  const listDepth = itemDepth - 1
  if (listDepth !== 1) return false
  const list = $from.node(listDepth)
  if (list.type.name !== 'bulletList' && list.type.name !== 'orderedList') return false
  if ($from.index(listDepth) !== list.childCount - 1) return false

  const listPos = $from.before(listDepth)
  const listEnd = listPos + list.nodeSize
  const itemPos = $from.before(itemDepth)
  if (list.childCount === 1) {
    const followedByParagraph = state.doc.resolve(listEnd).nodeAfter?.type.name === 'paragraph'
    if (followedByParagraph) tr.delete(listPos, listEnd)
    else tr.replaceWith(listPos, listEnd, state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, listPos + 1))
  } else {
    const afterList = $from.after(listDepth)
    tr.delete(itemPos, itemPos + item.nodeSize)
    const at = tr.mapping.map(afterList)
    const next = tr.doc.resolve(Math.min(at, tr.doc.content.size)).nodeAfter
    if (next?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, at + 1))
    else {
      tr.insert(at, state.schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, at + 1))
    }
  }
  tr.scrollIntoView()
  return true
}

/**
 * Shift+Enter is the markdown Enter key. A bullet grows another bullet, an empty bullet
 * leaves the list, a code block gains a line, and any other block splits into a new line.
 */
function insertComposerLineBreak(editor: Editor): boolean {
  const { selection } = editor.state
  const inEmptyTextblock =
    selection.empty &&
    selection.$from.parent.isTextblock &&
    selection.$from.parent.content.size === 0
  return editor.commands.first(({ commands, state, tr }) => [
    () => commands.splitListItem('listItem'),
    () => leaveEmptyListItem(state, tr),
    () => (inEmptyTextblock ? commands.liftListItem('listItem') : false),
    () => commands.newlineInCode(),
    () => commands.createParagraphNear(),
    () => commands.liftEmptyBlock(),
    () => commands.splitBlock()
  ])
}

export function ComposerEditor({
  ref,
  defaultText,
  attachments,
  skills,
  skillIssue = '',
  workspaceId = null,
  getAttachments,
  onDocument,
  onAttachFiles,
  onSubmit,
  onCancel,
  variant = 'composer',
  vim = { enabled: false, initialMode: 'insert' },
  onVimMode
}: {
  ref?: React.Ref<ComposerEditorHandle>
  defaultText: string
  attachments: ChatAttachmentUpload[]
  skills: readonly AgentSkill[]
  /** Shown in the empty skill menu when the harness could not be asked. */
  skillIssue?: string
  /** Workspace whose working directory `@` searches. */
  workspaceId?: number | null
  getAttachments: () => ChatAttachmentUpload[]
  onDocument: (text: string, chips: Chip[], skills: ChatSkillRef[]) => void
  onAttachFiles: (files: File[]) => void
  onSubmit: () => void
  /** Message variant: Escape leaves edit mode. */
  onCancel?: () => void
  /** `message` edits a sent prompt. Enter inserts a newline instead of sending. */
  variant?: 'composer' | 'message'
  vim?: ComposerVimOptions
  /** Current vim mode while vim is on, otherwise null. */
  onVimMode?: (mode: Mode | null) => void
}): React.JSX.Element {
  const vimRef = useRef(vim)
  const vimPlugin = useRef<Plugin | null>(null)
  const onSubmitRef = useRef(onSubmit)
  const onCancelRef = useRef(onCancel)
  const messageRef = useRef(variant === 'message')
  const onDocumentRef = useRef(onDocument)
  const getAttachmentsRef = useRef(getAttachments)
  const onAttachFilesRef = useRef(onAttachFiles)
  const editorBox = useRef<Editor | null>(null)
  const catalogRef = useRef<SkillCatalog>({ current: skills })
  const issueRef = useRef(skillIssue)
  const menuRefreshRef = useRef<(() => void) | null>(null)
  const filesRef = useRef<FileIndex>({ current: new Set() })
  const workspaceIdRef = useRef<number | null>(workspaceId)
  useLayoutEffect(() => {
    catalogRef.current.current = skills
    issueRef.current = skillIssue
    workspaceIdRef.current = workspaceId
  }, [skillIssue, skills, workspaceId])
  const setup = useMemo(() => {
    const menuOpen = { current: false }
    return {
      menuOpen,
      // Created once. The parent remounts this editor when the harness changes, and the
      // plugins read the latest catalog and file index from these refs on each keystroke.
      extensions: extensionsFor(
        menuOpen,
        // eslint-disable-next-line react-hooks/refs -- shared with the ProseMirror plugin created below
        catalogRef.current,
        true,
        // eslint-disable-next-line react-hooks/refs -- the suggestion renderer stores its refresh here
        menuRefreshRef,
        // eslint-disable-next-line react-hooks/refs -- read when the menu renders, not during this render
        issueRef,
        // eslint-disable-next-line react-hooks/refs -- the file index is filled after the walk resolves
        filesRef.current,
        // eslint-disable-next-line react-hooks/refs -- read when @ is typed, not during this render
        workspaceIdRef
      )
    }
  }, [])
  const mirror = (view: EditorView): { text: string; chips: Chip[]; skills: ChatSkillRef[] } => {
    const attachments = getAttachmentsRef.current()
    const serialized = serializeDocument(view.state.doc, attachments, catalogRef.current.current)
    view.dom.setAttribute('data-composer-text', serialized.text)
    view.dom.setAttribute(
      'data-composer-caret',
      String(serializedOffset(view.state.doc, view.state.selection.from, attachments))
    )
    return serialized
  }
  const publish = (view: EditorView): void => {
    const serialized = mirror(view)
    onDocumentRef.current(serialized.text, serialized.chips, serialized.skills)
  }
  const editor = useEditor({
    extensions: setup.extensions,
    content: textToContent(defaultText, { skills }),
    editorProps: {
      attributes: {
        'aria-label': variant === 'message' ? 'Edit prompt' : 'Message agent',
        role: 'textbox',
        'aria-multiline': 'true',
        class: `composer-editor max-h-48 w-full overflow-y-auto bg-transparent px-2 py-2 text-sm outline-none ${variant === 'message' ? 'min-h-6' : 'min-h-20'}`
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
        if (messageRef.current && event.key === 'Escape' && !event.isComposing) {
          event.preventDefault()
          onCancelRef.current?.()
          return true
        }
        // Enter always sends. Shift+Enter is the newline, including the markdown list
        // Enter (another bullet, then leaving an empty bullet). Chords stay with the
        // editor so Mod+Enter can still leave a code block.
        const chord = event.altKey || event.ctrlKey || event.metaKey
        if (event.key === 'Enter' && event.shiftKey && !chord && !event.isComposing) {
          event.preventDefault()
          return editorBox.current ? insertComposerLineBreak(editorBox.current) : false
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false
        if (!chord && setup.menuOpen.current) return false
        if (messageRef.current) {
          if (chord) return false
          event.preventDefault()
          return editorBox.current ? insertComposerLineBreak(editorBox.current) : false
        }
        if (chord && view.state.selection.$from.parent.type.spec.code) return false
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
    onCancelRef.current = onCancel
    messageRef.current = variant === 'message'
    onDocumentRef.current = onDocument
    getAttachmentsRef.current = getAttachments
    onAttachFilesRef.current = onAttachFiles
    editorBox.current = editor
    vimRef.current = vim
  }, [editor, getAttachments, onAttachFiles, onCancel, onDocument, onSubmit, variant, vim])
  useEffect(() => {
    if (variant === 'message') editor?.commands.focus('end')
  }, [editor, variant])
  const vimEnabled = vim.enabled
  const skillKey = skills.map((skill) => skill.id).join('\0')
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    publish(editor.view)
    // Reserialize once per editor so a harness remount drops skill refs from the previous trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta('skillRefresh', true))
    menuRefreshRef.current?.()
  }, [editor, skillKey])
  useEffect(() => {
    menuRefreshRef.current?.()
  }, [skillIssue])
  useEffect(() => {
    if (!editor || editor.isDestroyed || workspaceId == null) return
    let cancel = false
    void loadWorkspaceFiles(workspaceId).then((listed) => {
      if (cancel || editor.isDestroyed) return
      filesRef.current.current = new Set(listed)
      editor.view.dispatch(editor.state.tr.setMeta('filesLoaded', true))
    })
    return () => {
      cancel = true
    }
  }, [editor, workspaceId])
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
      replace: (text) => {
        if (!editor) return
        editor.commands.setContent(
          textToContent(text, { attachments: getAttachmentsRef.current() }),
          { emitUpdate: true }
        )
        editor.commands.focus('end')
      },
      clear: () => {
        editor?.commands.clearContent(true)
        if (editor && vimRef.current.enabled) setComposerVimMode(editor, vimRef.current.initialMode)
      },
      replaceText: (text: string) => {
        if (!editor) return
        editor.commands.setContent(
          textToContent(text, {
            skills: catalogRef.current.current,
            files: [...filesRef.current.current]
          }),
          { emitUpdate: true }
        )
        editor.commands.focus('end')
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

const noMessageSkills: readonly AgentSkill[] = []
const noMessageFiles: readonly string[] = []

/** The same composer document, without a caret, so a sent message matches what was typed. */
export function ComposerMessage({
  text,
  attachments,
  skills = noMessageSkills,
  files = noMessageFiles,
  onImageChip
}: {
  text: string
  attachments: Array<{ id: string }>
  skills?: readonly AgentSkill[]
  /** Workspace-relative paths so `@path` in a sent message becomes a chip. */
  files?: readonly string[]
  onImageChip?: (attachmentId: string) => void
}): React.JSX.Element {
  const extensions = useMemo(() => extensionsFor({ current: false }, { current: [] }, false), [])
  const editor = useEditor({
    editable: false,
    extensions,
    content: textToContent(text, { attachments, skills, files }),
    editorProps: {
      attributes: {
        class:
          'composer-editor composer-editor-readonly w-full bg-transparent text-sm outline-none',
        role: 'document',
        'aria-label': 'Your message'
      }
    }
  })
  const skillKey = skills.map((skill) => `${skill.id}:${skill.token}`).join('\0')
  const attachmentKey = attachments.map((item) => item.id).join('\0')
  const fileKey = files.join('\0')
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.commands.setContent(textToContent(text, { attachments, skills, files }), {
      emitUpdate: false
    })
  }, [attachmentKey, attachments, editor, fileKey, files, skillKey, skills, text])
  if (editor && onImageChip) imageChipOpeners.set(editor, onImageChip)
  return <EditorContent editor={editor} />
}
