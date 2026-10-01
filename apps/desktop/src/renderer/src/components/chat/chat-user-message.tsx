import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { chatImageMarkerPattern, type ChatAttachment } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'
import { dataUrl } from './chat-attachments'

type Part =
  | { kind: 'text'; key: string; value: string }
  | { kind: 'chip'; key: string; index: number; attachment: ChatAttachment }
const noAttachments: ChatAttachment[] = []

/** Splits message text so tracked `[Image #N]` markers render as chips. Unmatched markers stay text. */
function splitMarkers(text: string, attachments: ChatAttachment[]): Part[] {
  const parts: Part[] = []
  let cursor = 0
  for (const match of text.matchAll(chatImageMarkerPattern)) {
    const index = Number(match[1])
    const attachment = attachments[index - 1]
    if (!attachment || match.index === undefined) continue
    if (match.index > cursor)
      parts.push({ kind: 'text', key: `t${cursor}`, value: text.slice(cursor, match.index) })
    parts.push({ kind: 'chip', key: `c${match.index}`, index, attachment })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length)
    parts.push({ kind: 'text', key: `t${cursor}`, value: text.slice(cursor) })
  return parts
}

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
  workspaceId,
  sessionId
}: {
  text: string
  attachments?: ChatAttachment[]
  workspaceId: number
  sessionId: string
}): React.JSX.Element {
  const copy = useClipboard()
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<ChatAttachment | null>(null)
  const toastId = useRef(0)
  const parts = useMemo(() => splitMarkers(text, attachments), [text, attachments])
  useEffect(() => {
    if (!preview) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [preview])
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
      <div className="max-w-full rounded-2xl bg-muted px-4 py-3 text-sm whitespace-pre-wrap break-words">
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
        {parts.map((part) =>
          part.kind === 'text' ? (
            <span key={part.key}>{part.value}</span>
          ) : (
            <button
              key={part.key}
              type="button"
              className="mx-0.5 inline-flex items-center rounded-md border bg-background px-1.5 align-baseline font-mono text-xs leading-5"
              data-testid="chat-image-chip"
              aria-label={`Image ${part.index}: ${part.attachment.name}`}
              onClick={() => setPreview(part.attachment)}
            >
              [Image #{part.index}]
            </button>
          )
        )}
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
      {preview
        ? createPortal(
            <dialog
              open
              aria-label={preview.name}
              data-testid="chat-image-preview"
              className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none cursor-zoom-out items-center justify-center border-0 bg-background/80 p-8 text-foreground"
              onClick={() => setPreview(null)}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Close preview"
                className="absolute top-4 right-4"
                onClick={() => setPreview(null)}
              >
                Close
              </Button>
              <AttachmentImage
                workspaceId={workspaceId}
                sessionId={sessionId}
                attachment={preview}
                className="max-h-full min-h-24 max-w-full min-w-24 rounded-lg object-contain shadow-lg"
              />
            </dialog>,
            document.body
          )
        : null}
    </div>
  )
}
