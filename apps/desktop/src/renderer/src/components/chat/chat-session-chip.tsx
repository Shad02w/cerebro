import { cn } from '@/lib/utils'

/** A pill above the composer that summarizes one part of the session, such as background jobs. */
export function ChatSessionChip({
  label,
  count,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string; count?: number }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border bg-muted/40 px-3 text-xs text-foreground/90 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted',
        className
      )}
      {...props}
    >
      {label}
      {count === undefined ? null : (
        <span className="tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  )
}
