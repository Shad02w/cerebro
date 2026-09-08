import { parseArgs } from 'node:util'
import { createConnection } from 'node:net'
import {
  getSocketPath,
  type LayoutCommand,
  type PaneKind,
  type SplitDirection
} from '@cerebro/core'
import { die, printJson } from '../output'

const HELP = `Usage:
  cerebro tab list --workspace <id>
  cerebro tab create --workspace <id> [--kind terminal|changes]
  cerebro tab focus|close --workspace <id> --tab <id>
  cerebro tab reorder --workspace <id> --tab <id> --index <zero-based-index>
  cerebro pane list --workspace <id> [--tab <id>]
  cerebro pane split --workspace <id> [--tab <id>] [--pane <id>]
                     [--kind terminal|changes] [--direction auto|right|down]
  cerebro pane focus|close --workspace <id> --pane <id>
  cerebro pane resize --workspace <id> --tab <id> --split <id> --ratio <0.1-0.9>

Tab and pane commands require the running desktop app. IDs are stable for its lifetime.
Pane split defaults to the active pane; pane list defaults to the active tab.
Auto splits use the pane's displayed dimensions (right when wide, down when tall).
Workspace defaults to CEREBRO_WORKSPACE_ID inside a workspace terminal.
Output is JSON; errors exit 1 (usage errors exit 2).`

function numeric(value: string | undefined, name: string, integer = true): number | undefined {
  if (value === undefined) return undefined
  const result = Number(value)
  if (
    !value.trim() ||
    !Number.isFinite(result) ||
    (integer && (!Number.isSafeInteger(result) || result < (name === 'index' ? 0 : 1)))
  )
    die(`Invalid ${name}.`, 'usage', 2)
  return result
}

export async function layoutCommand(target: 'tab' | 'pane', args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP + '\n')
    return
  }
  const [action, ...rest] = args
  const allowed =
    target === 'tab'
      ? ['list', 'create', 'focus', 'close', 'reorder']
      : ['list', 'split', 'focus', 'close', 'resize']
  if (!allowed.includes(action)) die(`Unknown ${target} action: ${action}`, 'usage', 2)
  let values: Record<string, string | undefined>
  try {
    values = parseArgs({
      args: rest,
      strict: true,
      options: Object.fromEntries(
        ['workspace', 'tab', 'pane', 'kind', 'direction', 'split', 'ratio', 'index'].map((key) => [
          key,
          { type: 'string' as const }
        ])
      )
    }).values as Record<string, string | undefined>
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 'usage', 2)
  }
  const permitted = new Set([
    'workspace',
    ...(target === 'tab'
      ? action === 'create'
        ? ['kind']
        : action === 'list'
          ? []
          : action === 'reorder'
            ? ['tab', 'index']
            : ['tab']
      : action === 'list'
        ? ['tab']
        : action === 'split'
          ? ['tab', 'pane', 'kind', 'direction']
          : action === 'resize'
            ? ['tab', 'split', 'ratio']
            : ['tab', 'pane'])
  ])
  for (const key of Object.keys(values))
    if (!permitted.has(key)) die(`--${key} is not valid for ${target} ${action}.`, 'usage', 2)
  const workspaceId = numeric(values.workspace ?? process.env.CEREBRO_WORKSPACE_ID, 'workspace')
  if (!workspaceId) die('--workspace is required outside a workspace terminal.', 'usage', 2)
  if (values.kind && !['terminal', 'changes'].includes(values.kind))
    die('--kind must be terminal or changes.', 'usage', 2)
  if (values.direction && !['auto', 'right', 'down'].includes(values.direction))
    die('--direction must be auto, right or down.', 'usage', 2)
  const command: LayoutCommand = {
    target,
    action: action as LayoutCommand['action'],
    workspaceId,
    tabId: numeric(values.tab, 'tab'),
    paneId: numeric(values.pane, 'pane'),
    splitId: numeric(values.split, 'split'),
    ratio: numeric(values.ratio, 'ratio', false),
    toIndex: numeric(values.index, 'index'),
    kind: values.kind as PaneKind | undefined,
    direction: values.direction as SplitDirection | undefined
  }
  if (['focus', 'close'].includes(action) && !(target === 'tab' ? command.tabId : command.paneId))
    die(`--${target} is required.`, 'usage', 2)
  if (action === 'reorder' && (command.tabId === undefined || command.toIndex === undefined))
    die('--tab and --index are required.', 'usage', 2)
  if (
    action === 'resize' &&
    (command.tabId === undefined ||
      command.splitId === undefined ||
      command.ratio === undefined ||
      command.ratio < 0.1 ||
      command.ratio > 0.9)
  )
    die('--tab, --split and --ratio (0.1–0.9) are required.', 'usage', 2)
  const response = await new Promise<{
    result?: unknown
    error?: boolean
    code?: string
    message?: string
  }>((resolve, reject) => {
    const socket = createConnection(getSocketPath())
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => socket.write(JSON.stringify({ type: 'layout', command }) + '\n'))
    socket.on('data', (chunk) => {
      buffer += chunk
      if (buffer.length > 4 * 1024 * 1024) {
        socket.destroy()
        reject(new Error('Layout response is too large.'))
        return
      }
      const end = buffer.indexOf('\n')
      if (end < 0) return
      try {
        resolve(JSON.parse(buffer.slice(0, end)))
      } catch {
        reject(new Error('Invalid desktop response.'))
      }
      socket.destroy()
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Desktop app did not respond.'))
    })
    socket.on('error', () =>
      reject(new Error('Cannot connect to Cerebro. Start the desktop app first.'))
    )
    socket.on('end', () => reject(new Error('Desktop connection closed before responding.')))
  }).catch((error) => die(error instanceof Error ? error.message : String(error), 'unavailable'))
  if (response.error)
    die(
      response.message ?? 'Layout command failed.',
      response.code ?? 'internal',
      response.code === 'usage' ? 2 : 1
    )
  printJson(response.result)
}
