import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '../../../shared/types'

type LineProject = Pick<Project, 'name' | 'kind'>
type LineWorkspace = Pick<Workspace, 'kind' | 'branch' | 'repositoryId' | 'localPath'>

function branchName(workspace: LineWorkspace): string {
  const branch = workspace.branch.trim()
  return branch && branch !== '.' ? branch : ''
}

/** Workspace identity on a palette row. A git checkout is its branch; a folder is its name. */
export function sessionWorkspaceLine(project: LineProject, workspace: LineWorkspace): string {
  if (workspace.kind === 'root') return 'root'
  return branchName(workspace) || project.name
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
