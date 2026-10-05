import { parseWorkspaceStatus } from '@cerebro/core'
import { MuxError } from '@cerebro/mux'
import {
  createWorkspaceFromBranch,
  getWorkspaceLocalPath,
  listProjects,
  removeWorkspace,
  renameWorkspace,
  setWorkspaceStatus
} from '../registry'
import { die, printJson } from '../output'

const WORKSPACE_USAGE = `
Usage: cerebro workspace <command>

Commands:
  list [--project <id>]                  List workspaces, optionally filtered by project id
  create --project <id> --branch <name> [--from <base>] [--focus]
                                         Create a worktree for an existing branch, or a new
                                         branch based on --from. Leaves the current workspace
                                         selected unless --focus is set. The desktop app still
                                         selects a workspace it creates.
  path <workspace-id>                    Print the local filesystem path for a workspace
  status <workspace-id> [status]         Show or set a workspace row status.
                                         Status: todo, in-progress, ready-to-review, done
  rename <workspace-id> --name <name>    Set the sidebar label for a workspace
  rename <workspace-id> --reset          Restore the default directory or branch label
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
  if (/default workspace/i.test(message) || /root workspace/i.test(message)) return 'conflict'
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
    }
    return
  }

  if (sub === 'create') {
    const flags = parseFlags(rest)
    const projectId = typeof flags['project'] === 'string' ? Number(flags['project']) : null
    const branch = typeof flags['branch'] === 'string' ? flags['branch'] : null
    const fromFlag = flags['from']
    if (fromFlag === true) {
      die('--from <base> requires a branch name', 'usage', 2)
    }
    const from = typeof fromFlag === 'string' ? fromFlag : null

    if (!projectId || !Number.isInteger(projectId) || projectId <= 0) {
      die('--project <id> is required and must be a positive integer', 'usage', 2)
    }
    if (!branch) {
      die('--branch <name> is required', 'usage', 2)
    }

    try {
      const workspace = await createWorkspaceFromBranch(projectId, branch, {
        ...(from ? { from } : {}),
        focus: flags.focus != null
      })
      printJson(workspace)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Distinguish conflict (workspace already exists) from other failures.
      const code = msg.toLowerCase().includes('already exists') ? 'conflict' : 'create_failed'
      die(msg, code)
    }
    return
  }

  if (sub === 'rename') {
    const workspaceId = parseWorkspaceId(rest[0], 'rename')
    const flags = parseFlags(rest.slice(1))
    const reset = flags.reset === true
    const nameFlag = flags.name
    if (nameFlag === true) die('--name requires a value', 'usage', 2)
    if (reset && nameFlag) die('Use either --name or --reset.', 'usage', 2)
    if (!reset && typeof nameFlag !== 'string') {
      die(
        '--name <name> or --reset is required.\n\nUsage: cerebro workspace rename <id> --name <name>',
        'usage',
        2
      )
    }
    const displayName = reset || typeof nameFlag !== 'string' ? null : nameFlag
    try {
      const result = await renameWorkspace(workspaceId, displayName)
      const workspace = result.projects
        .flatMap((project) => project.workspaces)
        .find((item) => item.id === workspaceId)
      if (!workspace) die('Workspace not found.', 'not_found')
      printJson(workspace)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const reported =
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : ''
      const code =
        reported === 'not_found' || /not found/i.test(msg)
          ? 'not_found'
          : reported === 'usage' || /enter a name|line breaks|characters or fewer/i.test(msg)
            ? 'usage'
            : reported === 'unavailable'
              ? 'unavailable'
              : 'internal'
      die(msg, code, code === 'usage' ? 2 : 1)
    }
    return
  }

  if (sub === 'path') {
    const workspaceId = parseWorkspaceId(rest[0], 'path')

    try {
      const localPath = await getWorkspaceLocalPath(workspaceId)
      printJson({ id: workspaceId, localPath })
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 'not_found')
    }
    return
  }

  if (sub === 'status') {
    if (rest[0] === '--help' || rest[0] === '-h') {
      process.stdout.write(WORKSPACE_USAGE + '\n')
      process.exit(0)
    }
    if (rest.length > 2) {
      die(
        'Too many arguments.\n\nUsage: cerebro workspace status <workspace-id> [status]',
        'usage',
        2
      )
    }
    const workspaceId = parseWorkspaceId(rest[0], 'status')
    const requested = rest[1]
    if (requested !== undefined && parseWorkspaceStatus(requested) == null) {
      die(
        `Unknown status "${requested}". Use todo, in-progress, ready-to-review, or done.`,
        'usage',
        2
      )
    }
    try {
      if (requested === undefined) {
        const result = await listProjects()
        const workspace = result.projects
          .flatMap((project) => project.workspaces)
          .find((item) => item.id === workspaceId)
        if (!workspace) die('Workspace not found.', 'not_found')
        printJson(workspace)
        return
      }
      const status = parseWorkspaceStatus(requested)
      if (!status) die(`Unknown status "${requested}".`, 'usage', 2)
      printJson(await setWorkspaceStatus(workspaceId, status))
    } catch (err) {
      if (err instanceof MuxError) {
        die(err.message, err.code, err.code === 'usage' ? 2 : 1)
      }
      const msg = err instanceof Error ? err.message : String(err)
      die(msg, /not found/i.test(msg) ? 'not_found' : 'internal')
    }
    return
  }

  if (sub === 'delete' || sub === 'remove') {
    const workspaceId = parseWorkspaceId(rest[0], sub)
    const deleteFiles = sub === 'delete'
    try {
      const result = await removeWorkspace(workspaceId, { deleteFiles })
      printJson(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      die(msg, removeErrorCode(msg))
    }
    return
  }

  die(`Unknown workspace command: "${sub}".\n\nRun: cerebro workspace --help`, 'usage', 2)
}
