import { useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SuccessToast } from '@/components/success-toast'
import { useClipboard } from '@/hooks/use-clipboard'

export function ChatUserMessage({ text }: { text: string }): React.JSX.Element {
  const copy = useClipboard()
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [error, setError] = useState(false)
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
      <div className="max-w-full rounded-2xl bg-muted px-4 py-3 text-sm whitespace-pre-wrap break-words">
        {text}
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
    </div>
  )
}
