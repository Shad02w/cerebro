import { X } from 'lucide-react'
import type { ChatAttachmentUpload } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { dataUrl, formatBytes } from './chat-attachments'

export function AttachmentStrip({
  attachments,
  onRemove
}: {
  attachments: ChatAttachmentUpload[]
  onRemove: (attachmentId: string) => void
}): React.JSX.Element | null {
  if (!attachments.length) return null
  return (
    <ul
      className="flex flex-wrap gap-2 px-2 pt-1 pb-2"
      aria-label="Attached images"
      data-testid="chat-attachments"
    >
      {attachments.map((attachment, index) => (
        <li
          key={attachment.id}
          className="relative flex items-center gap-2 rounded-lg border bg-muted/40 p-1 pr-2 text-xs"
          data-testid="chat-attachment"
        >
          <img
            src={dataUrl(attachment)}
            alt={attachment.name}
            className="size-12 rounded-md object-cover"
          />
          <span className="absolute top-0.5 left-0.5 rounded bg-background/90 px-1 font-mono text-[10px] leading-4">
            #{index + 1}
          </span>
          <span className="flex max-w-40 flex-col">
            <span className="truncate" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="text-muted-foreground">{formatBytes(attachment.bytes)}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove image ${index + 1}`}
            title={`Remove image ${index + 1}`}
            onClick={() => onRemove(attachment.id)}
          >
            <X aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

export function DropOverlay({ visible }: { visible: boolean }): React.JSX.Element | null {
  if (!visible) return null
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-ring bg-background/90 text-sm"
      data-testid="chat-drop-overlay"
    >
      Drop images to attach
    </div>
  )
}
