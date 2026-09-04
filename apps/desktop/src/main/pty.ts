import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import { IPC } from '../shared/ipc'
import type { PtyExitEvent, PtyOpenResult } from '../shared/types'
import { getWorkspaceLocalPath, getWorkspaceProjectId } from './projects'
import { getCerebroHome } from './paths'

type PtySession = {
  sessionId: number
  workspaceId: number
  process: pty.IPty
  webContents: WebContents
}

const sessionsById = new Map<number, PtySession>()
let nextSessionId = 1

function isUsableShell(shell: string | null | undefined): shell is string {
  if (!shell || shell === '/bin/false' || shell === '/usr/bin/false') return false
  return existsSync(shell)
}

function loginArgsForShell(shellPath: string): string[] {
  const name = basename(shellPath).toLowerCase()
  if (name === 'zsh' || name === 'bash' || name === 'fish' || name === 'sh') {
    return ['-l']
  }
  return []
}

/** Resolve the user's default login shell (VS Code–style). */
export function resolveDefaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC
    if (isUsableShell(comspec)) {
      return { file: comspec, args: [] }
    }
    return { file: 'powershell.exe', args: [] }
  }

  const fromEnv = process.env.SHELL
  if (isUsableShell(fromEnv)) {
    return { file: fromEnv, args: loginArgsForShell(fromEnv) }
  }

  try {
    const fromPasswd = userInfo().shell
    if (isUsableShell(fromPasswd)) {
      return { file: fromPasswd, args: loginArgsForShell(fromPasswd) }
    }
  } catch {
    // userInfo() can throw when username/homedir are unavailable.
  }

  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { file: fallback, args: loginArgsForShell(fallback) }
}

function disposeSession(sessionId: number): void {
  const session = sessionsById.get(sessionId)
  if (!session) return
  sessionsById.delete(sessionId)
  try {
    session.process.kill()
  } catch {
    // Process may already have exited.
  }
}

function emitExit(session: PtySession, exitCode: number, signal?: number): void {
  if (session.webContents.isDestroyed()) return
  const payload: PtyExitEvent = {
    sessionId: session.sessionId,
    exitCode,
    signal
  }
  session.webContents.send(IPC.pty.exit, payload)
}

export async function openPty(
  webContents: WebContents,
  workspaceId: number,
  cols: number,
  rows: number
): Promise<PtyOpenResult> {
  const cwd = getWorkspaceLocalPath(workspaceId)
  if (!existsSync(cwd)) {
    throw new Error(`Workspace path does not exist: ${cwd}`)
  }

  // Resolve project ID for env injection (best-effort; ignore if workspace lookup fails).
  let projectId: number | null = null
  try {
    projectId = await getWorkspaceProjectId(workspaceId)
  } catch {
    // Non-fatal; env vars will just be omitted.
  }

  const { file, args } = resolveDefaultShell()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'

  // Inject Cerebro context so agents running inside a workspace terminal can
  // use the CLI without specifying --project / --workspace flags.
  env.CEREBRO_HOME = getCerebroHome()
  env.CEREBRO_WORKSPACE_ID = String(workspaceId)
  env.CEREBRO_WORKSPACE_PATH = cwd
  if (projectId !== null) {
    env.CEREBRO_PROJECT_ID = String(projectId)
  }

  const processHandle = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    cwd,
    env
  })

  const sessionId = nextSessionId
  nextSessionId += 1
  const session: PtySession = {
    sessionId,
    workspaceId,
    process: processHandle,
    webContents
  }
  sessionsById.set(sessionId, session)

  processHandle.onData((data) => {
    if (session.webContents.isDestroyed()) return
    session.webContents.send(IPC.pty.data, { sessionId: session.sessionId, data })
  })

  processHandle.onExit(({ exitCode, signal }) => {
    const current = sessionsById.get(sessionId)
    if (current?.process === processHandle) {
      sessionsById.delete(sessionId)
    }
    emitExit(session, exitCode, signal)
  })

  return { sessionId: session.sessionId }
}

export function writePty(sessionId: number, data: string): void {
  const session = sessionsById.get(sessionId)
  if (!session) return
  session.process.write(data)
}

export function resizePty(sessionId: number, cols: number, rows: number): void {
  const session = sessionsById.get(sessionId)
  if (!session) return
  try {
    session.process.resize(Math.max(2, cols), Math.max(1, rows))
  } catch {
    // Ignore resize failures on a dying process.
  }
}

export function killPty(sessionId: number): void {
  disposeSession(sessionId)
}

/** Kill every PTY session for a workspace. Safe when none are open. */
export function killPtyForWorkspace(workspaceId: number): void {
  for (const session of [...sessionsById.values()]) {
    if (session.workspaceId === workspaceId) {
      disposeSession(session.sessionId)
    }
  }
}

export function killAllPtys(): void {
  for (const sessionId of [...sessionsById.keys()]) {
    disposeSession(sessionId)
  }
}

function assertWorkspaceId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Workspace id is required.')
  }
  return value
}

function assertSessionId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Session id is required.')
  }
  return value
}

function assertPositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error(`${label} is required.`)
  }
  return Math.floor(value)
}

export function registerPtyIpc(): void {
  ipcMain.handle(IPC.pty.open, (event, workspaceId: unknown, cols: unknown, rows: unknown) => {
    return openPty(
      event.sender,
      assertWorkspaceId(workspaceId),
      assertPositiveInt(cols, 'Columns'),
      assertPositiveInt(rows, 'Rows')
    )
  })

  ipcMain.handle(IPC.pty.write, (_event, sessionId: unknown, data: unknown) => {
    if (typeof data !== 'string') {
      throw new Error('PTY write data must be a string.')
    }
    writePty(assertSessionId(sessionId), data)
  })

  ipcMain.handle(IPC.pty.resize, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    resizePty(
      assertSessionId(sessionId),
      assertPositiveInt(cols, 'Columns'),
      assertPositiveInt(rows, 'Rows')
    )
  })

  ipcMain.handle(IPC.pty.kill, (_event, sessionId: unknown) => {
    killPty(assertSessionId(sessionId))
  })
}
