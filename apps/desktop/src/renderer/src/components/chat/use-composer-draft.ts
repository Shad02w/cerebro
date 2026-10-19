import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import {
  checkAttachments,
  type AttachmentPolicy,
  type ChatAttachmentUpload,
  type ChatSkillRef
} from '@cerebro/core'
import {
  emptyDraft,
  imageFiles,
  prepareAttachment,
  stripChips,
  type Chip,
  type ComposerDraft
} from './chat-attachments'
import type { ComposerEditorHandle } from './composer-editor'

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
  ) &&
  left.skills.length === right.skills.length &&
  left.skills.every(
    (skill, index) =>
      skill.name === right.skills[index]?.name && skill.path === right.skills[index]?.path
  )

/**
 * Composer state for the Tiptap field. The editor document is the source of the text and of which
 * image chips still exist. Attachments are added here, then inserted as atomic nodes.
 */
export function useComposerDraft({
  storageKey,
  editorRef,
  canAttachImage,
  policy,
  agent,
  onError
}: {
  storageKey: string
  editorRef: RefObject<ComposerEditorHandle | null>
  /** Why images cannot be attached to the selected model, or null. Other files are unaffected. */
  canAttachImage: () => string | null
  /** What the selected agent accepts, and how to name it in errors. */
  policy: AttachmentPolicy
  agent: string
  onError: (message: string | null) => void
}): {
  draft: ComposerDraft
  initialText: string
  dragging: boolean
  attachFiles: (files: File[]) => Promise<void>
  remove: (attachmentId: string) => void
  clear: () => void
  replace: (text: string, attachments?: ChatAttachmentUpload[]) => void
  onDocument: (text: string, chips: Chip[], skills: ChatSkillRef[]) => void
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
    if (current.current.attachments.length + files.length > policy.maxCount) {
      onError(`${agent} accepts at most ${policy.maxCount} attachments per message.`)
      return
    }
    const prepared: ChatAttachmentUpload[] = []
    let failure: string | null = null
    for (const file of files) {
      try {
        const blocked = file.type.startsWith('image/') ? canAttachImage() : null
        if (blocked) throw new Error(blocked)
        const next = await prepareAttachment(file, policy, agent)
        const together = checkAttachments(policy, agent, [
          ...current.current.attachments,
          ...prepared,
          next
        ])
        if (together) throw new Error(together)
        prepared.push(next)
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
    replace: (text: string, attachments: ChatAttachmentUpload[] = []) => {
      commit({ text, attachments, chips: [], skills: [] })
      const apply = (): void => editorRef.current?.replace(text)
      if (editorRef.current) apply()
      else requestAnimationFrame(apply)
    },
    onDocument: (text, chips, skills) => {
      const ids = new Set(chips.map((chip) => chip.attachmentId))
      const next = {
        text,
        chips,
        skills,
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
