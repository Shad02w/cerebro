import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent
} from 'react'
import { chatAttachmentLimits, type ChatAttachmentUpload } from '@cerebro/core'
import {
  emptyDraft,
  imageFiles,
  insertAttachment,
  prepareImage,
  reconcile,
  removeAttachment,
  snapCaret,
  stripChips,
  type ComposerDraft
} from './chat-attachments'

export const chatImageAccept = 'image/png,image/jpeg,image/gif,image/webp'

/**
 * Composer state with atomic `[Image #N]` chips. Text is the source of truth for what is sent;
 * chips track which spans are markers. Any edit touching a chip removes it and its attachment.
 */
export function useComposerDraft({
  storageKey,
  textarea,
  canAttach,
  onError
}: {
  storageKey: string
  textarea: RefObject<HTMLTextAreaElement | null>
  canAttach: () => string | null
  onError: (message: string | null) => void
}): {
  draft: ComposerDraft
  dragging: boolean
  attachFiles: (files: File[]) => Promise<void>
  remove: (attachmentId: string) => void
  clear: () => void
  textareaHandlers: {
    onChange: (event: FormEvent<HTMLTextAreaElement>) => void
    onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void
    onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    onKeyUp: (event: SyntheticEvent<HTMLTextAreaElement>) => void
    onMouseUp: (event: SyntheticEvent<HTMLTextAreaElement>) => void
    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  }
  dropHandlers: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
} {
  const [draft, setDraft] = useState<ComposerDraft>(() => {
    try {
      return emptyDraft(localStorage.getItem(storageKey) ?? '')
    } catch {
      return emptyDraft()
    }
  })
  const current = useRef(draft)
  const selection = useRef<[number, number]>([0, 0])
  const composing = useRef<{ draft: ComposerDraft; selection: [number, number] } | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  useLayoutEffect(() => {
    current.current = draft
  }, [draft])
  // React's synthetic onBeforeInput skips deletions; the native event covers every edit kind.
  useEffect(() => {
    const node = textarea.current
    if (!node) return undefined
    const capture = (): void => {
      selection.current = [node.selectionStart, node.selectionEnd]
    }
    node.addEventListener('beforeinput', capture)
    return () => node.removeEventListener('beforeinput', capture)
  }, [textarea])
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, stripChips(draft))
    } catch {
      /* per-pane convenience only */
    }
  }, [draft, storageKey])
  useLayoutEffect(() => {
    const node = textarea.current
    if (pendingCaret.current === null || !node) return
    const caret = Math.min(pendingCaret.current, node.value.length)
    pendingCaret.current = null
    node.focus()
    node.setSelectionRange(caret, caret)
  }, [draft, textarea])
  const attachFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return
    const rejection = canAttach()
    if (rejection) {
      onError(rejection)
      return
    }
    if (current.current.attachments.length + files.length > chatAttachmentLimits.maxCount) {
      onError(`Attach at most ${chatAttachmentLimits.maxCount} images per message.`)
      return
    }
    const prepared: ChatAttachmentUpload[] = []
    let failure: string | null = null
    for (const file of files) {
      try {
        prepared.push(await prepareImage(file))
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
        break
      }
    }
    onError(failure)
    if (!prepared.length) return
    const node = textarea.current
    let next = current.current
    let caret = node && document.activeElement === node ? node.selectionEnd : next.text.length
    for (const attachment of prepared) {
      const result = insertAttachment(next, attachment, caret)
      next = result.draft
      caret = result.caret
    }
    pendingCaret.current = caret
    setDraft(next)
  }
  const snap = (node: HTMLTextAreaElement): void => {
    const chips = current.current.chips
    if (!chips.length) return
    const start = node.selectionStart
    const end = node.selectionEnd
    const nextStart = start === end ? snapCaret(chips, start) : snapCaret(chips, start, 'left')
    const nextEnd = start === end ? nextStart : snapCaret(chips, end, 'right')
    if (nextStart !== start || nextEnd !== end)
      node.setSelectionRange(nextStart, nextEnd, node.selectionDirection ?? 'none')
  }
  const onSnap = (event: SyntheticEvent<HTMLTextAreaElement>): void => snap(event.currentTarget)
  return {
    draft,
    dragging,
    attachFiles,
    remove: (attachmentId: string) => {
      setDraft((previous) => removeAttachment(previous, attachmentId))
    },
    clear: () => setDraft(emptyDraft()),
    textareaHandlers: {
      onChange: (event: FormEvent<HTMLTextAreaElement>) => {
        const value = event.currentTarget.value
        if (composing.current) {
          setDraft((previous) => ({ ...previous, text: value }))
          return
        }
        const { caret, ...next } = reconcile(current.current, value, selection.current)
        if (caret !== undefined) pendingCaret.current = caret
        setDraft(next)
      },
      onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => {
        const node = event.currentTarget
        composing.current = {
          draft: current.current,
          selection: [node.selectionStart, node.selectionEnd]
        }
      },
      onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
        const started = composing.current
        composing.current = null
        if (!started) return
        const { caret, ...next } = reconcile(
          started.draft,
          event.currentTarget.value,
          started.selection
        )
        if (caret !== undefined) pendingCaret.current = caret
        setDraft(next)
      },
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const chips = current.current.chips
        if (!chips.length || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
          return
        const node = event.currentTarget
        if (node.selectionStart !== node.selectionEnd) return
        if (event.key === 'ArrowLeft' && node.selectionStart > 0) {
          const target = snapCaret(chips, node.selectionStart - 1, 'left')
          if (target !== node.selectionStart - 1) {
            event.preventDefault()
            node.setSelectionRange(target, target)
          }
        } else if (event.key === 'ArrowRight' && node.selectionEnd < node.value.length) {
          const target = snapCaret(chips, node.selectionEnd + 1, 'right')
          if (target !== node.selectionEnd + 1) {
            event.preventDefault()
            node.setSelectionRange(target, target)
          }
        }
      },
      onKeyUp: onSnap,
      onMouseUp: onSnap,
      onSelect: onSnap,
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = imageFiles(event.clipboardData)
        if (!files.length) return
        event.preventDefault()
        void attachFiles(files)
      }
    },
    dropHandlers: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault()
        setDragging(false)
        void attachFiles(imageFiles(event.dataTransfer))
      }
    }
  }
}
