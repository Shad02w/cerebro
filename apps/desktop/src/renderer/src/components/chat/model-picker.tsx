import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Search, Star, RefreshCw } from 'lucide-react'
import type { AgentHarness, AgentModel } from '@cerebro/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
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

export function ModelPicker({
  selected,
  onSelect
}: {
  selected?: AgentModel
  onSelect: (model: AgentModel) => void
}): React.JSX.Element {
  const client = useQueryClient()
  const catalog = useQuery(catalogOptions)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AgentHarness | 'favorites'>(selected?.harness ?? 'claude')
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
  const rows = candidates.filter((m) =>
    `${m.label} ${m.id} ${m.provider} ${harnessLabels[m.harness]}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setFilter(selected?.harness ?? 'claude')
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="chat-model-picker"
          className="max-w-full gap-1 text-xs"
        >
          <span className="truncate">
            {selected ? `${selected.label} · ${harnessLabels[selected.harness]}` : 'Choose model'}
          </span>
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="chat-scrollbars w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-2xl p-0"
        aria-label="Choose model"
        data-testid="model-picker"
      >
        <div className="flex max-h-[min(520px,70vh)] min-h-72">
          <div
            className="flex w-20 shrink-0 flex-col gap-1 border-r p-2"
            aria-label="Filter harness"
          >
            {(['favorites', 'claude', 'codex', 'pi'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-label={value === 'favorites' ? 'Favorites' : harnessLabels[value]}
                aria-pressed={filter === value}
                className={`flex h-12 items-center justify-center rounded-lg px-1 text-xs ${filter === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
                onClick={() => {
                  setFilter(value)
                }}
              >
                {value === 'favorites' ? (
                  <Star aria-hidden="true" className="size-[22px]" />
                ) : (
                  <span
                    aria-hidden="true"
                    data-harness-icon={value}
                    className={`size-8 bg-current [mask-repeat:no-repeat] [mask-position:center] ${value === 'claude' ? 'text-[#D97757]' : ''}`}
                    style={{
                      maskImage: `url("${harnessIcons[value]}")`,
                      maskSize: value === 'claude' ? '28px' : value === 'codex' ? '22px' : '20px'
                    }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-3">
            <div className="mb-2 flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  aria-label="Search models"
                  placeholder="Search models…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
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
                <RefreshCw className={`size-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="model-picker-list min-h-0 flex-1 overflow-y-auto" aria-label="Models">
              {rows.map((m) => (
                <div
                  key={m.key}
                  className={`mb-1 flex items-center rounded-xl ${selected?.key === m.key ? 'bg-muted' : 'hover:bg-muted/50'}`}
                >
                  <button
                    type="button"
                    disabled={!m.available}
                    aria-pressed={selected?.key === m.key}
                    className="min-w-0 flex-1 px-3 py-3 text-left disabled:opacity-50"
                    onClick={() => {
                      onSelect(m)
                      setOpen(false)
                    }}
                  >
                    <span className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.label}
                      {selected?.key === m.key ? <Check className="size-3" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {harnessLabels[m.harness]} ·{' '}
                      {m.provider === 'configured' ? 'Native configuration' : m.provider}
                      {m.source === 'fallback' ? ' · Fallback' : ''}
                      {!m.available ? ' · Unavailable' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${favorites.some((f) => f.key === m.key) ? 'Unfavorite' : 'Favorite'} ${m.label} via ${harnessLabels[m.harness]}`}
                    aria-pressed={favorites.some((f) => f.key === m.key)}
                    className="mr-2 rounded-lg p-2 text-muted-foreground hover:bg-background"
                    onClick={() => {
                      if (!favorite.isPending)
                        favorite.mutate({
                          key: m.key,
                          value: !favorites.some((f) => f.key === m.key)
                        })
                    }}
                  >
                    <Star
                      className={`size-4 ${favorites.some((f) => f.key === m.key) ? 'fill-current text-foreground' : ''}`}
                    />
                  </button>
                </div>
              ))}
              {!rows.length ? (
                <p className="p-4 text-sm text-muted-foreground">
                  {catalog.isPending
                    ? 'Discovering native models…'
                    : filter === 'favorites'
                      ? 'Star a model to keep it here.'
                      : 'No matching models.'}
                </p>
              ) : null}
            </div>
            {Object.entries(catalog.data?.issues ?? {}).map(([harness, issue]) => (
              <details key={harness} className="mt-2 text-xs text-muted-foreground">
                <summary>{harnessLabels[harness as AgentHarness]} setup details</summary>
                <p className="max-h-20 overflow-auto break-words py-1">{issue}</p>
              </details>
            ))}
            {catalog.error || favorite.error || refresh.error ? (
              <p role="alert" className="text-xs text-destructive">
                {String(catalog.error ?? favorite.error ?? refresh.error)}
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
