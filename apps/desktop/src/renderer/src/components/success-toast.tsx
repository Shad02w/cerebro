import { useEffect, useRef } from 'react'
import { Toast } from '@base-ui/react/toast'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type SuccessToastValue = { id: number; message: string }

/** `info` is for notices that are neither a success nor a failure, such as a lost prompt cache. */
export type ToastTone = 'success' | 'error' | 'info'

const toneIcons: Record<ToastTone, typeof Check> = {
  success: Check,
  error: CircleAlert,
  info: Info
}

const toneColors: Record<ToastTone, string> = {
  success: 'text-green-500',
  error: 'text-destructive',
  info: 'text-sky-500'
}

function ToastList({
  toast,
  onDismiss,
  testId,
  tone
}: {
  toast: SuccessToastValue
  onDismiss: () => void
  testId?: string
  tone: ToastTone
}): React.JSX.Element {
  const manager = Toast.useToastManager()
  const added = useRef(false)
  const onDismissRef = useRef(onDismiss)
  const Icon = toneIcons[tone]
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    if (added.current) return
    added.current = true
    manager.add({ title: toast.message, onClose: () => onDismissRef.current() })
  }, [manager, toast.message])

  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-6 bottom-6 z-50 m-0 flex w-96 max-w-[calc(100vw-3rem)] list-none flex-col gap-2 outline-none">
        {manager.toasts.map((item) => (
          <Toast.Root
            key={item.id}
            toast={item}
            swipeDirection="right"
            data-testid={testId}
            className="app-no-drag flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg transition-[opacity,transform] duration-200 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
          >
            <Icon className={cn('size-4 shrink-0', toneColors[tone])} aria-hidden="true" />
            <Toast.Title className="flex-1 text-sm" />
            <Toast.Close
              aria-label="Dismiss notification"
              aria-hidden={false}
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export function SuccessToast({
  toast,
  onDismiss,
  testId,
  tone = 'success'
}: {
  toast: SuccessToastValue | null
  onDismiss: () => void
  testId?: string
  tone?: ToastTone
}): React.JSX.Element | null {
  if (!toast) return null
  // Keyed by id so a repeated message replaces the previous toast and restarts its timer.
  return (
    <Toast.Provider key={toast.id} timeout={4000} limit={1}>
      <ToastList toast={toast} onDismiss={onDismiss} testId={testId} tone={tone} />
    </Toast.Provider>
  )
}
