#!/usr/bin/env node --no-warnings
/**
 * cerebro CLI — project and workspace management for humans and coding agents.
 *
 * All output is JSON on stdout. Errors are JSON on stderr (exit 1).
 * Bad usage exits with code 2.
 *
 * Quick reference:
 *   cerebro project list
 *   cerebro project create <git-url>
 *   cerebro project create --directory <path>
 *   cerebro workspace list [--project <id>]
 *   cerebro workspace create --project <id> --branch <name>
 *   cerebro workspace create --project <id> --branch <name> --from <base>
 *   cerebro workspace path <id>
 *
 * Run any command with --help for details.
 */

import { layoutCommand } from './commands/layout'
import { projectCommand } from './commands/project'
import { workspaceCommand } from './commands/workspace'

const USAGE = `
Usage: cerebro <command> [options]

Commands:
  project    Manage projects (cloned git repositories or opened folders)
  workspace  Manage workspaces (default branch + git worktrees)
  tab        Manage live workspace tabs (desktop app required)
  pane       Manage BSP panes inside tabs (desktop app required)

Options:
  --version  Print version
  --help     Show this help

Run 'cerebro <command> --help' for command-specific help.

All output is JSON on stdout. Errors are JSON on stderr with exit code 1.
`.trim()

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE + '\n')
    process.exit(0)
  }

  if (command === '--version') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version } = require('../../package.json') as { version: string }
    process.stdout.write(version + '\n')
    process.exit(0)
  }

  if (command === 'tab' || command === 'pane') {
    await layoutCommand(command, rest)
    return
  }

  if (command === 'project') {
    await projectCommand(rest)
    return
  }

  if (command === 'workspace') {
    await workspaceCommand(rest)
    return
  }

  process.stderr.write(
    JSON.stringify(
      { error: true, code: 'usage', message: `Unknown command: "${command}". Run: cerebro --help` },
      null,
      2
    ) + '\n'
  )
  process.exit(2)
}

main().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify(
      {
        error: true,
        code: 'internal',
        message: err instanceof Error ? err.message : String(err)
      },
      null,
      2
    ) + '\n'
  )
  process.exit(1)
})
