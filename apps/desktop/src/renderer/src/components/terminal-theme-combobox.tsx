import { TERMINAL_THEMES, type TerminalThemeId } from '@shared/terminal-themes'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const MAX_VISIBLE_THEMES = 100

type TerminalThemeComboboxProps = {
  id?: string
  value: string
  themes: string[]
  disabled?: boolean
  placeholder: string
  emptyLabel: string
  testId: string
  onChange: (value: string) => void
}

function filterThemees(themes: string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return themes
  return themes.filter((name) => name.toLowerCase().includes(needle))
}

function ThemeNameCombobox({
  id,
  value,
  themes,
  disabled = false,
  placeholder,
  emptyLabel,
  testId,
  onChange
}: TerminalThemeComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const listboxId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [menuWidth, setMenuWidth] = useState<number>()

  const matches = useMemo(() => filterThemees(themes, query), [themes, query])
  const visible = matches.slice(0, MAX_VISIBLE_THEMES)
  const hiddenCount = matches.length - visible.length

  useEffect(() => {
    optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const selectTheme = (name: string): void => {
    onChange(name)
    setOpen(false)
    setQuery('')
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    setHighlight(0)
    setOpen(nextOpen)
    if (nextOpen) {
      setMenuWidth(triggerRef.current?.offsetWidth)
    } else {
      setQuery('')
    }
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (visible.length === 0) return
      setHighlight((current) => (current + 1) % visible.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length === 0) return
      setHighlight((current) => (current - 1 + visible.length) % visible.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = visible[highlight]
      if (selected) selectTheme(selected)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          id={id}
          ref={triggerRef}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          disabled={disabled}
          data-testid={testId}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[70] p-0"
        style={menuWidth ? { width: menuWidth } : undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchRef.current?.focus()
        }}
      >
        <div className="border-b p-2">
          <Input
            ref={searchRef}
            value={query}
            disabled={disabled}
            placeholder="Search themes"
            aria-label="Search themes"
            data-testid={`${testId}-search`}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={visible.length ? `${listboxId}-${highlight}` : undefined}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label="Themes"
          className="max-h-60 overflow-y-auto p-1"
        >
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            visible.map((name, index) => {
              const selected = name === value
              return (
                <button
                  key={name}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-highlighted={index === highlight || undefined}
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  className={cn(
                    'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left text-sm outline-hidden select-none',
                    index === highlight && 'bg-accent text-accent-foreground'
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => selectTheme(name)}
                >
                  <span className="truncate">{name}</span>
                  {selected ? <CheckIcon className="absolute right-2 size-4" /> : null}
                </button>
              )
            })
          )}
        </div>
        {hiddenCount > 0 ? (
          <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            Showing {visible.length} of {matches.length}. Type to narrow results.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export function TerminalThemeCombobox({
  value,
  onChange
}: {
  value: TerminalThemeId
  onChange: (value: TerminalThemeId) => void
}): React.JSX.Element {
  return (
    <ThemeNameCombobox
      id="terminal-theme"
      value={TERMINAL_THEMES.find((theme) => theme.id === value)?.label ?? 'Cerebro Default'}
      themes={TERMINAL_THEMES.map((theme) => theme.label)}
      placeholder="Select a theme"
      emptyLabel="No themes found."
      testId="settings-terminal-theme"
      onChange={(label) => {
        const theme = TERMINAL_THEMES.find((theme) => theme.label === label)
        if (theme) onChange(theme.id)
      }}
    />
  )
}
