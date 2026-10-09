import { useRef, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { Check, ChevronDown, Search, Star, RefreshCw } from 'lucide-react'
import type { AgentCatalog, AgentHarness, AgentModel } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { harnessLabels, catalogOptions } from './queries'
import claudeIcon from '@/assets/agents/claude.svg'
import codexIcon from '@/assets/agents/codex.svg'
import piIcon from '@/assets/agents/pi.svg'
import './chat-scrollbars.css'

const harnessIcons: Record<AgentHarness, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  pi: piIcon
}

type PickerFilter = AgentHarness | 'favorites'

const filterValues: PickerFilter[] = ['favorites', 'claude', 'codex', 'pi']

const harnessIconSizes: Record<AgentHarness, string> = {
  claude: '28px',
  codex: '22px',
  pi: '20px'
}

function matchesSearch(model: AgentModel, search: string): boolean {
  return `${model.label} ${model.id} ${model.provider} ${harnessLabels[model.harness]}`
    .toLowerCase()
    .includes(search.toLowerCase())
}

interface ModelCatalogState {
  catalog: UseQueryResult<AgentCatalog>
  favorite: UseMutationResult<AgentCatalog, Error, { key: string; value: boolean }>
  refresh: UseMutationResult<AgentCatalog, Error, void>
  favorites: AgentCatalog['favorites']
  rows: AgentModel[]
  error: Error | null
}

function useModelCatalog(filter: PickerFilter, search: string): ModelCatalogState {
  const client = useQueryClient()
  const catalog = useQuery(catalogOptions)
  const favorite = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) =>
      window.cerebro.agentFavorite(key, value),
    onSuccess: (data) => client.setQueryData(catalogOptions.queryKey, data)
  })
  const refresh = useMutation({
    mutationFn: () => window.cerebro.agentCatalog(true),
    onSuccess: (data) => client.setQueryData(catalogOptions.queryKey, data)
  })
  const favorites = catalog.data?.favorites ?? []
  const models = catalog.data?.models ?? []
  const candidates =
    filter === 'favorites'
      ? favorites.map((f) => models.find((m) => m.key === f.key) ?? { ...f, available: false })
      : models.filter((m) => m.harness === filter)
  const rows = candidates.filter((m) => matchesSearch(m, search))
  const error = catalog.error ?? favorite.error ?? refresh.error
  return { catalog, favorite, refresh, favorites, rows, error }
}

function HarnessIcon({ harness }: { harness: AgentHarness }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-harness-icon={harness}
      className={cn(
        'size-8 bg-current [mask-repeat:no-repeat] [mask-position:center]',
        harness === 'claude' && 'text-[#D97757]'
      )}
      style={{
        maskImage: `url("${harnessIcons[harness]}")`,
        maskSize: harnessIconSizes[harness]
      }}
    />
  )
}

function HarnessRail({
  filter,
  onFilter
}: {
  filter: PickerFilter
  onFilter: (value: PickerFilter) => void
}): React.JSX.Element {
  return (
    <div className="flex w-20 shrink-0 flex-col gap-1 border-r p-2" aria-label="Filter harness">
      {filterValues.map((value) => (
        <button
          type="button"
          key={value}
          aria-label={value === 'favorites' ? 'Favorites' : harnessLabels[value]}
          aria-pressed={filter === value}
          className={cn(
            'flex h-12 items-center justify-center rounded-lg px-1 text-xs',
            filter === value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60'
          )}
          onClick={() => onFilter(value)}
        >
          {value === 'favorites' ? (
            <Star aria-hidden="true" className="size-[22px]" />
          ) : (
            <HarnessIcon harness={value} />
          )}
        </button>
      ))}
    </div>
  )
}

function ModelDetail({ model }: { model: AgentModel }): React.JSX.Element {
  const provider =
    model.provider === 'configured' ? model.id || 'Native configuration' : model.provider
  return (
    <span className="block truncate text-xs text-muted-foreground">
      {harnessLabels[model.harness]} · {provider}
      {model.source === 'fallback' ? ' · Fallback' : ''}
      {!model.available ? ' · Unavailable' : ''}
    </span>
  )
}

