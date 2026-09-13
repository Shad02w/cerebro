import { parseArgs } from 'node:util'
import { muxRequest, MuxError } from '@cerebro/mux'
import { type LayoutCommand, type PaneKind, type SplitDirection } from '@cerebro/core'
import { die, printJson } from '../output'

const HELP = `Usage:
  cerebro tab list --workspace <id>
  cerebro tab create --workspace <id> [--kind terminal|changes|chat]
  cerebro tab focus|close --workspace <id> --tab <id>
  cerebro tab reorder --workspace <id> --tab <id> --index <zero-based-index>
  cerebro pane list --workspace <id> [--tab <id>]
  cerebro pane split --workspace <id> [--tab <id>] [--pane <id>]
                     [--kind terminal|changes|chat] [--direction auto|right|down]
  cerebro pane focus|close --workspace <id> --pane <id>
  cerebro pane resize --workspace <id> --tab <id> --split <id> --ratio <0.1-0.9>

Tab and pane commands start the mux automatically. IDs persist across restarts.
  cerebro pane capture --workspace <id> --pane <id> [--scrollback <rows>] [--format text|ansi]
  cerebro pane send --workspace <id> --pane <id> --text <text> [--enter]
  cerebro pane restart --workspace <id> --pane <id>
Creation/splitting accepts --sub-repo <id> for repository scope.
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
  const [action, ...rawRest] = args
  let enter = false
  const rest = rawRest
  const allowed =
    target === 'tab'
      ? ['list', 'create', 'focus', 'close', 'reorder']
      : ['list', 'split', 'focus', 'close', 'resize', 'capture', 'send', 'restart']
  if (!allowed.includes(action)) die(`Unknown ${target} action: ${action}`, 'usage', 2)
  let values: Record<string, string | undefined>
  try {
    values = parseArgs({
      args: rest,
      strict: true,
      options: {
        enter: { type: 'boolean' },
        ...Object.fromEntries(
          [
            'workspace',
            'tab',
            'pane',
            'kind',
            'direction',
            'split',
            'ratio',
            'index',
            'sub-repo',
            'scrollback',
            'format',
            'text'
          ].map((key) => [key, { type: 'string' as const }])
        )
      }
    }).values as Record<string, string | undefined>
    enter = (values as unknown as { enter?: boolean }).enter === true
    delete values.enter
    if (enter && (action !== 'send' || target !== 'pane'))
      die('--enter is only valid with pane send.', 'usage', 2)
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 'usage', 2)
  }
  const permitted = new Set([
    'workspace',
    ...(target === 'tab'
      ? action === 'create'
        ? ['kind', 'sub-repo']
        : action === 'list'
          ? []
          : action === 'reorder'
            ? ['tab', 'index']
            : ['tab']
      : action === 'list'
        ? ['tab']
        : action === 'split'
          ? ['tab', 'pane', 'kind', 'direction', 'sub-repo']
          : action === 'resize'
            ? ['tab', 'split', 'ratio']
            : action === 'capture'
              ? ['pane', 'scrollback', 'format']
              : action === 'send'
                ? ['pane', 'text']
                : ['tab', 'pane'])
  ])
  for (const key of Object.keys(values))
    if (!permitted.has(key)) die(`--${key} is not valid for ${target} ${action}.`, 'usage', 2)
  const workspaceId = numeric(values.workspace ?? process.env.CEREBRO_WORKSPACE_ID, 'workspace')
  if (!workspaceId) die('--workspace is required outside a workspace terminal.', 'usage', 2)
  if (values.kind && !['terminal', 'changes', 'chat'].includes(values.kind))
    die('--kind must be terminal, changes or chat.', 'usage', 2)
  if (values.direction && !['auto', 'right', 'down'].includes(values.direction))
    die('--direction must be auto, right or down.', 'usage', 2)
  if (['capture', 'send', 'restart'].includes(action)) {
    const paneId = numeric(values.pane, 'pane')
    if (!paneId) die('--pane is required.', 'usage', 2)
    if (action === 'send' && values.text === undefined) die('--text is required.', 'usage', 2)
    try {
      printJson(
        await muxRequest(`terminal.${action === 'send' ? 'write' : action}`, {
          workspaceId,
          paneId,
          scrollback: values.scrollback === undefined ? 0 : Number(values.scrollback),
          format: values.format ?? 'text',
          data: (values.text ?? '') + (enter ? '\r' : '')
        })
      )
    } catch (error) {
      die(
        error instanceof Error ? error.message : String(error),
        error instanceof MuxError ? error.code : 'internal',
        error instanceof MuxError && error.code === 'usage' ? 2 : 1
      )
    }
    return
  }
  const command: LayoutCommand = {
    target,
    action: action as LayoutCommand['action'],
    workspaceId,
    repositoryId: numeric(values['sub-repo'], 'sub-repo'),
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
  try {
    const response = await muxRequest<{ result: unknown }>('layout.command', command)
    printJson(response.result)
  } catch (error) {
    die(
      error instanceof Error ? error.message : String(error),
      error instanceof MuxError ? error.code : 'internal',
      error instanceof MuxError && error.code === 'usage' ? 2 : 1
    )
  }
}
