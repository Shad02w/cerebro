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
      className={cn('inline-flex items-center gap-0.5 tracking-normal', className)}
      data-testid="shortcut-kbd"
      data-hotkey={hotkey}
    >
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border bg-transparent px-1 font-sans text-[10px] font-medium leading-none',
            inverted
              ? 'border-background/40 text-background shadow-[0_1px_0_0_color-mix(in_oklch,var(--background)_45%,transparent)]'
              : 'border-foreground/20 text-muted-foreground shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_28%,transparent)]'
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