function ModelRow({
  model,
  selected,
  isFavorite,
  onToggleFavorite
}: {
  model: AgentModel
  selected: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'mb-1 flex items-center rounded-xl has-data-highlighted:bg-muted/50',
        selected ? 'bg-muted' : 'hover:bg-muted/50'
      )}
    >
      <Combobox.Item
        value={model}
        disabled={!model.available}
        className="min-w-0 flex-1 cursor-default px-3 py-3 text-left outline-none data-disabled:opacity-50"
      >
        <span className="flex items-center gap-2 truncate text-sm font-medium">
          {model.label}
          <Combobox.ItemIndicator>
            <Check className="size-3" />
          </Combobox.ItemIndicator>
        </span>
        <ModelDetail model={model} />
      </Combobox.Item>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${model.label} via ${harnessLabels[model.harness]}`}
        aria-pressed={isFavorite}
        className="mr-2 rounded-lg p-2 text-muted-foreground hover:bg-background"
        onClick={onToggleFavorite}
      >
        <Star className={cn('size-4', isFavorite && 'fill-current text-foreground')} />
      </button>
    </div>
  )
}

function emptyMessage(pending: boolean, filter: PickerFilter): string {
  if (pending) return 'Discovering native models…'
  return filter === 'favorites' ? 'Star a model to keep it here.' : 'No matching models.'
}

function CatalogIssues({ issues }: { issues: Record<string, string> }): React.JSX.Element[] {
  return Object.entries(issues).map(([harness, issue]) => (
    <details key={harness} className="mt-2 text-xs text-muted-foreground">
      <summary>{harnessLabels[harness as AgentHarness]} setup details</summary>
      <p className="max-h-20 overflow-auto break-words py-1">{issue}</p>
    </details>
  ))
}

export function ModelPicker({
  selected,
  onSelect
}: {
  selected?: AgentModel
  onSelect: (model: AgentModel) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<PickerFilter>(selected?.harness ?? 'claude')
  const { catalog, favorite, refresh, favorites, rows, error } = useModelCatalog(filter, search)
  return (
    <Combobox.Root
      items={rows}
      filter={null}
      value={selected ?? null}
      onValueChange={(model) => {
        if (model) onSelect(model)
      }}
      isItemEqualToValue={(a, b) => a.key === b.key}
      itemToStringLabel={(m) => m.label}
      inputValue={search}
      onInputValueChange={setSearch}
      autoHighlight
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setFilter(selected?.harness ?? 'claude')
        setSearch('')
        setOpen(nextOpen)
      }}
    >
      <Combobox.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="chat-model-picker"
            className="max-w-full gap-1 text-xs"
          />
        }
      >
        <span className="truncate">
          {selected ? `${selected.label} · ${harnessLabels[selected.harness]}` : 'Choose model'}
        </span>
        <ChevronDown className="size-3" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" side="top" sideOffset={4} className="isolate z-50">
          <Combobox.Popup
            initialFocus={inputRef}
            aria-label="Choose model"
            data-testid="model-picker"
            className="chat-scrollbars z-50 w-[min(520px,calc(100vw-32px))] origin-(--transform-origin) overflow-hidden rounded-2xl border bg-popover p-0 text-popover-foreground shadow-md outline-hidden transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <div className="flex max-h-[min(520px,70vh)] min-h-72">
              <HarnessRail filter={filter} onFilter={setFilter} />
              <div className="flex min-w-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                    <Search className="size-4 text-muted-foreground" />
                    <Combobox.Input
                      ref={inputRef}
                      aria-label="Search models"
                      placeholder="Search models…"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Refresh models"
                    className="rounded p-1 hover:bg-muted"
                    onClick={() => {
                      if (!refresh.isPending) refresh.mutate()
                    }}
                  >
                    <RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />
                  </button>
                </div>
                <div className="model-picker-list min-h-0 flex-1 overflow-y-auto">
                  <Combobox.List aria-label="Models">
                    {(m: AgentModel) => {
                      const isFavorite = favorites.some((f) => f.key === m.key)
                      return (
                        <ModelRow
                          key={m.key}
                          model={m}
                          selected={selected?.key === m.key}
                          isFavorite={isFavorite}
                          onToggleFavorite={() => {
                            if (!favorite.isPending)
                              favorite.mutate({ key: m.key, value: !isFavorite })
                          }}
                        />
                      )
                    }}
                  </Combobox.List>
                  <Combobox.Empty className="p-4 text-sm text-muted-foreground empty:p-0">
                    {emptyMessage(catalog.isPending, filter)}
                  </Combobox.Empty>
                </div>
                <CatalogIssues issues={catalog.data?.issues ?? {}} />
                {error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {String(error)}
                  </p>
                ) : null}
              </div>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
