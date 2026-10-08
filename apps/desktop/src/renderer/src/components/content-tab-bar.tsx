import type { PaneKind, SplitDirection, WorkspaceTab } from '@cerebro/core'
import { ChatTabIcon } from '@/components/chat/chat-tab-icon'
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
import { FileDiff, MessageSquare, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useFullScreen } from '@/hooks/use-full-screen'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { tabsListVariants, tabsTriggerVariants } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import {
  TITLEBAR_COLLAPSED_INSET_LEFT,
  TITLEBAR_FULLSCREEN_INSET_LEFT,
  TITLEBAR_FULLSCREEN_TRIGGER_PAD,
  TITLEBAR_TRIGGER_OFFSET_Y,
  TITLEBAR_HEIGHT,
  TITLEBAR_TRIGGER_LEFT
} from '@/lib/titlebar'
import { cn } from '@/lib/utils'

export type ContentTabKind = PaneKind

export type ContentTab = WorkspaceTab

const TAB_DRAG_THRESHOLD_PX = 6
const TAB_SWAP_TRANSITION = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const

type ContentTabBarProps = {
  workspaceId: number
  tabs: ContentTab[]
  activeTabId: number | null
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onReorder: (tabId: number, toIndex: number) => void
  onNewTab: () => void
  onOpenChat: () => void
  onOpenChanges: () => void
  onAddPane: (kind: PaneKind, direction: SplitDirection) => void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ContentTabMark({
  workspaceId,
  tab
}: {
  workspaceId: number
  tab: ContentTab
}): React.JSX.Element | null {
  if (tab.kind === 'terminal') {
    return <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
  }
  if (tab.kind === 'changes') {
    return <FileDiff aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
  }
  return <ChatTabIcon workspaceId={workspaceId} tab={tab} />
}

type SortableTabProps = {
  workspaceId: number
  tab: ContentTab
  selected: boolean
  sortable: boolean
  closeHotkey: string
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onClick: (event: React.MouseEvent<HTMLElement>, tabId: number) => void
}

function SortableTab({
  workspaceId,
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
  const state = selected ? 'active' : 'inactive'

  return (
    <div
      ref={setNodeRef}
      data-testid={`${tab.kind}-tab`}
      data-tab-kind={tab.kind}
      data-terminal-tab-id={tab.id}
      data-active={selected ? 'true' : 'false'}
      data-state={state}
      data-variant="pill"
      data-dragging={isDragging ? 'true' : undefined}
      className={cn(
        'group app-no-drag flex h-full max-w-48 min-w-0 shrink-0 cursor-grab touch-none items-center bg-transparent select-none',
        isDragging && 'relative z-10 cursor-grabbing opacity-60'
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      <div
        data-slot="content-tab-pill"
        data-state={state}
        data-active={selected ? '' : undefined}
        data-variant="pill"
        className={cn(tabsTriggerVariants({ variant: 'pill' }), 'w-full')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          aria-roledescription={attributes['aria-roledescription']}
          aria-describedby={attributes['aria-describedby']}
          data-terminal-tab-id={tab.id}
          className="flex h-full min-w-0 flex-1 cursor-inherit items-center gap-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onPointerDown={(event): void => {
            listeners?.onPointerDown?.(event)
            if (event.button === 0) onSelect(tab.id)
          }}
          onKeyDown={(event): void => listeners?.onKeyDown?.(event)}
          onClick={(event): void => onClick(event, tab.id)}
        >
          <ContentTabMark workspaceId={workspaceId} tab={tab} />
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
              {tab.label}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4} className="max-w-64 text-wrap">
              {tab.label}
            </TooltipContent>
          </Tooltip>
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity [.group:hover_&]:opacity-100 [.group:focus-within_&]:opacity-100 hover:bg-background/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                aria-label={`Close ${tab.label} (${closeHotkey})`}
                data-testid="content-tab-close"
                onPointerDown={(event): void => event.stopPropagation()}
                onClick={(event): void => {
                  event.stopPropagation()
                  const tablist = event.currentTarget.closest('[role="tablist"]')
                  const tabButtons = Array.from(
                    tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
                  )
                  const index = tabButtons.findIndex(
                    (button) => button.dataset.terminalTabId === String(tab.id)
                  )
                  const nextFocus =
                    tabButtons[index + 1] ??
                    tabButtons[index - 1] ??
                    tablist?.querySelector<HTMLButtonElement>('[data-testid="new-content-tab"]')
                  nextFocus?.focus()
                  onClose(tab.id)
                }}
              />
            }
          >
            <X aria-hidden="true" className="size-3" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4} className="flex items-center gap-2">
            <span>Close</span>
            <ShortcutKbd hotkey={closeHotkey} inverted />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export function ContentTabBar({
  workspaceId,
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onOpenChat,
  onOpenChanges,
  onAddPane,
  onReorder
}: ContentTabBarProps): React.JSX.Element {
  const closeHotkey = useKeybindBinding('closeTab')
  const chatHotkey = useKeybindBinding('newChat')
  const newHotkey = useKeybindBinding('newTerminal')
  const changesHotkey = useKeybindBinding('openChanges')
  const { state } = useSidebar()
  const fullScreen = useFullScreen()
  const insetLeft =
    state === 'collapsed'
      ? fullScreen
        ? TITLEBAR_FULLSCREEN_INSET_LEFT
        : TITLEBAR_COLLAPSED_INSET_LEFT
      : 0
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
      data-testid="content-tab-bar"
      data-dragging={draggingTabId != null ? 'true' : undefined}
      data-variant="pill"
      className="app-drag-region relative z-50 flex shrink-0 items-center bg-background pr-2 shadow-[inset_0_-1px_0_0_var(--border)]"
      style={{ height: TITLEBAR_HEIGHT }}
      role="tablist"
      aria-label="Workspace tabs"
    >
      {insetLeft > 0 ? (
        <div
          data-testid="titlebar-sidebar-trigger"
          className="app-no-drag flex h-full shrink-0 items-center"
          style={{
            width: insetLeft,
            paddingLeft: fullScreen ? TITLEBAR_FULLSCREEN_TRIGGER_PAD : TITLEBAR_TRIGGER_LEFT,
            paddingTop: TITLEBAR_TRIGGER_OFFSET_Y
          }}
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
          <div
            data-slot="tabs-list"
            data-variant="pill"
            className={cn(
              tabsListVariants({ variant: 'pill' }),
              // ml-* (not pl-*) — pill tabsListVariants sets data-[variant=pill]:p-0
              'ml-2 h-full w-auto min-w-0 max-w-full justify-start overflow-x-auto rounded-none bg-transparent'
            )}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                workspaceId={workspaceId}
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
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="app-no-drag my-auto shrink-0 size-6"
                    aria-label="Add tab"
                    data-testid="new-content-tab"
                  />
                }
              >
                <Plus className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="bottom"
                className="w-48"
                data-testid="add-tab-menu"
                finalFocus={false}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>New tab</DropdownMenuLabel>
                  <DropdownMenuItem
                    className="text-xs"
                    data-testid="open-chat-tab"
                    onClick={() => {
                      setAddOpen(false)
                      onOpenChat()
                    }}
                  >
                    <MessageSquare />
                    Agent
                    <DropdownMenuShortcut className="flex items-center">
                      <ShortcutKbd hotkey={chatHotkey} />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    data-testid="open-terminal-tab"
                    onClick={(): void => {
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
                    onClick={(): void => {
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
                </DropdownMenuGroup>
                {activeTabId != null ? (
                  <>
                    <DropdownMenuSeparator />
                    {(
                      [
                        ['auto', 'Add pane'],
                        ['right', 'Split right'],
                        ['down', 'Split down']
                      ] as const
                    ).map(([direction, label]) => (
                      <DropdownMenuSub key={direction}>
                        <DropdownMenuSubTrigger
                          data-testid={`pane-menu-${direction}`}
                          className="text-xs"
                        >
                          {label}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {(['chat', 'terminal', 'changes'] as const).map((kind) => (
                            <DropdownMenuItem
                              key={kind}
                              className="text-xs"
                              data-testid={`add-pane-${direction}-${kind}`}
                              onClick={() => {
                                setAddOpen(false)
                                onAddPane(kind, direction)
                              }}
                            >
                              {kind === 'terminal' ? (
                                <SquareTerminal />
                              ) : kind === 'chat' ? (
                                <MessageSquare />
                              ) : (
                                <FileDiff />
                              )}
                              {kind === 'terminal'
                                ? 'Terminal'
                                : kind === 'chat'
                                  ? 'Agent'
                                  : 'Changes'}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SortableContext>
      </DndContext>
      <div className="app-drag-region min-w-8 flex-1" />
    </div>
  )
}
