import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, FileText, Undo2 } from 'lucide-react'
import type { AgentSkill, ChatAttachment } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'
import { dataUrl, formatBytes } from './chat-attachments'
import { ComposerEditor, ComposerMessage } from './composer-editor'
import { loadWorkspaceFiles } from './workspace-files'

const noAttachments: ChatAttachment[] = []
const noSkills: readonly AgentSkill[] = []

function AttachmentImage({
  workspaceId,
  sessionId,
  attachment,
  className
}: {
  workspaceId: number
  sessionId: string
  attachment: ChatAttachment
  className: string
}): React.JSX.Element {
  const content = useQuery({
    queryKey: ['chat-attachment', workspaceId, sessionId, attachment.id],
    queryFn: () => window.cerebro.chatAttachment(workspaceId, sessionId, attachment.id),
    staleTime: Infinity
  })
  if (content.error)
    return (
      <span className={`${className} flex items-center justify-center bg-muted text-xs`}>
        Image unavailable
      </span>
    )
  if (!content.data)
    return <span className={`${className} animate-pulse bg-muted`} aria-label="Loading image" />
  return <img src={dataUrl(content.data)} alt={attachment.name} className={className} />
}

export function ChatUserMessage({
  text,
  attachments = noAttachments,
  skills = noSkills,
  workspaceId,
  sessionId,
  onRewind
}: {
  text: string
  attachments?: ChatAttachment[]
  skills?: readonly AgentSkill[]
  workspaceId: number
  sessionId: string
  onRewind?: (text: string) => void
}): React.JSX.Element {
  const files = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => loadWorkspaceFiles(workspaceId),
    staleTime: 15_000
  })
  const copy = useClipboard()
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<ChatAttachment | null>(null)
  const [editing, setEditing] = useState(false)
  const edited = useRef(text)
  const toastId = useRef(0)
  const uploads = attachments.map((attachment) => ({ ...attachment, data: '' }))
  const startEdit = (): void => {
    edited.current = text
    setEditing(true)
  }
  const copyMessage = async (): Promise<void> => {
    setToast(null)
    setError(false)
    if (await copy(text)) {
      setToast({ id: ++toastId.current, message: 'Message copied to clipboard.' })
    } else setError(true)
  }
  return (
    <div
      className="ml-auto flex max-w-[90%] flex-col items-end gap-1"
      data-testid="chat-user-message"
      data-editing={editing || undefined}
    >
      <div
        className="max-w-full rounded-2xl bg-muted px-4 py-3 text-sm break-words"
        data-testid="chat-user-bubble"
        role={editing ? undefined : 'button'}
        tabIndex={editing ? undefined : 0}
        aria-label={editing ? undefined : 'Edit prompt'}
        onClick={(event) => {
          if (editing) return
          const target = event.target
          if (!(target instanceof HTMLElement) || target.closest('button')) return
          startEdit()
        }}
        onKeyDown={(event) => {
          if (editing || event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          startEdit()
        }}
      >
        {attachments.length ? (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
            {attachments.map((attachment, index) => (
              <li key={attachment.id}>
                {attachment.kind === 'file' ? (
                  <span
                    className="flex h-20 w-40 items-center gap-2 rounded-lg border bg-background px-2 text-xs"
                    data-testid="chat-file-attachment"
                    title={attachment.name}
                  >
                    <FileText
                      className="size-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{attachment.name}</span>
                      <span className="text-muted-foreground">{formatBytes(attachment.bytes)}</span>
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="relative block overflow-hidden rounded-lg border bg-background"
                    aria-label={`Open image ${index + 1}: ${attachment.name}`}
                    onClick={() => setPreview(attachment)}
                  >
                    <AttachmentImage
                      workspaceId={workspaceId}
                      sessionId={sessionId}
                      attachment={attachment}
                      className="block size-20 object-cover"
                    />
                    <span className="absolute top-0.5 left-0.5 rounded bg-background/90 px-1 font-mono text-[10px] leading-4">
                      #{index + 1}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {editing ? (
          <ComposerEditor
            variant="message"
            defaultText={text}
            attachments={uploads}
            skills={skills}
            workspaceId={workspaceId}
            getAttachments={() => uploads}
            onDocument={(next) => {
              edited.current = next
            }}
            onAttachFiles={() => {}}
            onSubmit={() => {}}
            onCancel={() => setEditing(false)}
          />
        ) : text ? (
          <ComposerMessage
            text={text}
            attachments={attachments}
            files={files.data}
            skills={skills}
            onImageChip={(attachmentId) => {
              const attachment = attachments.find((item) => item.id === attachmentId)
              if (attachment?.kind === 'image') setPreview(attachment)
            }}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Rewind to before this prompt"
          title="Rewind to before this prompt"
          className="text-muted-foreground"
          data-testid="chat-rewind"
          onClick={(event) => {
            event.stopPropagation()
            onRewind?.(editing ? edited.current : text)
          }}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Copy message"
          title="Copy message"
          className="text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            void copyMessage()
          }}
        >
          <Copy aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          Could not copy message.
        </p>
      ) : null}
      <SuccessToast toast={toast} onDismiss={() => setToast(null)} testId="chat-copy-toast" />
      {preview ? (
        <ImagePreviewDialog title={preview.name} onClose={() => setPreview(null)}>
          <AttachmentImage
            workspaceId={workspaceId}
            sessionId={sessionId}
            attachment={preview}
            className="min-h-24 min-w-24"
          />
        </ImagePreviewDialog>
      ) : null}
    </div>
  )
}
