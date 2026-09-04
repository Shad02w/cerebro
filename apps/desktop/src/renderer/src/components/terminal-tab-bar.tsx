import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  return (
    <div
      data-testid="terminal-tab-bar"
      className="app-drag-region relative z-50 flex h-10 shrink-0 items-stretch border-b bg-background pr-2"
      role="tablist"
      aria-label="Terminal tabs"
    >
      <div className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
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
              <button
                type="button"
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Close ${tab.label}`}
                data-testid="terminal-tab-close"
                onClick={(event): void => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-no-drag my-auto shrink-0"
          aria-label="New terminal"
          data-testid="new-terminal-tab"
          onClick={onNewTab}
        >
          <Plus />
        </Button>
      </div>
      <div className="app-drag-region min-w-8 flex-1" />
    </div>
  )
}
