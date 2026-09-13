import { Toast } from 'radix-ui'
import { Check, X } from 'lucide-react'

export function SuccessToast({
  toast,
  onDismiss,
  testId
}: {
  toast: { id: number; message: string } | null
  onDismiss: () => void
  testId?: string
}): React.JSX.Element | null {
  if (!toast) return null
  return (
    <Toast.Provider duration={4000} swipeDirection="right">
      {toast ? (
        <Toast.Root
          key={toast.id}
          defaultOpen
          onOpenChange={(open) => {
            if (!open) onDismiss()
          }}
          data-testid={testId}
          className="app-no-drag flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <Check className="size-4 shrink-0 text-green-500" aria-hidden="true" />
          <Toast.Title className="flex-1 text-sm">{toast.message}</Toast.Title>
          <Toast.Close
            aria-label="Dismiss notification"
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </Toast.Close>
        </Toast.Root>
      ) : null}
      <Toast.Viewport className="fixed right-6 bottom-6 z-50 m-0 flex w-96 max-w-[calc(100vw-3rem)] list-none flex-col gap-2 outline-none" />
    </Toast.Provider>
  )
}
