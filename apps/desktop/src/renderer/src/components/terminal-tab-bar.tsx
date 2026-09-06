import { useState } from 'react'
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

type TerminalTabBarProps = {
  tabs: ContentTab[]
  activeTabId: number | null
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onNewTab: () => void
  onOpenChanges: () => void
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onOpenChanges
}: TerminalTabBarProps): React.JSX.Element {
  const closeHotkey = useKeybindBinding('closeTab')
  const newHotkey = useKeybindBinding('newTerminal')
  const changesHotkey = useKeybindBinding('openChanges')
  const { state } = useSidebar()
  const insetLeft = state === 'collapsed' ? TITLEBAR_COLLAPSED_INSET_LEFT : 0
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div
      data-testid="terminal-tab-bar"
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
      <div className="flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId
          const isChanges = tab.kind === 'changes'
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              data-testid={isChanges ? 'changes-tab' : 'terminal-tab'}
              data-tab-kind={tab.kind}
              data-terminal-tab-id={tab.id}
              data-active={selected ? 'true' : 'false'}
              className={cn(
                'app-no-drag flex h-full max-w-48 min-w-0 shrink-0 cursor-pointer items-center gap-1 px-2.5 text-xs',
                selected
                  ? 'border-b-2 border-b-foreground bg-muted text-foreground'
                  : 'border-b-2 border-b-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              onClick={(): void => onSelect(tab.id)}
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
