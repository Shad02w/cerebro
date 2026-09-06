import type {
  ChangedFile,
  ChangedFileStatus,
  FileDiffContents,
  RepoChangeGroup,
  WorkspaceChanges,
  WorkspaceKind
} from './types'
import { getDb } from './db'
import { listChangedFiles, readChangedFileDiff } from './git'

type ChangeRepo = {
  workspaceId: number
  repositoryId: number
  repositoryName: string
  localPath: string
}

const CHANGED_FILE_STATUSES: ReadonlySet<ChangedFileStatus> = new Set([
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked'
])

export function isChangedFileStatus(value: unknown): value is ChangedFileStatus {
  return typeof value === 'string' && CHANGED_FILE_STATUSES.has(value as ChangedFileStatus)
}

function getChangeRepos(workspaceId: number): ChangeRepo[] {
  const db = getDb()
  const workspace = db
    .prepare(
      `
SELECT w.id, w.kind, w.project_id, w.repository_id, w.local_path, r.name AS repository_name
FROM workspaces w
JOIN repositories r ON r.id = w.repository_id
WHERE w.id = ?
      `
    )
    .get(workspaceId) as
    | {
        id: number
        kind: WorkspaceKind
        project_id: number
        repository_id: number
        local_path: string
        repository_name: string
      }
    | undefined

  if (!workspace) throw new Error('Workspace not found.')

  if (workspace.kind !== 'root') {
    return [
      {
        workspaceId: workspace.id,
        repositoryId: workspace.repository_id,
        repositoryName: workspace.repository_name,
        localPath: workspace.local_path
      }
    ]
  }

  const children = db
    .prepare(
      `
SELECT w.id, w.repository_id, w.local_path, r.name AS repository_name
FROM workspaces w
JOIN repositories r ON r.id = w.repository_id
WHERE w.project_id = ? AND w.kind != 'root'
ORDER BY r.name COLLATE NOCASE ASC, w.id ASC
      `
    )
    .all(workspace.project_id) as Array<{
    id: number
    repository_id: number
    local_path: string
    repository_name: string
  }>

  return children.map((row) => ({
    workspaceId: row.id,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    localPath: row.local_path
  }))
}

async function listRepoFiles(localPath: string): Promise<ChangedFile[]> {
  try {
    return await listChangedFiles(localPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/not a git repository/i.test(message)) return []
    throw error
  }
}

export async function listWorkspaceChanges(workspaceId: number): Promise<WorkspaceChanges> {
  const repos = getChangeRepos(workspaceId)
  const groups: RepoChangeGroup[] = []
  for (const repo of repos) {
    groups.push({
      repositoryId: repo.repositoryId,
      repositoryName: repo.repositoryName,
      workspaceId: repo.workspaceId,
      files: await listRepoFiles(repo.localPath)
    })
  }
  return { workspaceId, groups }
}

export async function getWorkspaceFileDiff(
  workspaceId: number,
  repositoryId: number,
  file: ChangedFile
): Promise<FileDiffContents> {
  const repo = getChangeRepos(workspaceId).find((item) => item.repositoryId === repositoryId)
  if (!repo) throw new Error('Repository not found in this workspace.')
  const diff = await readChangedFileDiff(repo.localPath, file)
  return { ...diff, repositoryId }
}
