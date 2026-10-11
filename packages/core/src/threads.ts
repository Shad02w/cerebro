import type { AgentHarness, AgentSession, ChatItem } from './chat'
import type { WorkspaceStatus } from './types'

/**
 * Labels drawn on a thread row. Order is the sidebar group order: someone waiting
 * on the user comes first, finished work last.
 */
export const THREAD_ROW_STATUSES = [
  'request user',
  'agent working',
  'waiting for review',
  'in progress',
  'done'
] as const

export type ThreadRowStatus = (typeof THREAD_ROW_STATUSES)[number]

const THREAD_DESCRIPTION_MAX = 160

/** One saved agent session, without the transcript. Description is already stored text. */
export type ChatThread = {
  id: string
  workspaceId: number
  repositoryId: number | null
  title: string
  harness: AgentHarness
  /** Persisted session status, before the sidebar label. */
  status: AgentSession['status']
  attention?: AgentSession['attention']
  updatedAt: number
  /** Latest assistant line, otherwise the first prompt. Empty when neither is stored. */
  description: string
  /** Chat pane currently showing this session, when one is open. */
  paneId: number | null
}

export type ThreadRow = {
  id: string
  workspaceId: number
  repositoryId: number | null
  paneId: number | null
  harness: AgentHarness
  /** Project, nested repo when this is a multi-root child, and branch. */
  location: string
  title: string
  description: string
  status: ThreadRowStatus
  updatedAt: number
  open: boolean
}

/** Project fields the sidebar already has. Enough to name a thread's workspace. */
export type ThreadProjectRef = {
  name: string
  kind: 'clone' | 'directory' | 'multi-root'
  repositories: readonly { id: number; name: string }[]
  workspaces: readonly {
    id: number
    kind: 'default' | 'worktree' | 'root'
    branch: string
    status: WorkspaceStatus
    repositoryId: number
  }[]
}

type ThreadPlace = {
  projectName: string
  branch: string
  nestedRepo: string | null
  workspaceStatus: WorkspaceStatus
}

/**
 * Latest assistant line, otherwise the first user prompt. Whitespace is collapsed.
 * No model call: only text already on the session.
 */
export function threadDescription(items: readonly Pick<ChatItem, 'kind' | 'text'>[]): string {
  const assistant = [...items].reverse().find((item) => item.kind === 'text' && item.text.trim())
  const source = assistant ?? items.find((item) => item.kind === 'user' && item.text.trim())
  if (!source) return ''
  const flat = source.text.trim().replace(/\s+/g, ' ')
  if (flat.length <= THREAD_DESCRIPTION_MAX) return flat
  return `${flat.slice(0, THREAD_DESCRIPTION_MAX - 1).trimEnd()}…`
}

/**
 * Session signals win over the workspace, then the workspace's review state, then a
 * finished idle turn. Anything else is still in progress.
 */
export function threadRowStatus(input: {
  sessionStatus: AgentSession['status']
  attention?: AgentSession['attention']
  workspaceStatus: WorkspaceStatus
}): ThreadRowStatus {
  if (input.sessionStatus === 'waiting') return 'request user'
  if (input.sessionStatus === 'running') return 'agent working'
  if (input.workspaceStatus === 'ready_to_review') return 'waiting for review'
  const finished = input.sessionStatus === 'idle' && input.attention?.kind === 'finished'
  if (input.workspaceStatus === 'done' || finished) return 'done'
  return 'in progress'
}

/** `project / branch`, or `project / repo / branch` for a nested multi-root repository. */
export function threadLocation(place: {
  projectName: string
  branch: string
  nestedRepo?: string | null
}): string {
  const parts = [place.projectName.trim() || 'Project']
  const repo = place.nestedRepo?.trim()
  if (repo) parts.push(repo)
  const branch = place.branch.trim()
  if (branch && branch !== '.') parts.push(branch)
  return parts.join(' / ')
}

function threadPlace(
  projects: readonly ThreadProjectRef[],
  workspaceId: number
): ThreadPlace | null {
  for (const project of projects) {
    const workspace = project.workspaces.find((item) => item.id === workspaceId)
    if (!workspace) continue
    const multiRoot = project.kind === 'multi-root' || project.repositories.length > 1
    const nestedRepo =
      multiRoot && workspace.kind !== 'root'
        ? project.repositories
            .find((repo) => Number(repo.id) === Number(workspace.repositoryId))
            ?.name.trim() || null
        : null
    const rawBranch = workspace.branch.trim()
    const branch =
      workspace.kind === 'root' && (rawBranch === '' || rawBranch === '.') ? 'root' : rawBranch
    return {
      projectName: project.name.trim() || 'Project',
      branch,
      nestedRepo,
      workspaceStatus: workspace.status
    }
  }
  return null
}

/** Join saved sessions to the projects the sidebar already loaded. Unknown workspaces are omitted. */
export function sidebarThreadRows(
  projects: readonly ThreadProjectRef[],
  threads: readonly ChatThread[]
): ThreadRow[] {
  const rows: ThreadRow[] = []
  for (const thread of threads) {
    const place = threadPlace(projects, thread.workspaceId)
    if (!place) continue
    rows.push({
      id: thread.id,
      workspaceId: thread.workspaceId,
      repositoryId: thread.repositoryId,
      paneId: thread.paneId,
      harness: thread.harness,
      location: threadLocation(place),
      title: thread.title.trim() || 'Untitled thread',
      description: threadDescription([{ kind: 'text', text: thread.description }]),
      status: threadRowStatus({
        sessionStatus: thread.status,
        attention: thread.attention,
        workspaceStatus: place.workspaceStatus
      }),
      updatedAt: thread.updatedAt,
      open: thread.paneId != null
    })
  }
  return rows
}

/** Non-empty status groups, urgent first. Rows inside a group are newest first. */
export function groupThreadRows(
  rows: readonly ThreadRow[]
): { status: ThreadRowStatus; rows: ThreadRow[] }[] {
  const grouped = new Map<ThreadRowStatus, ThreadRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.status)
    if (list) list.push(row)
    else grouped.set(row.status, [row])
  }
  return THREAD_ROW_STATUSES.flatMap((status) => {
    const list = grouped.get(status)
    if (!list?.length) return []
    return [
      {
        status,
        rows: [...list].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      }
    ]
  })
}

export function filterThreadRows(rows: readonly ThreadRow[], query: string): ThreadRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) =>
    `${row.location} ${row.title} ${row.description} ${row.status}`.toLowerCase().includes(needle)
  )
}
