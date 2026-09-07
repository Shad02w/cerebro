import { useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
const TAB_SWAP_TRANSITION = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const

type TerminalTabBarProps = {
  tabs: ContentTab[]
  activeTabId: number | null
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onReorder: (tabId: number, toIndex: number) => void
  onNewTab: () => void
  onOpenChanges: () => void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type SortableTabProps = {
  tab: ContentTab
  selected: boolean
  sortable: boolean
  closeHotkey: string
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onClick: (event: React.MouseEvent<HTMLElement>, tabId: number) => void
}

function SortableTab({
  tab,
  selected,
  sortable,
  closeHotkey,
  onSelect,
  onClose,
  onClick
}: SortableTabProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !sortable,
    transition: prefersReducedMotion() ? null : TAB_SWAP_TRANSITION
  })
  const isChanges = tab.kind === 'changes'

  return (
    <div
      ref={setNodeRef}
      role="tab"
      tabIndex={0}
      aria-selected={selected}
      aria-roledescription={attributes['aria-roledescription']}
      aria-describedby={attributes['aria-describedby']}
      aria-disabled={attributes['aria-disabled']}
      data-testid={isChanges ? 'changes-tab' : 'terminal-tab'}
      data-tab-kind={tab.kind}
      data-terminal-tab-id={tab.id}
      data-active={selected ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : undefined}
      className={cn(
        'app-no-drag flex h-full max-w-48 min-w-0 shrink-0 cursor-grab touch-none items-center gap-1 px-2.5 text-xs select-none',
        selected
          ? 'border-b-2 border-b-foreground bg-muted text-foreground'
          : 'border-b-2 border-b-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        isDragging && 'relative z-10 cursor-grabbing opacity-60'
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      onPointerDown={(event): void => {
        listeners?.onPointerDown?.(event)
        if (event.button !== 0) return
        if (event.target instanceof Element && event.target.closest('button')) return
        onSelect(tab.id)
      }}
      onKeyDown={(event): void => {
        listeners?.onKeyDown?.(event)
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(tab.id)
        }
      }}
      onClick={(event): void => onClick(event, tab.id)}
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
  const suppressClickRef = useRef(false)
  const tabIds = tabs.map((tab) => tab.id)
  const sortable = tabs.length > 1
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: TAB_DRAG_THRESHOLD_PX }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const onDragStart = (event: DragStartEvent): void => {
    const tabId = Number(event.active.id)
    if (!Number.isInteger(tabId)) return
    suppressClickRef.current = true
    setDraggingTabId(tabId)
    onSelect(tabId)
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setDraggingTabId(null)
    if (!over || active.id === over.id) return
    const toIndex = tabs.findIndex((tab) => tab.id === over.id)
    if (toIndex < 0) return
    onReorder(Number(active.id), toIndex)
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={(): void => setDraggingTabId(null)}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div className="flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto">
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                selected={tab.id === activeTabId}
                sortable={sortable}
                closeHotkey={closeHotkey}
                onSelect={onSelect}
                onClose={onClose}
                onClick={onTabClick}
              />
            ))}
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
        </SortableContext>
      </DndContext>
      <div className="app-drag-region min-w-8 flex-1" />
    </div>
  )
}
