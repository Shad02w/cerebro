import { shortcutKeys } from './shortcut-keys'
import { cn } from '@/lib/utils'

type ShortcutKbdProps = {
  hotkey: string
  className?: string
  /** Invert chip colors for tooltips that use `bg-foreground`. */
  inverted?: boolean
}

export function ShortcutKbd({
  hotkey,
  className,
  inverted = false
}: ShortcutKbdProps): React.JSX.Element {
  const keys = shortcutKeys(hotkey)
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      data-testid="shortcut-kbd"
      data-hotkey={hotkey}
    >
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[10px] font-medium',
            inverted
              ? 'border-background/30 bg-background/15 text-background'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
