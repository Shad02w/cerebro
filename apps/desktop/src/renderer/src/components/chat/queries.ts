import type { AgentCatalog, AgentCommandList, AgentHarness, AgentSkillList } from '@cerebro/core'
export const harnessLabels: Record<AgentHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi'
}
let catalogRefreshedOnStartup = false
/** First read each app launch rediscovers models. Later reads reuse the host cache until Refresh. */
export const catalogOptions = {
  queryKey: ['agent-catalog'] as const,
  queryFn: async (): Promise<AgentCatalog> => {
    const refresh = !catalogRefreshedOnStartup
    const catalog = await window.cerebro.agentCatalog(refresh)
    catalogRefreshedOnStartup = true
    return catalog
  },
  staleTime: 60_000
}

type ComposerCatalogScope = {
  workspaceId: number
  /** The pane's repository in a multi-repo workspace; it picks the folder the harness reads. */
  repositoryId: number | null
  harness: AgentHarness | undefined
  provider: string | undefined
  /** Lists are fetched only once they are needed, never because a pane opened. */
  enabled: boolean
}
/**
 * Asking a harness for its skills or commands starts a native process, so every chat pane in a
 * folder shares one entry. Focus does not refetch; a stale entry refetches when it is needed again.
 */
const composerCatalog = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false
} as const
type ComposerCatalogKey<Kind extends string> = readonly [
  Kind,
  number,
  number | null,
  AgentHarness | undefined,
  string | undefined
]
type ComposerCatalogOptions<Kind extends string, T> = typeof composerCatalog & {
  queryKey: ComposerCatalogKey<Kind>
  enabled: boolean
  queryFn: () => Promise<T>
}

/** Skills the composer can mention for the selected harness in this folder. */
export function agentSkillOptions({
  workspaceId,
  repositoryId,
  harness,
  provider,
  enabled
}: ComposerCatalogScope): ComposerCatalogOptions<'agent-skills', AgentSkillList> {
  return {
    queryKey: ['agent-skills', workspaceId, repositoryId, harness, provider] as const,
    enabled: enabled && harness != null,
    queryFn: () => {
      if (!harness) throw new Error('Choose a model first.')
      return window.cerebro.agentSkills(workspaceId, repositoryId, harness)
    },
    ...composerCatalog
  }
}

/** Slash commands the composer can run for the selected harness in this folder. */
export function agentCommandOptions({
  workspaceId,
  repositoryId,
  harness,
  provider,
  enabled
}: ComposerCatalogScope): ComposerCatalogOptions<'agent-commands', AgentCommandList> {
  return {
    queryKey: ['agent-commands', workspaceId, repositoryId, harness, provider] as const,
    enabled: enabled && harness != null,
    queryFn: () => {
      if (!harness) throw new Error('Choose a model first.')
      return window.cerebro.agentCommands(workspaceId, repositoryId, harness)
    },
    ...composerCatalog
  }
}
