import { parseArgs } from 'node:util'
import { connectMux, MuxError } from '@cerebro/mux'
import { die, printJson } from '../output'

const HELP = `Usage:
  cerebro chat peers [--workspace <id>] [--session <id>]
  cerebro chat send --pane <id> --text <text> [--workspace <id>] [--session <id>]
  cerebro chat read --session <id> --turn <id> [--from <id>] [--workspace <id>] [--timeout <ms>]

Message another open chat pane in the same workspace. The target must already
have a conversation. send returns immediately with that pane's turn id; a busy
agent enqueues the message and still returns the turn id. read waits for that
turn and prints the reply.

Inside an agent pane, workspace, sender session, and from default to
CEREBRO_WORKSPACE_ID and CEREBRO_SESSION_ID.
Output is JSON; errors exit 1 (usage errors exit 2).`

function numeric(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const result = Number(value)
  if (!value.trim() || !Number.isSafeInteger(result) || result < 1)
    die(`Invalid ${name}.`, 'usage', 2)
  return result
}

export async function chatCommand(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP + '\n')
    return
  }
  const [action, ...rest] = args
  if (!['peers', 'send', 'read'].includes(action)) die(`Unknown chat action: ${action}`, 'usage', 2)
  let values: Record<string, string | undefined>
  try {
    values = parseArgs({
      args: rest,
      strict: true,
      options: Object.fromEntries(
        ['workspace', 'session', 'pane', 'text', 'turn', 'from', 'timeout'].map((key) => [
          key,
          { type: 'string' as const }
        ])
      )
    }).values as Record<string, string | undefined>
  } catch (error) {
    die(error instanceof Error ? error.message : String(error), 'usage', 2)
  }
  const permitted = new Set(
    action === 'peers'
      ? ['workspace', 'session']
      : action === 'send'
        ? ['workspace', 'session', 'pane', 'text']
        : ['workspace', 'session', 'turn', 'from', 'timeout']
  )
  for (const key of Object.keys(values))
    if (!permitted.has(key)) die(`--${key} is not valid for chat ${action}.`, 'usage', 2)
  const workspaceId = numeric(values.workspace ?? process.env.CEREBRO_WORKSPACE_ID, 'workspace')
  if (!workspaceId) die('--workspace is required outside an agent pane.', 'usage', 2)
  const envSession = process.env.CEREBRO_SESSION_ID
  let method: string
  let params: Record<string, unknown>
  let timeoutMs = 60_000
  if (action === 'peers') {
    method = 'chat.peers'
    params = {
      workspaceId,
      ...(values.session || envSession ? { sessionId: values.session ?? envSession } : {})
    }
  } else if (action === 'send') {
    const paneId = numeric(values.pane, 'pane')
    const sessionId = values.session ?? envSession
    if (!paneId) die('--pane is required.', 'usage', 2)
    if (!sessionId) die('--session is required outside an agent pane.', 'usage', 2)
    if (values.text === undefined) die('--text is required.', 'usage', 2)
    method = 'chat.deliver'
    params = { workspaceId, paneId, sessionId, text: values.text }
  } else {
    const sessionId = values.session
    const fromSessionId = values.from ?? envSession
    if (!sessionId) die('--session is required.', 'usage', 2)
    if (!values.turn) die('--turn is required.', 'usage', 2)
    if (values.timeout !== undefined) {
      const parsed = Number(values.timeout)
      if (!values.timeout.trim() || !Number.isFinite(parsed) || parsed < 0)
        die('Invalid timeout.', 'usage', 2)
      timeoutMs = parsed
    }
    method = 'chat.read'
    params = {
      workspaceId,
      sessionId,
      turnId: values.turn,
      timeoutMs,
      ...(fromSessionId ? { fromSessionId } : {})
    }
  }
  const client = await connectMux()
  try {
    printJson(await client.request(method, params, timeoutMs + 15_000))
  } catch (error) {
    die(
      error instanceof Error ? error.message : String(error),
      error instanceof MuxError ? error.code : 'internal',
      error instanceof MuxError && error.code === 'usage' ? 2 : 1
    )
  } finally {
    client.close()
  }
}
