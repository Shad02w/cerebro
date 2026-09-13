import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { PositionedPane, PositionedSplit } from '@/lib/pane-layout'
import { X } from 'lucide-react'

export function PaneFrame({
  pane,
  rect,
  active,
  multiple,
  visible,
  onFocus,
  onClose,
  children
}: PositionedPane & {
  active: boolean
  multiple: boolean
  visible: boolean
  onFocus: () => void
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !visible) return
    const measure = (): void =>
      window.cerebro.measurePane(pane.id, element.clientWidth, element.clientHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [pane.id, visible])
  useEffect(() => {
    if (active && visible && pane.kind === 'changes') ref.current?.focus({ preventScroll: true })
  }, [active, visible, pane.kind])
  return (
    <div
      ref={ref}
      data-testid="pane"
      data-pane-id={pane.id}
      data-pane-kind={pane.kind}
      data-pane-active={active ? 'true' : 'false'}
      tabIndex={-1}
      aria-label={`${pane.kind === 'terminal' ? 'Terminal' : pane.kind === 'chat' ? 'Chat' : 'Changes'} pane ${pane.id}`}
      className={`absolute outline-none ${multiple ? 'p-[3px]' : ''}`}
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`
      }}
      onPointerDownCapture={() => {
        if (!active) onFocus()
      }}
      onFocusCapture={() => {
        if (!active) onFocus()
      }}
    >
      <div
        className={`relative isolate h-full overflow-hidden ${multiple ? 'rounded-sm border-[0.5px]' : ''} ${active && multiple ? 'ring ring-(--sidebar-selected) shadow-[0_0_7px_1px_color-mix(in_oklch,var(--sidebar-selected)_42%,transparent)]' : ''}`}
        data-testid="pane-border"
        style={
          {
            borderColor: multiple
              ? active
                ? 'var(--sidebar-selected)'
                : 'var(--pane-border)'
              : 'transparent',
            '--pane-controls-width': multiple ? '3.5rem' : '2rem',
            '--pane-controls-height': '1.5rem'
          } as CSSProperties
        }
      >
        <div
          data-testid="pane-controls"
          className="absolute top-1 right-1 z-20 flex items-center gap-1 rounded bg-background/90 px-1 py-0.5 text-[10px] text-muted-foreground"
        >
          <span data-testid="pane-id">#{pane.id}</span>
          {multiple ? (
            <button
              type="button"
              aria-label={`Close pane ${pane.id}`}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
        <div data-testid="pane-content" className="absolute inset-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

export function SplitHandle({
  split,
  rect,
  priority,
  onResize
}: PositionedSplit & { priority: number; onResize: (ratio: number) => void }): React.JSX.Element {
  const drag = useRef<{ start: number; size: number } | null>(null)
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRatio = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
    },
    []
  )
  const flushResize = (): void => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current)
    if (pendingRatio.current !== null) {
      onResize(pendingRatio.current)
      pendingRatio.current = null
    }
  }
  const right = split.direction === 'right'
  const style: CSSProperties = right
    ? {
        left: `calc(${rect.x + rect.width * split.ratio}% - 3px)`,
        top: `${rect.y}%`,
        width: 6,
        height: `${rect.height}%`,
        cursor: 'col-resize'
      }
    : {
        left: `${rect.x}%`,
        top: `calc(${rect.y + rect.height * split.ratio}% - 3px)`,
        width: `${rect.width}%`,
        height: 6,
        cursor: 'row-resize'
      }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize split ${split.id}`}
      aria-orientation={right ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(split.ratio * 100)}
      aria-valuemin={10}
      aria-valuemax={90}
      data-testid="pane-divider"
      data-split-id={split.id}
      data-direction={split.direction}
      className="absolute z-10 touch-none rounded hover:bg-ring/40 focus-visible:bg-ring/40 outline-none"
      style={{ ...style, zIndex: priority }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
        drag.current = right
          ? {
              start: bounds.left + (bounds.width * rect.x) / 100,
              size: (bounds.width * rect.width) / 100
            }
          : {
              start: bounds.top + (bounds.height * rect.y) / 100,
              size: (bounds.height * rect.height) / 100
            }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const ratio =
          ((right ? event.clientX : event.clientY) - drag.current.start) / drag.current.size
        pendingRatio.current = Math.max(0.1, Math.min(0.9, ratio))
        if (resizeTimer.current) clearTimeout(resizeTimer.current)
        resizeTimer.current = setTimeout(flushResize, 40)
      }}
      onPointerUp={(event) => {
        flushResize()
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => {
        flushResize()
        drag.current = null
      }}
      onKeyDown={(event) => {
        const decrease = right ? 'ArrowLeft' : 'ArrowUp'
        const increase = right ? 'ArrowRight' : 'ArrowDown'
        if (event.key !== decrease && event.key !== increase) return
        event.preventDefault()
        onResize(
          Math.max(0.1, Math.min(0.9, split.ratio + (event.key === increase ? 0.05 : -0.05)))
        )
      }}
    />
  )
}
