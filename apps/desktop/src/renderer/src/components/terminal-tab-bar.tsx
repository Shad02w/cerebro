import { useLayoutEffect, useRef, useState } from 'react'
import { FileDiff, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import {
  TITLEBAR_COLLAPSED_INSET_LEFT,
  TITLEBAR_HEIGHT,
  TITLEBAR_TRIGGER_LEFT
} from '@/lib/titlebar'
import { cn } from '@/lib/utils'

export type ContentTabKind = 'terminal' | 'changes'

export type ContentTab = {
  id: number
  kind: ContentTabKind
  label: string
}

export type TerminalTab = ContentTab

const TAB_DRAG_THRESHOLD_PX = 6
const TAB_SWAP_EPSILON_PX = 0.5

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function currentTranslateX(el: HTMLElement): number {
  const value = getComputedStyle(el).transform
  if (!value || value === 'none') return 0
  try {
    return new DOMMatrix(value).m41
  } catch {
    return 0
  }
}

/** Layout left, ignoring an in-flight swap transform so hit-testing stays stable. */
function layoutLeft(el: HTMLElement): number {
  return el.getBoundingClientRect().left - currentTranslateX(el)
}

function snapshotVisualLefts(container: HTMLElement): Map<number, number> {
  const lefts = new Map<number, number>()
  for (const el of container.querySelectorAll<HTMLElement>('[data-terminal-tab-id]')) {
    const id = Number(el.dataset.terminalTabId)
    if (!Number.isInteger(id)) continue
    lefts.set(id, el.getBoundingClientRect().left)
  }
  return lefts
}

function clearTabSwap(el: HTMLElement): void {
  el.classList.remove('tab-swap-animate')
  el.style.transition = ''
  el.style.transform = ''
}

type TabDragState = {
  pointerId: number
  tabId: number
  startX: number
  didDrag: boolean
}

type TerminalTabBarProps = {
  tabs: ContentTab[]
  activeTabId: number | null
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onReorder: (tabId: number, toIndex: number) => void
  onNewTab: () => void
  onOpenChanges: () => void
}

function dropIndexFromPoint(
  container: HTMLElement,
  draggedTabId: number,
  x: number
): number | null {
  const tabEls = Array.from(container.querySelectorAll<HTMLElement>('[data-terminal-tab-id]'))
  if (tabEls.length === 0) return null

  const remaining = tabEls.filter((el) => Number(el.dataset.terminalTabId) !== draggedTabId)
  for (let i = 0; i < remaining.length; i++) {
    const el = remaining[i]
    if (x < layoutLeft(el) + el.offsetWidth / 2) return i
  }
  return remaining.length
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onOpenChanges,
  onReorder
}: TerminalTabBarProps): React.JSX.Element {
  const closeHotkey = useKeybindBinding('closeTab')
  const newHotkey = useKeybindBinding('newTerminal')
  const changesHotkey = useKeybindBinding('openChanges')
  const { state } = useSidebar()
  const insetLeft = state === 'collapsed' ? TITLEBAR_COLLAPSED_INSET_LEFT : 0
  const [addOpen, setAddOpen] = useState(false)
  const [draggingTabId, setDraggingTabId] = useState<number | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<TabDragState | null>(null)
  const suppressClickRef = useRef(false)
  const flipFromRef = useRef<Map<number, number> | null>(null)

  useLayoutEffect(() => {
    const from = flipFromRef.current
    if (!from) return
    flipFromRef.current = null

    const container = tabsRef.current
    if (!container || prefersReducedMotion()) return

    const moving: HTMLElement[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[data-terminal-tab-id]')) {
      const id = Number(el.dataset.terminalTabId)
      const first = from.get(id)
      if (first == null) continue

      el.classList.remove('tab-swap-animate')
      el.style.transition = 'none'
      el.style.transform = ''
      const dx = first - el.getBoundingClientRect().left
      if (Math.abs(dx) < TAB_SWAP_EPSILON_PX) {
        el.style.transition = ''
        continue
      }
      el.style.transform = `translate3d(${dx}px,0,0)`
      moving.push(el)
    }
    if (moving.length === 0) return

    const frame = window.requestAnimationFrame(() => {
      for (const el of moving) {
        el.style.transition = ''
        el.classList.add('tab-swap-animate')
        el.style.transform = ''
      }
    })
    return (): void => window.cancelAnimationFrame(frame)
  }, [tabs])

  useLayoutEffect(() => {
    const container = tabsRef.current
    if (!container) return

    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.propertyName !== 'transform') return
      const el = event.target
      if (!(el instanceof HTMLElement) || !el.hasAttribute('data-terminal-tab-id')) return
      clearTabSwap(el)
    }

    container.addEventListener('transitionend', onTransitionEnd)
    return (): void => container.removeEventListener('transitionend', onTransitionEnd)
  }, [])

  const finishDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.didDrag) suppressClickRef.current = true
    dragRef.current = null
    setDraggingTabId(null)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }

  const onTabPointerDown = (event: React.PointerEvent<HTMLElement>, tabId: number): void => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button')) return

    dragRef.current = {
      pointerId: event.pointerId,
      tabId,
      startX: event.clientX,
      didDrag: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(tabId)
  }

  const onTabPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (!drag.didDrag) {
      if (Math.abs(event.clientX - drag.startX) < TAB_DRAG_THRESHOLD_PX) return
      if (tabs.length < 2) return
      drag.didDrag = true
      setDraggingTabId(drag.tabId)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const container = tabsRef.current
    if (!container) return
    const toIndex = dropIndexFromPoint(container, drag.tabId, event.clientX)
    if (toIndex == null) return
    const fromIndex = tabs.findIndex((tab) => tab.id === drag.tabId)
    if (fromIndex < 0 || fromIndex === toIndex) return
    flipFromRef.current = snapshotVisualLefts(container)
    onReorder(drag.tabId, toIndex)
  }

  const onTabClick = (event: React.MouseEvent<HTMLElement>, tabId: number): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      return
    }
    onSelect(tabId)
  }

  return (
    <div
      data-testid="terminal-tab-bar"
      data-dragging={draggingTabId != null ? 'true' : undefined}
      className="app-drag-region relative z-50 flex shrink-0 items-stretch bg-background pr-2 shadow-[inset_0_-1px_0_0_var(--border)]"
      style={{ height: TITLEBAR_HEIGHT }}
      role="tablist"
      aria-label="Workspace tabs"
    >
      {insetLeft > 0 ? (
        <div
          data-testid="titlebar-sidebar-trigger"
          className="app-no-drag flex h-full shrink-0 items-center"
          style={{ width: insetLeft, paddingLeft: TITLEBAR_TRIGGER_LEFT }}
        >
          <SidebarTrigger size="icon-xs" className="app-no-drag size-6" />
        </div>
      ) : null}
      <div ref={tabsRef} className="flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId
          const isChanges = tab.kind === 'changes'
          const dragging = tab.id === draggingTabId
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              aria-grabbed={dragging}
              data-testid={isChanges ? 'changes-tab' : 'terminal-tab'}
              data-tab-kind={tab.kind}
              data-terminal-tab-id={tab.id}
              data-active={selected ? 'true' : 'false'}
              data-dragging={dragging ? 'true' : undefined}
              className={cn(
                'app-no-drag flex h-full max-w-48 min-w-0 shrink-0 cursor-grab touch-none items-center gap-1 px-2.5 text-xs select-none',
                selected
                  ? 'border-b-2 border-b-foreground bg-muted text-foreground'
                  : 'border-b-2 border-b-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                dragging && 'relative z-10 cursor-grabbing opacity-60'
              )}
              onPointerDown={(event): void => onTabPointerDown(event, tab.id)}
              onPointerMove={onTabPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onClick={(event): void => onTabClick(event, tab.id)}
              onKeyDown={(event): void => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(tab.id)
                }
              }}
            >
              <span className="truncate">{tab.label}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label={`Close ${tab.label} (${closeHotkey})`}
                    data-testid="terminal-tab-close"
                    onPointerDown={(event): void => event.stopPropagation()}
                    onClick={(event): void => {
                      event.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4} className="flex items-center gap-2">
                  <span>Close</span>
                  <ShortcutKbd hotkey={closeHotkey} inverted />
                </TooltipContent>
              </Tooltip>
            </div>
          )
        })}
        <DropdownMenu modal={false} open={addOpen} onOpenChange={setAddOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="app-no-drag my-auto shrink-0 size-6"
              aria-label="Add tab"
              data-testid="new-terminal-tab"
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            className="w-48"
            data-testid="add-tab-menu"
            onCloseAutoFocus={(event): void => event.preventDefault()}
          >
            <DropdownMenuItem
              className="text-xs"
              data-testid="open-terminal-tab"
              onSelect={(): void => {
                setAddOpen(false)
                onNewTab()
              }}
            >
              <SquareTerminal />
              Terminal
              <DropdownMenuShortcut className="flex items-center">
                <ShortcutKbd hotkey={newHotkey} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              data-testid="open-changes-tab"
              onSelect={(): void => {
                setAddOpen(false)
                onOpenChanges()
              }}
            >
              <FileDiff />
              Changes
              <DropdownMenuShortcut className="flex items-center">
                <ShortcutKbd hotkey={changesHotkey} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="app-drag-region min-w-8 flex-1" />
    </div>
  )
}
