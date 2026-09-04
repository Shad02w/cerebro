import {
  closeDb,
  createWorkspaceFromBranch,
  getWorkspaceLocalPath,
  listProjects,
  removeWorkspace
} from '@cerebro/core'
import { die, printJson } from '../output'
import { notifyInvalidate } from '../notify'

const WORKSPACE_USAGE = `
Usage: cerebro workspace <command>

Commands:
  list [--project <id>]                  List workspaces, optionally filtered by project id
  create --project <id> --branch <name>  Create a new git worktree workspace
  path <workspace-id>                    Print the local filesystem path for a workspace
  delete <workspace-id>                  Delete a worktree workspace from disk and unregister it
  remove <workspace-id>                  Unregister a worktree workspace; leave the directory

Options:
  --help                                 Show this help

All output is JSON on stdout. Errors are JSON on stderr with exit code 1.
`.trim()

function parseFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    }
  }
  return flags
}

function parseWorkspaceId(raw: string | undefined, command: string): number {
  const workspaceId = raw ? Number(raw) : NaN
  if (!raw || !Number.isInteger(workspaceId) || workspaceId <= 0) {
    die(
      `workspace-id is required and must be a positive integer.\n\nUsage: cerebro workspace ${command} <id>`,
      'usage',
      2
    )
  }
  return workspaceId
}

function removeErrorCode(message: string): string {
  if (/not found/i.test(message)) return 'not_found'
  if (/default workspace/i.test(message)) return 'conflict'
  return 'internal'
}

export async function workspaceCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(WORKSPACE_USAGE + '\n')
    process.exit(0)
  }

  if (sub === 'list') {
    const flags = parseFlags(rest)
    const projectFilter = typeof flags['project'] === 'string' ? Number(flags['project']) : null

    try {
      const result = await listProjects()
      const filtered =
        projectFilter != null
          ? result.projects.filter((p) => p.id === projectFilter)
          : result.projects

      const workspaces = filtered.flatMap((p) =>
        p.workspaces.map((w) => ({ ...w, projectName: p.name }))
      )
      printJson({ workspaces, activeWorkspaceId: result.activeWorkspaceId })
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 'list_failed')
    } finally {
      closeDb()
    }
    return
  }

  if (sub === 'create') {
    const flags = parseFlags(rest)
    const projectId = typeof flags['project'] === 'string' ? Number(flags['project']) : null
    const branch = typeof flags['branch'] === 'string' ? flags['branch'] : null

    if (!projectId || !Number.isInteger(projectId) || projectId <= 0) {
      die('--project <id> is required and must be a positive integer', 'usage', 2)
    }
    if (!branch) {
      die('--branch <name> is required', 'usage', 2)
    }

    try {
      const workspace = await createWorkspaceFromBranch(projectId, branch)
      printJson(workspace)
      notifyInvalidate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Distinguish conflict (workspace already exists) from other failures.
      const code = msg.toLowerCase().includes('already exists') ? 'conflict' : 'create_failed'
      die(msg, code)
    } finally {
      closeDb()
    }
    return
  }

  if (sub === 'path') {
    const workspaceId = parseWorkspaceId(rest[0], 'path')

    try {
      const localPath = getWorkspaceLocalPath(workspaceId)
      printJson({ id: workspaceId, localPath })
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 'not_found')
    } finally {
      closeDb()
    }
    return
  }

  if (sub === 'delete' || sub === 'remove') {
    const workspaceId = parseWorkspaceId(rest[0], sub)
    const deleteFiles = sub === 'delete'
    try {
      const result = await removeWorkspace(workspaceId, { deleteFiles })
      printJson(result)
      notifyInvalidate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      die(msg, removeErrorCode(msg))
    } finally {
      closeDb()
    }
    return
  }

  die(`Unknown workspace command: "${sub}".\n\nRun: cerebro workspace --help`, 'usage', 2)
}
