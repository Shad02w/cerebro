import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { chatAttachmentLimits, type ChatAttachmentUpload } from '@cerebro/core'
import {
  emptyDraft,
  imageFiles,
  prepareImage,
  stripChips,
  type Chip,
  type ComposerDraft
} from './chat-attachments'
import type { ComposerEditorHandle } from './composer-editor'

export const chatImageAccept = 'image/png,image/jpeg,image/gif,image/webp'

const sameDraft = (left: ComposerDraft, right: ComposerDraft): boolean =>
  left.text === right.text &&
  left.attachments.length === right.attachments.length &&
  left.attachments.every((item, index) => item.id === right.attachments[index]?.id) &&
  left.chips.length === right.chips.length &&
  left.chips.every(
    (chip, index) =>
      chip.attachmentId === right.chips[index]?.attachmentId &&
      chip.start === right.chips[index]?.start &&
      chip.end === right.chips[index]?.end
  )

/**
 * Composer state for the Tiptap field. The editor document is the source of the text and of which
 * image chips still exist. Attachments are added here, then inserted as atomic nodes.
 */
export function useComposerDraft({
  storageKey,
  editorRef,
  canAttach,
  onError
}: {
  storageKey: string
  editorRef: RefObject<ComposerEditorHandle | null>
  canAttach: () => string | null
  onError: (message: string | null) => void
}): {
  draft: ComposerDraft
  initialText: string
  dragging: boolean
  attachFiles: (files: File[]) => Promise<void>
  remove: (attachmentId: string) => void
  clear: () => void
  onDocument: (text: string, chips: Chip[]) => void
  readDraft: () => ComposerDraft
  dropHandlers: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
} {
  const [initialText] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? ''
    } catch {
      return ''
    }
  })
  const [draft, setDraft] = useState<ComposerDraft>(() => emptyDraft(initialText))
  const current = useRef(draft)
  const [dragging, setDragging] = useState(false)
  const commit = (next: ComposerDraft): void => {
    current.current = next
    setDraft(next)
  }
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, stripChips(current.current))
    } catch {
      /* per-pane convenience only */
    }
  }, [draft, storageKey])
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
    for (const attachment of prepared) {
      current.current = {
        ...current.current,
        attachments: [...current.current.attachments, attachment]
      }
      setDraft(current.current)
      editorRef.current?.insertAttachment(attachment.id)
    }
  }
  return {
    draft,
    initialText,
    dragging,
    attachFiles,
    remove: (attachmentId) => {
      editorRef.current?.removeAttachment(attachmentId)
    },
    clear: () => {
      editorRef.current?.clear()
      commit(emptyDraft())
    },
    onDocument: (text, chips) => {
      const ids = new Set(chips.map((chip) => chip.attachmentId))
      const next = {
        text,
        chips,
        attachments: current.current.attachments.filter((item) => ids.has(item.id))
      }
      if (!sameDraft(current.current, next)) commit(next)
    },
    readDraft: () => current.current,
    dropHandlers: {
      onDragOver: (event) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      },
      onDrop: (event) => {
        event.preventDefault()
        setDragging(false)
        void attachFiles(imageFiles(event.dataTransfer))
      }
    }
  }
}
