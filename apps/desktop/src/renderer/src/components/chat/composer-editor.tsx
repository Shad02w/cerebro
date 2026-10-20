import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
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
import {
  Extension,
  InputRule,
  Node,
  mergeAttributes,
  type Editor,
  type Extensions
} from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import { Plugin, PluginKey, NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'
import {
  chatImageMarker,
  type AgentCommand,
  type AgentSkill,
  type ChatAttachmentKind,
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
import {
  createMentionFileListing,
  loadWorkspaceFiles,
  type WorkspaceFileIndex
} from './workspace-files'
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

type SkillCatalog = { current: readonly AgentSkill[]; commands?: readonly AgentCommand[] }
type MenuOption = AgentSkill | AgentCommand
const isCommand = (option: MenuOption): option is AgentCommand => 'source' in option

const mentionHighlight = (catalog: SkillCatalog, files: WorkspaceFileIndex): Extension =>
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

type ComposerKeyState = {
  lineBreak: { current: boolean }
  vim: { current: ComposerVimOptions }
  vimPlugin: { current: Plugin | null }
  message: { current: boolean }
  menuOpen: { current: boolean }
  editor: { current: Editor | null }
  onCancel: { current: (() => void) | undefined }
  onSubmit: { current: () => void }
}

/** Enter sends, Shift+Enter inserts a markdown line, and vim owns keys outside insert mode. */
function handleComposerKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  keys: ComposerKeyState
): boolean {
  if (keys.lineBreak.current) return false
  // Outside vim insert mode the vim plugin owns every key, so Enter never sends
  // and the caret, delete and arrow handling below is left to its motions.
  if (keys.vim.current.enabled) {
    const handled = handleComposerVimKey(keys.vimPlugin.current, view, event)
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
      event.key === 'Home' ? view.state.selection.$from.start() : view.state.selection.$from.end()
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
  if (keys.message.current && event.key === 'Escape' && !event.isComposing) {
    event.preventDefault()
    keys.onCancel.current?.()
    return true
  }
  // Enter sends. Shift+Enter replays the editor's Enter, which is the markdown
  // newline: another bullet, then leaving an empty bullet, or a new line.
  const chord = event.altKey || event.ctrlKey || event.metaKey
  if (event.key === 'Enter' && event.shiftKey && !chord && !event.isComposing) {
    if (keys.menuOpen.current || !keys.editor.current) return false
    event.preventDefault()
    keys.lineBreak.current = true
    try {
      return keys.editor.current.commands.enter()
    } finally {
      keys.lineBreak.current = false
    }
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false
  if (keys.message.current) return false
  if (keys.menuOpen.current) return false
  if (chord && view.state.selection.$from.parent.type.spec.code) return false
  event.preventDefault()
  keys.onSubmit.current()
  return true
}

function composerEditorHandle(
  editor: Editor | null,
  getAttachments: { current: () => ChatAttachmentUpload[] },
  vim: { current: ComposerVimOptions },
  catalog: SkillCatalog,
  files: WorkspaceFileIndex
): ComposerEditorHandle {
  return {
    insertAttachment: (attachmentId) => {
      if (!editor) return
      const index = Math.max(
        0,
        getAttachments.current().findIndex((item) => item.id === attachmentId)
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
          attrs: {
            attachmentId,
            label: chatImageMarker(index + 1, getAttachments.current()[index]?.kind)
          }
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
      editor.commands.setContent(textToContent(text, { attachments: getAttachments.current() }), {
        emitUpdate: true
      })
      editor.commands.focus('end')
    },
    clear: () => {
      editor?.commands.clearContent(true)
      if (editor && vim.current.enabled) setComposerVimMode(editor, vim.current.initialMode)
    },
    replaceText: (text: string) => {
      if (!editor) return
      editor.commands.setContent(
        textToContent(text, {
          skills: catalog.current,
          files: [...files.current]
        }),
        { emitUpdate: true }
      )
      editor.commands.focus('end')
    },
    focus: () => {
      // A freshly loaded draft has its caret at the start; resume typing after it instead.
      if (editor) editor.commands.focus(editor.state.selection.from <= 1 ? 'end' : null)
    }
  }
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

const fencePattern = /^```([a-z]+)?[\s\n]$/

/**
 * A list item must start with a paragraph, so the stock fence rule cannot turn
 * that paragraph into a code block. A fence that is the whole item becomes a
 * code block after the list instead.
 */
function listItemFenceRule(type: NodeType): InputRule {
  return new InputRule({
    find: fencePattern,
    handler: ({ state, match }) => {
      const $from = state.doc.resolve(state.selection.from)
      const listItem = $from.node(-1)
      const list = $from.node(-2)
      if (listItem?.type.name !== 'listItem') return null
      if (list?.type.name !== 'bulletList' && list?.type.name !== 'orderedList') return null
      if (listItem.childCount !== 1 || listItem.firstChild?.type.name !== 'paragraph') return null
      const language = match[1] ?? ''
      if (listItem.textContent.replace(/\s+$/, '') !== `\`\`\`${language}`) return null

      const code = type.create({ language: language || null })
      const listFrom = $from.before(-2)
      const listTo = $from.after(-2)
      if (list.childCount === 1) {
        state.tr.replaceWith(listFrom, listTo, code)
        state.tr.setSelection(TextSelection.create(state.tr.doc, listFrom + 1))
        return
      }
      const itemFrom = $from.before(-1)
      const itemTo = $from.after(-1)
      state.tr.delete(itemFrom, itemTo)
      const mappedList = state.tr.mapping.map(listFrom)
      const remaining = state.tr.doc.nodeAt(mappedList)
      if (!remaining) return
      const insertAt = mappedList + remaining.nodeSize
      state.tr.insert(insertAt, code)
      state.tr.setSelection(TextSelection.create(state.tr.doc, insertAt + 1))
    }
  })
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
  items: MenuOption[]
  query: string
  command: (item: MenuOption) => void
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
      aria-label="Commands and skills"
      className="max-h-64 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length ? (
        items.map((item, index) => (
          <Fragment key={item.id}>
            {index === 0 || isCommand(items[index - 1]) !== isCommand(item) ? (
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {isCommand(item) ? 'Commands' : 'Skills'}
              </p>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={index === highlighted}
              data-testid={
                isCommand(item)
                  ? `composer-command-option-${item.name}`
                  : `composer-skill-option-${item.name}`
              }
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
              <span className="text-sm">
                {item.name}
                {isCommand(item) && item.argumentHint ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{item.argumentHint}</span>
                ) : null}
              </span>
              {item.description ? (
                <span className="w-full truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </button>
          </Fragment>
        ))
      ) : (
        <p className="px-2 py-3 text-center text-sm break-words text-muted-foreground">
          {query ? 'No matches' : issue || 'No commands or skills'}
        </p>
      )}
    </div>
  )
}

