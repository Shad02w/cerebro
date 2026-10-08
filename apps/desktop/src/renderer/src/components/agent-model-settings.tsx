import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import {
  agentHarnesses,
  defaultModelForScope,
  rememberAgentModel,
  resolveNewAgentModel,
  type AgentHarness,
  type AgentModel
} from '@cerebro/core'
import type { AppSettings, AppSettingsPatch } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { catalogOptions, harnessLabels } from '@/components/chat/queries'

type AgentModelSettingsProps = {
  settings: AppSettings
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
}

type ModelGroup = {
  harness: AgentHarness
  provider: string
  label: string
  models: AgentModel[]
}

function modelGroups(models: AgentModel[]): ModelGroup[] {
  const groups: ModelGroup[] = []
  for (const harness of agentHarnesses) {
    const rows = models.filter((model) => model.harness === harness)
    const providers = [...new Set(rows.map((model) => model.provider))].sort((a, b) =>
      a.localeCompare(b)
    )
    for (const provider of providers) {
      const providerLabel = provider === 'configured' ? 'Default provider' : provider
      groups.push({
        harness,
        provider,
        label:
          providers.length > 1
            ? `${harnessLabels[harness]} · ${providerLabel}`
            : harnessLabels[harness],
        models: rows.filter((model) => model.provider === provider)
      })
    }
  }
  return groups
}

export function AgentModelSettings({
  settings,
  onUpdate
}: AgentModelSettingsProps): React.JSX.Element {
  const client = useQueryClient()
  const catalog = useQuery(catalogOptions)
  const refresh = useMutation({
    mutationFn: () => window.cerebro.agentCatalog(true),
    onSuccess: (data) => client.setQueryData(catalogOptions.queryKey, data)
  })
  const saving = useRef<Promise<void> | undefined>(undefined)
  const [localError, setLocalError] = useState<string | null>(null)
  const groups = modelGroups(catalog.data?.models ?? [])
  const current = resolveNewAgentModel(
    catalog.data?.models ?? [],
    settings.agentModelDefaults,
    settings.lastAgent
  )

  const persist = (model: AgentModel, makeCurrent: boolean): void => {
    const pending = saving.current ?? Promise.resolve()
    saving.current = pending.then(async () => {
      const latest = await window.cerebro.getSettings()
      try {
        if (makeCurrent) {
          const patch = rememberAgentModel(latest, model)
          if (patch) await onUpdate(patch)
        } else if (latest.agentModelDefaults[model.harness]?.[model.provider] !== model.key) {
          await onUpdate({
            agentModelDefaults: {
              ...latest.agentModelDefaults,
              [model.harness]: {
                ...latest.agentModelDefaults[model.harness],
                [model.provider]: model.key
              }
            }
          })
        }
        setLocalError(null)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Failed to save the default model.')
      }
    })
  }

  return (
    <div className="space-y-3" data-testid="settings-agent-models">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-[13px] font-medium">Default model</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            New agent panes open on the harness you used last, with the model chosen here. Cerebro
            refreshes the model list on startup. If a saved model is gone, that provider uses its
            current default.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="settings-refresh-models"
          onClick={(): void => {
            if (!refresh.isPending) refresh.mutate()
          }}
        >
          <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>
      {catalog.isPending ? (
        <p className="text-xs text-muted-foreground">Discovering models…</p>
      ) : groups.length ? (
        groups.map((group) => {
          const selected = defaultModelForScope(
            group.models,
            settings.agentModelDefaults,
            group.harness,
            group.provider
          )
          const value = selected?.key ?? group.models[0]?.key
          if (!value) return null
          const makeCurrent =
            current?.harness === group.harness && current.provider === group.provider
          return (
            <div
              key={`${group.harness}:${group.provider}`}
              className="flex items-center justify-between gap-6"
            >
              <Label className="text-[13px] font-medium">{group.label}</Label>
              <Select
                items={group.models.map((model) => ({
                  value: model.key,
                  label: `${model.label}${model.available ? '' : ' (unavailable)'}`
                }))}
                value={value}
                onValueChange={(key): void => {
                  const model = group.models.find((entry) => entry.key === key)
                  if (model) persist(model, makeCurrent)
                }}
              >
                <SelectTrigger
                  className="h-7 w-64"
                  data-testid="settings-agent-model"
                  data-harness={group.harness}
                  data-provider={group.provider}
                  aria-label={`${group.label} default model`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {group.models.map((model) => (
                    <SelectItem
                      key={model.key}
                      value={model.key}
                      disabled={!model.available && model.key !== value}
                    >
                      {model.label}
                      {!model.available ? ' (unavailable)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })
      ) : (
        <p className="text-xs text-muted-foreground">
          No models discovered. Install a harness, then refresh.
        </p>
      )}
      {localError || catalog.error || refresh.error ? (
        <p role="alert" className="text-xs text-destructive">
          {localError ??
            (catalog.error instanceof Error
              ? catalog.error.message
              : refresh.error instanceof Error
                ? refresh.error.message
                : 'Could not refresh models.')}
        </p>
      ) : null}
    </div>
  )
}
