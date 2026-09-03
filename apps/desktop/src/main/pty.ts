import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import { IPC } from '../shared/ipc'
import type { PtyExitEvent, PtyOpenResult } from '../shared/types'
import { getWorkspaceLocalPath } from './workspaces'

type PtySession = {
  sessionId: number
  workspaceId: number
  process: pty.IPty
  webContents: WebContents
}

const sessionsByWorkspaceId = new Map<number, PtySession>()

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

function disposeSession(workspaceId: number): void {
  const session = sessionsByWorkspaceId.get(workspaceId)
  if (!session) return
  sessionsByWorkspaceId.delete(workspaceId)
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

export function openPty(
  webContents: WebContents,
  workspaceId: number,
  cols: number,
  rows: number
): PtyOpenResult {
  const existing = sessionsByWorkspaceId.get(workspaceId)
  if (existing) {
    existing.webContents = webContents
    try {
      existing.process.resize(Math.max(2, cols), Math.max(1, rows))
    } catch {
      // Ignore resize failures on a dying process.
    }
    return { sessionId: existing.sessionId }
  }

  const cwd = getWorkspaceLocalPath(workspaceId)
  if (!existsSync(cwd)) {
    throw new Error(`Workspace path does not exist: ${cwd}`)
  }

  const { file, args } = resolveDefaultShell()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'

  const processHandle = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    cwd,
    env
  })

  const session: PtySession = {
    sessionId: workspaceId,
    workspaceId,
    process: processHandle,
    webContents
  }
  sessionsByWorkspaceId.set(workspaceId, session)

  processHandle.onData((data) => {
    if (session.webContents.isDestroyed()) return
    session.webContents.send(IPC.pty.data, { sessionId: session.sessionId, data })
  })

  processHandle.onExit(({ exitCode, signal }) => {
    const current = sessionsByWorkspaceId.get(workspaceId)
    if (current?.process === processHandle) {
      sessionsByWorkspaceId.delete(workspaceId)
    }
    emitExit(session, exitCode, signal)
  })

  return { sessionId: session.sessionId }
}

export function writePty(sessionId: number, data: string): void {
  const session = sessionsByWorkspaceId.get(sessionId)
  if (!session) return
  session.process.write(data)
}

export function resizePty(sessionId: number, cols: number, rows: number): void {
  const session = sessionsByWorkspaceId.get(sessionId)
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

export function killAllPtys(): void {
  for (const workspaceId of [...sessionsByWorkspaceId.keys()]) {
    disposeSession(workspaceId)
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
