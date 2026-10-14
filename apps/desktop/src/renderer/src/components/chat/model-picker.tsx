import { useRef, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { ChevronDown, Search, Star, RefreshCw } from 'lucide-react'
import type { AgentCatalog, AgentHarness, AgentModel } from '@cerebro/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { modelRowLabel } from './model-row-label'
import { sortAgentModels } from '@/lib/model-order'
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
  claude: '20px',
  codex: '16px',
  pi: '14px'
}

const inlineIconSizes: Record<AgentHarness, string> = {
  claude: '14px',
  codex: '11px',
  pi: '10px'
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
  peers: AgentModel[]
  error: Error | null
}

function useModelCatalog(
  manualFilter: PickerFilter | null,
  search: string,
  sessionStarted: boolean,
  harness: AgentHarness | undefined
): ModelCatalogState & { filter: PickerFilter; searching: boolean } {
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
  const query = search.trim()
  // Before a chat exists, open on favorites when the user has any. A chosen rail wins after that.
  const filter: PickerFilter =
    manualFilter ?? (!sessionStarted && favorites.length > 0 ? 'favorites' : (harness ?? 'claude'))
  const candidates = query
    ? models
    : filter === 'favorites'
      ? favorites.map((f) => models.find((m) => m.key === f.key) ?? { ...f, available: false })
      : models.filter((m) => m.harness === filter)
  const matched = query ? candidates.filter((m) => matchesSearch(m, query)) : candidates
  // Favorites stay in the order the user starred them. Every other list leads with the newest model.
  const rows = !query && filter === 'favorites' ? matched : sortAgentModels(matched)
  const error = catalog.error ?? favorite.error ?? refresh.error
  return {
    catalog,
    favorite,
    refresh,
    favorites,
    rows,
    peers: candidates,
    error,
    filter,
    searching: query.length > 0
  }
}

function HarnessIcon({
  harness,
  compact = false
}: {
  harness: AgentHarness
  compact?: boolean
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-harness-icon={harness}
      className={cn(
        'shrink-0 bg-current [mask-repeat:no-repeat] [mask-position:center]',
        compact ? 'size-4' : 'size-6',
        harness === 'claude' && 'text-[#D97757]'
      )}
      style={{
        maskImage: `url("${harnessIcons[harness]}")`,
        maskSize: (compact ? inlineIconSizes : harnessIconSizes)[harness]
      }}
    />
  )
}

function HarnessRail({
  filter,
  searching,
  onFilter
}: {
  filter: PickerFilter
  searching: boolean
  onFilter: (value: PickerFilter) => void
}): React.JSX.Element {
  return (
    <div className="flex w-11 shrink-0 flex-col gap-0.5 border-r p-1" aria-label="Filter harness">
      {filterValues.map((value) => (
        <button
          type="button"
          key={value}
          aria-label={value === 'favorites' ? 'Favorites' : harnessLabels[value]}
          aria-pressed={!searching && filter === value}
          className={cn(
            'flex h-8 items-center justify-center rounded-md px-1 text-xs',
            !searching && filter === value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60'
          )}
          onClick={() => onFilter(value)}
        >
          {value === 'favorites' ? (
            <Star aria-hidden="true" className="size-4" />
          ) : (
            <HarnessIcon harness={value} />
          )}
        </button>
      ))}
    </div>
  )
}

function ModelStatus({ model }: { model: AgentModel }): React.JSX.Element | null {
  const notes = [
    model.source === 'fallback' ? 'Fallback' : '',
    !model.available ? 'Unavailable' : ''
  ].filter(Boolean)
  if (!notes.length) return null
  return <span className="block truncate text-xs text-muted-foreground">{notes.join(' · ')}</span>
}

