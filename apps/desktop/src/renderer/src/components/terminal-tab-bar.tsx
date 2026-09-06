import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKbd, useKeybindBinding } from '@/keybinds'
import { TITLEBAR_COLLAPSED_INSET_LEFT, TITLEBAR_HEIGHT } from '@/lib/titlebar'
import { cn } from '@/lib/utils'

export type TerminalTab = {
  id: number
  label: string
}

type TerminalTabBarProps = {
  tabs: TerminalTab[]
  activeTabId: number | null
  onSelect: (tabId: number) => void
  onClose: (tabId: number) => void
  onNewTab: () => void
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab
}: TerminalTabBarProps): React.JSX.Element {
  const closeHotkey = useKeybindBinding('closeTab')
  const newHotkey = useKeybindBinding('newTerminal')
  const { state } = useSidebar()
  const insetLeft = state === 'collapsed' ? TITLEBAR_COLLAPSED_INSET_LEFT : 0

  return (
    <div
      data-testid="terminal-tab-bar"
      className="app-drag-region relative z-50 flex shrink-0 items-center bg-background pr-2 shadow-[inset_0_-1px_0_0_var(--border)]"
      style={{
        height: TITLEBAR_HEIGHT,
        ...(insetLeft > 0 ? { paddingLeft: insetLeft } : {})
      }}
      role="tablist"
      aria-label="Terminal tabs"
    >
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              data-testid="terminal-tab"
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="app-no-drag my-auto shrink-0 size-6"
              aria-label={`New terminal (${newHotkey})`}
              data-testid="new-terminal-tab"
              onClick={onNewTab}
            >
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4} className="flex items-center gap-2">
            <span>New terminal</span>
            <ShortcutKbd hotkey={newHotkey} inverted />
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="app-drag-region min-w-8 flex-1" />
    </div>
  )
}
