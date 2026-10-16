import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportDiagnostics } from '@cerebro/mux'
import { die, printJson } from '../output'

declare const __CEREBRO_CLI_VERSION__: string | undefined

const USAGE = `Usage: cerebro diagnostics export [--output <file.zip|directory>]

Writes a support bundle: mux/server.log, system and version info, and counts of projects,
workspaces, tabs and panes. It never includes terminal output, chat sessions, names, file
contents, or credentials, and it does not start the mux. Default location: ~/Downloads.`

/** Where a bundle goes when --output is omitted: somewhere a person will find it. */
function defaultDirectory(): string {
  const downloads = join(homedir(), 'Downloads')
  return existsSync(downloads) ? downloads : tmpdir()
}

export async function diagnosticsCommand(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE + '\n')
    return
  }
  if (args[0] !== 'export') die(USAGE, 'usage', 2)
  let output: string | undefined
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--output' && args[index + 1]) output = args[++index]
    else if (args[index].startsWith('--output=')) output = args[index].slice('--output='.length)
    else die(`Unknown option: ${args[index]}\n${USAGE}`, 'usage', 2)
  }
  if (output === '') die('--output needs a path.', 'usage', 2)
  try {
    printJson(
      await exportDiagnostics({
        outputPath: output ?? defaultDirectory(),
        app: {
          source: 'cli',
          version: typeof __CEREBRO_CLI_VERSION__ !== 'undefined' ? __CEREBRO_CLI_VERSION__ : null
        }
      })
    )
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 'internal')
  }
}
