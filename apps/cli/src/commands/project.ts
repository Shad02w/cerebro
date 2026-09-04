import {
  closeDb,
  createProjectFromDirectory,
  createProjectFromGitUrl,
  listProjects,
  removeProject
} from '@cerebro/core'
import { die, printJson } from '../output'
import { notifyInvalidate } from '../notify'

const PROJECT_USAGE = `
Usage: cerebro project <command>

Commands:
  list                          List all projects (JSON)
  create <git-url>              Clone a git URL and register it as a new project
  create --directory <path>     Add an existing folder (multi-root if it contains multiple git repos)
  delete <project-id>           Delete nested worktrees from disk, then unregister the project
  remove <project-id>           Unregister the project; leave directories on disk

Options:
  --help                        Show this help

All output is JSON on stdout. Errors are JSON on stderr with exit code 1.
`.trim()

function parseProjectId(raw: string | undefined, command: string): number {
  const projectId = raw ? Number(raw) : NaN
  if (!raw || !Number.isInteger(projectId) || projectId <= 0) {
    die(
      `project-id is required and must be a positive integer.\n\nUsage: cerebro project ${command} <id>`,
      'usage',
      2
    )
  }
  return projectId
}

function removeErrorCode(message: string): string {
  if (/not found/i.test(message)) return 'not_found'
  return 'internal'
}

export async function projectCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(PROJECT_USAGE + '\n')
    process.exit(0)
  }

  if (sub === 'list') {
    try {
      const result = await listProjects()
      printJson(result)
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 'list_failed')
    } finally {
      closeDb()
    }
    return
  }

  if (sub === 'create') {
    if (rest[0] === '--directory' || rest[0] === '-d') {
      const directory = rest[1]
      if (!directory) {
        die(
          '--directory <path> is required.\n\nUsage: cerebro project create --directory <path>',
          'usage',
          2
        )
      }
      try {
        const project = await createProjectFromDirectory(directory)
        printJson(project)
        notifyInvalidate()
      } catch (err) {
        die(err instanceof Error ? err.message : String(err), 'create_failed')
      } finally {
        closeDb()
      }
      return
    }

    const gitUrl = rest[0]
    if (!gitUrl) {
      die(
        'git-url or --directory <path> is required.\n\nUsage: cerebro project create <git-url>\n       cerebro project create --directory <path>',
        'usage',
        2
      )
    }
    try {
      const project = await createProjectFromGitUrl(gitUrl)
      printJson(project)
      notifyInvalidate()
    } catch (err) {
      die(err instanceof Error ? err.message : String(err), 'create_failed')
    } finally {
      closeDb()
    }
    return
  }

  if (sub === 'delete' || sub === 'remove') {
    const projectId = parseProjectId(rest[0], sub)
    const deleteFiles = sub === 'delete'
    try {
      const result = await removeProject(projectId, { deleteFiles })
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

  die(`Unknown project command: "${sub}".\n\nRun: cerebro project --help`, 'usage', 2)
}
