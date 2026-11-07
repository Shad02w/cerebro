import { useState } from 'react'
import { Check, Pencil, X, Zap } from 'lucide-react'
import type { AgentSession, QueuedMessage } from '@cerebro/core'
import { Button } from '@/components/ui/button'

export function ChatQueue({
  session,
  onSteer,
  onDequeue,
  onEdit
}: {
  session: AgentSession
  onSteer: (commandId: string) => void
  onDequeue: (commandId: string) => void
  /** Resolves true once the new text is saved; false keeps the editor open. */
  onEdit: (commandId: string, text: string) => Promise<boolean>
}): React.JSX.Element | null {
  const [editing, setEditing] = useState<string | null>(null)
  if (!session.queue?.length) return null
  return (
    <ul
      className="flex flex-col gap-1.5 px-2 pb-2"
      aria-label="Queued messages"
      data-testid="chat-queue"
    >
      {session.queue.map((item) => {
        const steerable =
          item.model.key === session.model.key &&
          (item.accessMode ?? 'full') === (session.accessMode ?? 'full')
        return editing === item.id ? (
          <QueuedMessageEditor
            key={item.id}
            item={item}
            onCancel={() => setEditing(null)}
            onSave={async (text) => {
              if (await onEdit(item.id, text)) setEditing(null)
            }}
          />
        ) : (
          <li
            key={item.id}
            className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3 text-xs"
            data-testid="chat-queue-item"
          >
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Edit queued message"
              title="Edit"
              onClick={() => setEditing(item.id)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Steer"
              disabled={!steerable}
              title={
                steerable
                  ? 'Steer: fold this message into the current response now'
                  : 'Queued with a different model or access mode. Remove it and resend, or let it send automatically after this response.'
              }
              onClick={() => onSteer(item.id)}
            >
              <Zap aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Remove queued message"
              title="Remove"
              onClick={() => onDequeue(item.id)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

function QueuedMessageEditor({
  item,
  onSave,
  onCancel
}: {
  item: QueuedMessage
  onSave: (text: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(item.text)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async (): Promise<void> => {
    if (saving) return
    if (!text.trim()) {
      setError('Write a message first.')
      return
    }
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-1 text-xs"
      data-testid="chat-queue-editor"
    >
      <form
        className="flex items-end gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <textarea
          autoFocus
          aria-label="Queued message"
          value={text}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          onFocus={(event) => {
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void save()
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 leading-5 outline-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Cancel editing"
          title="Cancel (Esc)"
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label="Save queued message"
          title="Save (Enter)"
          aria-busy={saving || undefined}
        >
          <Check aria-hidden="true" />
        </Button>
      </form>
      {error ? (
        <p role="alert" className="px-2 pb-0.5 text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  )
}
