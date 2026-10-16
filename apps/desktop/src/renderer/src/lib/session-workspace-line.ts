import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '../../../shared/types'

type LineProject = Pick<Project, 'name' | 'kind' | 'repositories'>
type LineWorkspace = Pick<Workspace, 'kind' | 'branch' | 'repositoryId' | 'localPath'>

function repoName(project: LineProject, workspace: LineWorkspace): string {
  const repo = project.repositories.find(
    (item) => Number(item.id) === Number(workspace.repositoryId)
  )
  const parts = workspace.localPath.split(/[/\\]/).filter((part) => part.length > 0)
  const fromPath = parts[parts.length - 1]
  return repo?.name || fromPath || 'repo'
}

function branchName(workspace: LineWorkspace): string {
  const branch = workspace.branch.trim()
  return branch && branch !== '.' ? branch : ''
}

/**
 * Workspace identity on a palette row. A single-root workspace is its branch.
 * A nested repo is `backend · main`. The multi-root root is `root`.
 */
export function sessionWorkspaceLine(project: LineProject, workspace: LineWorkspace): string {
  if (workspace.kind === 'root') return 'root'
  const branch = branchName(workspace)
  if (project.kind === 'multi-root' || project.repositories.length > 1) {
    const name = repoName(project, workspace)
    return branch ? `${name} · ${branch}` : name
  }
  return branch || project.name
}

export type SessionProjectGroup = {
  project: Project
  open: ChatSearchHit[]
  closed: ChatSearchHit[]
}

/** Sidebar project order. Within a project, hits keep search rank, Open then Closed. */
export function groupSessionsByProject(
  projects: Project[],
  hits: ChatSearchHit[]
): SessionProjectGroup[] {
  const projectByWorkspace = new Map<number, Project>()
  for (const project of projects) {
    for (const workspace of project.workspaces) projectByWorkspace.set(workspace.id, project)
  }
  const buckets = new Map<number, SessionProjectGroup>()
  for (const hit of hits) {
    const project = projectByWorkspace.get(hit.workspaceId)
    if (!project) continue
    const bucket = buckets.get(project.id) ?? { project, open: [], closed: [] }
    if (hit.open) bucket.open.push(hit)
    else bucket.closed.push(hit)
    buckets.set(project.id, bucket)
  }
  return projects.flatMap((project) => {
    const bucket = buckets.get(project.id)
    if (!bucket || bucket.open.length + bucket.closed.length === 0) return []
    return [bucket]
  })
}
