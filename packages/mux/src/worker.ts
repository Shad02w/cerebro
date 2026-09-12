import type { PaneNode } from '@cerebro/core'
import type { RequestParams } from './protocol'
import { parentPort } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import {
  getDb,
  getSettings,
  listProjects,
  createProjectFromDirectory,
  createProjectFromGitUrl,
  createWorkspaceFromBranch,
  removeWorkspace,
  removeProject,
  setActiveWorkspace,
  listWorkspaceChanges,
  getWorkspaceFileDiff
} from '@cerebro/core'
import {
  loadLayout,
  layoutCommand,
  getLayout,
  removeWorkspaceLayout,
  setPaneState,
  measure
} from './layout'
import { TerminalFiles, type Checkpoint } from './storage'

const port = parentPort!
const files = new TerminalFiles()
const callbacks = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>()
let initialized = false
async function handle(method: string, p: RequestParams): Promise<unknown> {
  if (!initialized) {
    const layout = loadLayout()
    const ids = (node: PaneNode): number[] =>
      node.type === 'pane' ? [node.id] : [...ids(node.first), ...ids(node.second)]
    files.prune(
      Object.values(layout.workspaces).flatMap((workspace) =>
        workspace.tabs.flatMap((tab) => ids(tab.root))
      )
    )
    initialized = true
    const db = getDb()
    db.exec(
      'CREATE TABLE IF NOT EXISTS mux_operations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    )
    const columns = db.prepare('PRAGMA table_info(mux_operations)').all() as Array<{ name: string }>
    for (const name of ['reserved_path', 'workspace_id'])
      if (!columns.some((column) => column.name === name))
        db.exec(
          `ALTER TABLE mux_operations ADD COLUMN ${name} ${name === 'workspace_id' ? 'INTEGER' : 'TEXT'}`
        )
    const pending = db
      .prepare(
        'SELECT id, workspace_id FROM mux_operations WHERE result IS NULL AND workspace_id IS NOT NULL'
      )
      .all() as Array<{ id: string; workspace_id: number }>
    if (pending.length) {
      const { projects } = await listProjects()
      for (const operation of pending) {
        const workspace = projects
          .flatMap((project) => project.workspaces)
          .find((workspace) => workspace.id === operation.workspace_id)
        if (workspace)
          db.prepare('UPDATE mux_operations SET result=? WHERE id=?').run(
            JSON.stringify({ result: workspace }),
            operation.id
          )
      }
    }
  }
  switch (method) {
    case 'operation.begin': {
      const db = getDb()
      const existing = db
        .prepare('SELECT fingerprint,result,reserved_path FROM mux_operations WHERE id=?')
        .get(p.id) as
        { fingerprint: string; result: string | null; reserved_path: string | null } | undefined
      if (existing) {
        if (existing.fingerprint !== p.fingerprint)
          throw Object.assign(new Error('Operation ID already belongs to another request.'), {
            code: 'conflict'
          })
        if (existing.result === null)
          throw Object.assign(
            new Error(
              `Operation was interrupted; inspect current workspaces/layout${existing.reserved_path ? ` and reserved path ${existing.reserved_path}` : ''} before starting a new operation.`
            ),
            { code: 'conflict' }
          )
        return { cached: JSON.parse(existing.result) }
      }
      db.prepare('INSERT INTO mux_operations (id,fingerprint) VALUES (?,?)').run(
        p.id,
        p.fingerprint
      )
      return null
    }
    case 'operation.finish': {
      const db = getDb()
      db.prepare('UPDATE mux_operations SET result=? WHERE id=?').run(JSON.stringify(p.reply), p.id)
      db.exec(
        'DELETE FROM mux_operations WHERE result IS NOT NULL AND id NOT IN (SELECT id FROM mux_operations ORDER BY created_at DESC, rowid DESC LIMIT 1024)'
      )
      return null
    }
    case 'changes.list': {
      const changes = await listWorkspaceChanges(p.workspaceId)
      if (p.repositoryId !== undefined && p.repositoryId !== null)
        changes.groups = changes.groups.filter((group) => group.repositoryId === p.repositoryId)
      return changes
    }
    case 'changes.file':
      return getWorkspaceFileDiff(p.workspaceId, Number(p.repositoryId), p.file)
    case 'layout.get':
      return getLayout()
    case 'layout.command':
      return layoutCommand(p)
    case 'layout.measure':
      measure(p.paneId, p.width, p.height)
      return null
    case 'pane.state':
      return setPaneState(p.workspaceId, p.paneId, p.state)
    case 'layout.remove':
      removeWorkspaceLayout(p.workspaceId)
      return getLayout()
    case 'files.load':
      return files.load(p.paneId)
    case 'files.checkpoint':
      files.checkpoint(p as unknown as Checkpoint)
      return null
    case 'files.append':
      files.append(p.paneId, p.event)
      return null
    case 'files.flush':
      files.flush()
      return null
    case 'files.remove':
      files.remove(p.paneId)
      return null
    case 'registry': {
      const git = p.provider
        ? (args: string[], cwd?: string): Promise<string> =>
            new Promise((resolve, reject) => {
              const id = randomUUID()
              callbacks.set(id, { resolve, reject })
              port.postMessage({ git: true, id, operationId: p.operationId, args, cwd })
            })
        : undefined
      switch (p.action) {
        case 'list':
          return listProjects()
        case 'select':
          return setActiveWorkspace(p.workspaceId)
        case 'project.createDirectory':
          return createProjectFromDirectory(p.directory)
        case 'project.create':
          return createProjectFromGitUrl(p.gitUrl, { git })
        case 'workspace.create':
          return createWorkspaceFromBranch(p.projectId, p.branch, {
            from: p.from,
            git,
            onPrepared: (path) => {
              getDb()
                .prepare('UPDATE mux_operations SET reserved_path=? WHERE id=?')
                .run(path, p.operationId)
            },
            onCommitted: (id) => {
              getDb()
                .prepare('UPDATE mux_operations SET workspace_id=? WHERE id=?')
                .run(id, p.operationId)
            }
          })
        case 'workspace.remove':
          return removeWorkspace(p.workspaceId, { deleteFiles: p.deleteFiles })
        case 'project.remove':
          return removeProject(p.projectId, { deleteFiles: p.deleteFiles })
      }
      throw new Error('Unknown registry action.')
    }
    case 'terminal.theme':
      return getSettings().terminalTheme
    case 'context': {
      const { projects } = await listProjects()
      const project = projects.find((project) =>
        project.workspaces.some((workspace) => workspace.id === p.workspaceId)
      )
      const workspace = project?.workspaces.find((workspace) => workspace.id === p.workspaceId)
      if (!project || !workspace)
        throw Object.assign(new Error('Workspace not found.'), { code: 'not_found' })
      const repositoryId =
        p.repositoryId ?? (workspace.kind === 'root' ? null : workspace.repositoryId)
      const repository = project.repositories.find((repo) => repo.id === repositoryId)
      if (
        repositoryId !== null &&
        (!repository || (workspace.kind !== 'root' && workspace.repositoryId !== repositoryId))
      )
        throw Object.assign(new Error('Repository does not belong to this workspace.'), {
          code: 'not_found'
        })
      return {
        projectId: project.id,
        workspaceId: workspace.id,
        repositoryId,
        cwd: workspace.kind === 'root' && repository ? repository.localPath : workspace.localPath
      }
    }
    default:
      throw new Error('Unknown storage method.')
  }
}
port.on('message', (message) => {
  if (message.gitReply) {
    const callback = callbacks.get(message.gitReply)
    callbacks.delete(message.gitReply)
    if (message.error) callback?.reject(new Error(message.error))
    else callback?.resolve(message.result)
    return
  }
  void handle(message.method, message.params).then(
    (result) => port.postMessage({ id: message.id, result }),
    (error) =>
      port.postMessage({
        id: message.id,
        error: {
          code:
            error.code ??
            (/not found/i.test(error.message)
              ? 'not_found'
              : /already exists|can't be deleted|not supported|only be created/i.test(error.message)
                ? 'conflict'
                : 'internal'),
          message: error.message
        }
      })
  )
})
