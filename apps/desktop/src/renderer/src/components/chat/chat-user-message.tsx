import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import type { AgentSkill, ChatAttachment } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'
import { dataUrl } from './chat-attachments'
import { ComposerMessage } from './composer-editor'

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
  sessionId
}: {
  text: string
  attachments?: ChatAttachment[]
  skills?: readonly AgentSkill[]
  workspaceId: number
  sessionId: string
}): React.JSX.Element {
  const copy = useClipboard()
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<ChatAttachment | null>(null)
  const toastId = useRef(0)
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
    >
      <div className="max-w-full rounded-2xl bg-muted px-4 py-3 text-sm break-words">
        {attachments.length ? (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached images">
            {attachments.map((attachment, index) => (
              <li key={attachment.id}>
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
              </li>
            ))}
          </ul>
        ) : null}
        {text ? (
          <ComposerMessage
            text={text}
            attachments={attachments}
            skills={skills}
            onImageChip={(attachmentId) => {
              const attachment = attachments.find((item) => item.id === attachmentId)
              if (attachment) setPreview(attachment)
            }}
          />
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copy message"
        title="Copy message"
        className="text-muted-foreground"
        onClick={() => void copyMessage()}
      >
        <Copy aria-hidden="true" />
      </Button>
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