/** A command only runs as the whole message, so it is offered only when `/` opens the document. */
const atMessageStart = (state: EditorState, query: string): boolean => {
  const { $from } = state.selection
  return $from.index(0) === 0 && $from.parentOffset === query.length + 1
}

const skillOptions = (
  catalog: SkillCatalog,
  query: string,
  commandsAllowed: boolean
): MenuOption[] => {
  const needle = query.toLowerCase()
  const skills = catalog.current.filter((skill) => skill.name.toLowerCase().startsWith(needle))
  const named = new Set(catalog.current.map((skill) => skill.name))
  const commands = commandsAllowed
    ? (catalog.commands ?? []).filter(
        (entry) => !named.has(entry.name) && entry.name.toLowerCase().startsWith(needle)
      )
    : []
  return [...commands, ...skills].slice(0, 50)
}

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
  files?: WorkspaceFileIndex,
  workspaceId?: { current: number | null }
): Extensions => {
  const fileIndex = files ?? { current: new Set<string>(), generation: 0 }
  const listing = createMentionFileListing(workspaceId ?? { current: null }, fileIndex)
  const CodeBlock = CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView)
    },
    addInputRules() {
      return [listItemFenceRule(this.type), ...(this.parent?.() ?? [])]
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
              'Ask your agent to work on something…  / runs a command or mentions a skill, @ mentions a file'
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
          items: ({ query, editor }) =>
            skillOptions(catalog, query, atMessageStart(editor.state, query)),
          command: ({ editor, range, props }) => {
            const skill = props as MenuOption
            if (isCommand(skill)) {
              editor
                .chain()
                .focus()
                .insertContentAt(range, { type: 'text', text: `/${skill.name} ` })
                .run()
              return
            }
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
            type MenuProps = {
              query: string
              editor: Editor
              command: (item: MenuOption) => void
            }
            let latest: MenuProps | null = null
            const show = (props: MenuProps): void => {
              latest = props
              component?.updateProps({
                ...props,
                items: skillOptions(
                  catalog,
                  props.query,
                  atMessageStart(props.editor.state, props.query)
                ),
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
                  if (workspaceId?.current == null) return []
                  try {
                    const listed = await listing.files()
                    if (signal.aborted) return []
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
                      listing.begin()
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

export function ComposerEditor({
  ref,
  defaultText,
  attachments,
  skills,
  commands = noCommands,
  skillIssue = '',
  workspaceId = null,
  getAttachments,
  onDocument,
  onAttachFiles,
  onSubmit,
  onCancel,
  variant = 'composer',
  vim = { enabled: false, initialMode: 'insert' },
  toolbar
}: {
  ref?: React.Ref<ComposerEditorHandle>
  defaultText: string
  attachments: ChatAttachmentUpload[]
  skills: readonly AgentSkill[]
  /** Slash commands of the harness. Offered in the `/` menu only at the start of the message. */
  commands?: readonly AgentCommand[]
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
  /** Toolbar under the field. It receives the live vim mode, or null when vim is off. */
  toolbar?: (mode: Mode | null) => React.ReactNode
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
  // Shift+Enter runs the editor's own Enter handling. This flag lets that replayed Enter
  // through, so it inserts the markdown newline instead of sending.
  const lineBreak = useRef(false)
  const catalogRef = useRef<SkillCatalog>({ current: skills })
  const issueRef = useRef(skillIssue)
  const menuRefreshRef = useRef<(() => void) | null>(null)
  const filesRef = useRef<WorkspaceFileIndex>({ current: new Set(), generation: 0 })
  const workspaceIdRef = useRef<number | null>(workspaceId)
  useLayoutEffect(() => {
    catalogRef.current.current = skills
    catalogRef.current.commands = commands
    issueRef.current = skillIssue
    workspaceIdRef.current = workspaceId
  }, [commands, skillIssue, skills, workspaceId])
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
      handleKeyDown: (view, event) =>
        handleComposerKeyDown(view, event, {
          lineBreak,
          vim: vimRef,
          vimPlugin,
          message: messageRef,
          menuOpen: setup.menuOpen,
          editor: editorBox,
          onCancel: onCancelRef,
          onSubmit: onSubmitRef
        })
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
  }, [commands, skillIssue])
  useEffect(() => {
    if (!editor || editor.isDestroyed || workspaceId == null) return
    let cancel = false
    const generation = ++filesRef.current.generation
    void loadWorkspaceFiles(workspaceId).then((listed) => {
      if (cancel || editor.isDestroyed || generation !== filesRef.current.generation) return
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
  const vimMode = vimState?.mode ?? null
  useEffect(() => {
    if (!editor) return
    let tr = editor.state.tr
    let changed = false
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'imageChip') return
      const index = attachments.findIndex((item) => item.id === node.attrs.attachmentId)
      if (index < 0) return
      const label = chatImageMarker(index + 1, attachments[index].kind)
      if (node.attrs.label === label) return
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, label })
      changed = true
    })
    if (changed) editor.view.dispatch(tr)
  }, [attachments, editor])
  useImperativeHandle(
    ref,
    () =>
      composerEditorHandle(editor, getAttachmentsRef, vimRef, catalogRef.current, filesRef.current),
    [editor]
  )
  return (
    <>
      <EditorContent editor={editor} />
      {toolbar?.(vimMode)}
    </>
  )
}

const noMessageSkills: readonly AgentSkill[] = []
const noCommands: readonly AgentCommand[] = []
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
  attachments: Array<{ id: string; kind?: ChatAttachmentKind }>
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
