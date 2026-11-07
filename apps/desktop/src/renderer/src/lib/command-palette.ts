import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '../../../shared/types'
import { isPlainDirectoryProject } from './workspace-status'

/** Filter chips in display (and Tab) order. "All" lists groups in the same order. */
export const PALETTE_FILTERS = ['all', 'project', 'workspace', 'session', 'history'] as const
export type PaletteFilter = (typeof PALETTE_FILTERS)[number]
export type PaletteGroupKey = Exclude<PaletteFilter, 'all'>

export const PALETTE_GROUP_LABELS: Record<PaletteGroupKey, string> = {
  project: 'Projects',
  workspace: 'Workspaces',
  session: 'Sessions',
  history: 'History'
}

/** Rows per group under "All". A single-group filter lists every match. */
export const PALETTE_GROUP_CAP = 4

export type WorkspaceRowKind = 'default' | 'worktree' | 'directory'

export type PaletteRow =
  | { type: 'project'; key: string; project: Project }
  | {
      type: 'workspace'
      key: string
      project: Project
      workspace: Workspace
      label: string
      kind: WorkspaceRowKind
    }
  | { type: 'session' | 'history'; key: string; hit: ChatSearchHit }

export type PaletteGroup = {
  key: PaletteGroupKey
  label: string
  rows: PaletteRow[]
  /** Matches in this group, including rows past the cap. */
  total: number
}

export function defaultWorkspaceLabel(project: Project, workspace: Workspace): string {
  if (workspace.kind === 'root') return 'root'
  if (!workspace.branch || workspace.branch === '.') return project.name
  return workspace.branch
}

/** The label a workspace row shows in the sidebar. */
export function workspaceRowLabel(project: Project, workspace: Workspace): string {
  const custom = workspace.displayName?.trim()
  return custom || defaultWorkspaceLabel(project, workspace)
}

/** A project row in the sidebar. Plain folders and multi-root folders are workspace rows. */
export function isPaletteProject(project: Project): boolean {
  return project.kind !== 'multi-root' && !isPlainDirectoryProject(project)
}

function workspaceKind(project: Project, workspace: Workspace): WorkspaceRowKind {
  if (!isPaletteProject(project) || workspace.kind === 'root') return 'directory'
  return workspace.kind === 'worktree' ? 'worktree' : 'default'
}

function paletteWorkspaceLabel(project: Project, workspace: Workspace): string {
  const label = workspaceRowLabel(project, workspace)
  return workspace.kind === 'root' && label === 'root' ? project.name : label
}

/** Prefix matches first, then substring matches; both keep sidebar order. */
function ranked<T>(items: T[], query: string, haystacks: (item: T) => string[]): T[] {
  if (!query) return items
  const prefix: T[] = []
  const inside: T[] = []
  for (const item of items) {
    const texts = haystacks(item).map((text) => text.toLowerCase())
    if (texts.some((text) => text.startsWith(query))) prefix.push(item)
    else if (texts.some((text) => text.includes(query))) inside.push(item)
  }
  return [...prefix, ...inside]
}

export function searchPaletteProjects(projects: Project[], query: string): PaletteRow[] {
  const q = query.trim().toLowerCase()
  return ranked(projects.filter(isPaletteProject), q, (project) => [project.name]).map(
    (project) => ({ type: 'project', key: `project:${project.id}`, project })
  )
}

export function searchPaletteWorkspaces(projects: Project[], query: string): PaletteRow[] {
  const q = query.trim().toLowerCase()
  const entries = projects.flatMap((project) =>
    project.workspaces.map((workspace) => ({ project, workspace }))
  )
  return ranked(entries, q, ({ project, workspace }) =>
    [
      paletteWorkspaceLabel(project, workspace),
      defaultWorkspaceLabel(project, workspace),
      workspace.kind === 'root' ? '' : workspace.branch,
      project.name
    ].filter(Boolean)
  ).map(({ project, workspace }) => ({
    type: 'workspace',
    key: `workspace:${workspace.id}`,
    project,
    workspace,
    label: paletteWorkspaceLabel(project, workspace),
    kind: workspaceKind(project, workspace)
  }))
}

/**
 * Groups for the palette. Order is Projects, Workspaces, Sessions, History.
 * A workspace scope keeps only that workspace's sessions and history.
 */
export function buildPaletteGroups({
  projects,
  hits,
  query,
  filter,
  scopeWorkspaceId
}: {
  projects: Project[]
  hits: ChatSearchHit[]
  query: string
  filter: PaletteFilter
  scopeWorkspaceId: number | null
}): PaletteGroup[] {
  const scoped = scopeWorkspaceId != null
  const sessions: PaletteRow[] = []
  const history: PaletteRow[] = []
  for (const hit of hits) {
    if (scoped && hit.workspaceId !== scopeWorkspaceId) continue
    if (hit.open) sessions.push({ type: 'session', key: `session:${hit.sessionId}`, hit })
    else history.push({ type: 'history', key: `history:${hit.sessionId}`, hit })
  }
  const all: Record<PaletteGroupKey, PaletteRow[]> = {
    project: scoped ? [] : searchPaletteProjects(projects, query),
    workspace: scoped ? [] : searchPaletteWorkspaces(projects, query),
    session: sessions,
    history
  }
  const keys = filter === 'all' ? (PALETTE_FILTERS.slice(1) as PaletteGroupKey[]) : [filter]
  return keys.flatMap((key) => {
    const rows = all[key]
    if (!rows.length) return []
    return [
      {
        key,
        label: PALETTE_GROUP_LABELS[key],
        rows: filter === 'all' ? rows.slice(0, PALETTE_GROUP_CAP) : rows,
        total: rows.length
      }
    ]
  })
}

export function nextPaletteFilter(filter: PaletteFilter, step: 1 | -1): PaletteFilter {
  const index = PALETTE_FILTERS.indexOf(filter)
  const count = PALETTE_FILTERS.length
  return PALETTE_FILTERS[(index + step + count) % count]
}

/** Splits `text` around the first case-insensitive match of `query`. */
export function highlightParts(
  text: string,
  query: string
): { before: string; match: string; after: string } | null {
  const q = query.trim()
  if (!q) return null
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return null
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + q.length),
    after: text.slice(at + q.length)
  }
}
