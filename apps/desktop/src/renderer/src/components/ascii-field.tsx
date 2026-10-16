import { useEffect, useRef } from 'react'
import { mountAsciiField } from '@/lib/ascii-field-renderer'
import { cn } from '@/lib/utils'

type AsciiFieldProps = {
  className?: string
  /** Reflected as `data-visible` so a parent's CSS can fade the layer. */
  visible?: boolean
}

/**
 * Drifting ASCII texture behind an empty surface. The parent must be positioned and
 * `isolate` so the layer paints under its content; clicks on the parent's empty space
 * send a ripple through it.
 */
export function AsciiField({ className, visible = true }: AsciiFieldProps): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    return mountAsciiField(layer)
  }, [])

  return (
    <div
      ref={layerRef}
      aria-hidden
      data-testid="ascii-field"
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden font-mono text-muted-foreground [contain:strict]',
        className
      )}
    />
  )
}
