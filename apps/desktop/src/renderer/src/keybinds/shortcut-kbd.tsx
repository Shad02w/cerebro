import { shortcutKeys } from './shortcut-keys'
import { cn } from '@/lib/utils'

type ShortcutKbdProps = {
  hotkey: string
  className?: string
  /** Invert chip colors for tooltips that use `bg-foreground`. */
  inverted?: boolean
  /** Visual hint only; keep it out of the parent control's accessible name. */
  decorative?: boolean
}

export function ShortcutKbd({
  hotkey,
  className,
  inverted = false,
  decorative = false
}: ShortcutKbdProps): React.JSX.Element {
  const keys = shortcutKeys(hotkey)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-sans text-[11px] font-medium leading-none tracking-normal',
        inverted ? 'text-background/75' : 'text-muted-foreground',
        className
      )}
      data-testid="shortcut-kbd"
      data-hotkey={hotkey}
      aria-hidden={decorative || undefined}
    >
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className="font-sans font-medium">
          {key}
        </kbd>
      ))}
    </span>
  )
}