function ModelRow({
  model,
  peers,
  selected,
  isFavorite,
  onToggleFavorite
}: {
  model: AgentModel
  peers: AgentModel[]
  selected: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'mb-0.5 flex items-center rounded-md has-data-highlighted:bg-muted/50',
        selected ? 'bg-muted' : 'hover:bg-muted/50'
      )}
    >
      <Combobox.Item
        value={model}
        disabled={!model.available}
        className="min-w-0 flex-1 cursor-default px-2 py-1 text-left outline-none data-disabled:opacity-50"
      >
        <span className="block truncate text-[13px] leading-4 font-medium">
          {modelRowLabel(model, peers)}
        </span>
        <ModelStatus model={model} />
      </Combobox.Item>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${model.label} via ${harnessLabels[model.harness]}`}
        aria-pressed={isFavorite}
        className="mr-1 rounded-md p-1 text-muted-foreground hover:bg-background"
        onClick={onToggleFavorite}
      >
        <Star className={cn('size-3.5', isFavorite && 'fill-current text-foreground')} />
      </button>
    </div>
  )
}

function emptyMessage(pending: boolean, filter: PickerFilter, searching: boolean): string {
  if (pending) return 'Discovering native models…'
  if (searching || filter !== 'favorites') return 'No matching models.'
  return 'Star a model to keep it here.'
}

function CatalogIssues({
  issues,
  filter,
  searching
}: {
  issues: Partial<Record<AgentHarness, string>>
  filter: PickerFilter
  searching: boolean
}): React.JSX.Element | null {
  if (searching || filter === 'favorites') return null
  const issue = issues[filter]
  if (!issue) return null
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary>{harnessLabels[filter]} setup details</summary>
      <p className="max-h-20 overflow-auto break-words py-1">{issue}</p>
    </details>
  )
}

export function ModelPicker({
  selected,
  onSelect,
  sessionStarted = false
}: {
  selected?: AgentModel
  onSelect: (model: AgentModel) => void
  /** False until the chat has a session. Favorites are the first pane in that case. */
  sessionStarted?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [manualFilter, setManualFilter] = useState<PickerFilter | null>(null)
  const { catalog, favorite, refresh, favorites, rows, peers, error, filter, searching } =
    useModelCatalog(manualFilter, search, sessionStarted, selected?.harness)
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
        if (nextOpen) setManualFilter(null)
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
            title={
              selected ? `${selected.label} · ${harnessLabels[selected.harness]}` : 'Choose model'
            }
            className="max-w-full min-w-0 gap-1 px-2 text-xs"
          />
        }
      >
        {selected ? (
          <>
            <HarnessIcon harness={selected.harness} compact />
            <span data-testid="chat-model-picker-label" className="truncate">
              {selected.label}
            </span>
            <span className="sr-only">{harnessLabels[selected.harness]}</span>
          </>
        ) : (
          <span className="truncate">Choose model</span>
        )}
        <ChevronDown className="size-3 shrink-0" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" side="top" sideOffset={4} className="isolate z-50">
          <Combobox.Popup
            initialFocus={inputRef}
            aria-label="Choose model"
            data-testid="model-picker"
            className="chat-scrollbars z-50 w-[min(400px,calc(100vw-32px))] origin-(--transform-origin) overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-md outline-hidden transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <div className="flex max-h-[min(360px,60vh)]">
              <HarnessRail
                filter={filter}
                searching={searching}
                onFilter={(value) => {
                  setManualFilter(value)
                  setSearch('')
                }}
              />
              <div className="flex min-w-0 flex-1 flex-col p-2">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1">
                    <Search className="size-3.5 text-muted-foreground" />
                    <Combobox.Input
                      ref={inputRef}
                      aria-label="Search models"
                      placeholder="Search models…"
                      className="w-full bg-transparent text-[13px] outline-none"
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
                          peers={peers}
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
                  <Combobox.Empty className="px-2 py-3 text-xs text-muted-foreground empty:p-0">
                    {emptyMessage(catalog.isPending, filter, searching)}
                  </Combobox.Empty>
                </div>
                <CatalogIssues
                  issues={catalog.data?.issues ?? {}}
                  filter={filter}
                  searching={searching}
                />
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
