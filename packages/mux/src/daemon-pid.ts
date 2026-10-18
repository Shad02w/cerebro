import { execFile } from 'node:child_process'
import { readdir, readFile, readlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
/** Linux reports a listening Unix socket with this bit set in /proc/net/unix flags. */
const LISTEN_FLAG = 0x10000

/** `mux.cjs` as its own argv entry. `mux-worker.cjs` does not match. */
export function isMuxDaemonCommand(cmdline: string): boolean {
  return /(^|[\s\0\\/])mux\.cjs($|[\s\0])/.test(cmdline)
}

async function commandLine(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      return (await readFile(`/proc/${pid}/cmdline`)).toString('utf8')
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-ww', '-o', 'command='])
      return stdout
    } catch {
      return undefined
    }
  }
  return undefined
}

function sameSocket(candidate: string, sock: string): boolean {
  const path = candidate.replace(/^->/, '').split(' ')[0] ?? ''
  return path === sock || basename(path) === basename(sock)
}

/** PIDs lsof reports as holding `sock`. The name field may include a ` type=` suffix. */
export function socketPidsFromLsof(output: string, sock: string): number[] {
  const pids: number[] = []
  let current: number | undefined
  let holds = false
  const flush = (): void => {
    if (current !== undefined && holds) pids.push(current)
    holds = false
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      flush()
      const pid = Number(line.slice(1))
      current = Number.isInteger(pid) && pid > 1 ? pid : undefined
    } else if (line.startsWith('n') && sameSocket(line.slice(1), sock)) holds = true
  }
  flush()
  return [...new Set(pids)]
}

async function linuxListenerPids(sock: string): Promise<number[]> {
  let text: string
  try {
    text = await readFile('/proc/net/unix', 'utf8')
  } catch {
    return []
  }
  const inodes = new Set<string>()
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 8) continue
    const flags = Number.parseInt(fields[3] ?? '', 16)
    if (!Number.isFinite(flags) || (flags & LISTEN_FLAG) === 0) continue
    const path = fields.slice(7).join(' ')
    if (!sameSocket(path, sock)) continue
    const inode = fields[6]
    if (inode) inodes.add(inode)
  }
  if (inodes.size === 0) return []
  let entries: string[]
  try {
    entries = await readdir('/proc')
  } catch {
    return []
  }
  const pids: number[] = []
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    if (pid <= 1) continue
    let fds: string[]
    try {
      fds = await readdir(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      try {
        const target = await readlink(`/proc/${pid}/fd/${fd}`)
        if (![...inodes].some((inode) => target === `socket:[${inode}]`)) continue
        pids.push(pid)
        break
      } catch {
        /* The fd closed while we were reading it. */
      }
    }
  }
  return pids
}

async function darwinHolderPids(sock: string): Promise<number[]> {
  let stdout = ''
  try {
    stdout = (await exec('/usr/sbin/lsof', ['-b', '-n', '-P', '-F', 'pn', sock])).stdout
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? ''
  }
  if (!stdout) return []
  return socketPidsFromLsof(stdout, sock)
}

async function holderPids(sock: string): Promise<number[]> {
  if (process.platform === 'linux') return linuxListenerPids(sock)
  if (process.platform === 'darwin') return darwinHolderPids(sock)
  return []
}

export type StopMuxDaemonResult =
  | { stopped: true; pid: number; forced: boolean }
  | { stopped: false; reason: 'not_found' | 'ambiguous' | 'kill_failed' }

const gone = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/**
 * Stops the mux daemon listening on `sock`. Only a process whose command line is `mux.cjs`
 * is signaled, and only when exactly one such process holds the socket.
 */
export async function stopMuxDaemon(sock: string): Promise<StopMuxDaemonResult> {
  const holders = await holderPids(sock)
  const daemons: number[] = []
  for (const pid of holders) {
    if (pid === process.pid) continue
    const command = await commandLine(pid)
    if (command && isMuxDaemonCommand(command)) daemons.push(pid)
  }
  if (daemons.length === 0) return { stopped: false, reason: 'not_found' }
  if (daemons.length > 1) return { stopped: false, reason: 'ambiguous' }
  const pid = daemons[0]!
  const command = await commandLine(pid)
  if (!command || !isMuxDaemonCommand(command)) return { stopped: false, reason: 'not_found' }
  const signal = (code: NodeJS.Signals): boolean => {
    try {
      process.kill(pid, code)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }
  if (!signal('SIGTERM'))
    return gone(pid)
      ? { stopped: true, pid, forced: false }
      : { stopped: false, reason: 'kill_failed' }
  for (let attempt = 0; attempt < 1200 && !gone(pid); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  if (gone(pid)) return { stopped: true, pid, forced: false }
  if (!signal('SIGKILL'))
    return gone(pid)
      ? { stopped: true, pid, forced: true }
      : { stopped: false, reason: 'kill_failed' }
  for (let attempt = 0; attempt < 40 && !gone(pid); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  return gone(pid)
    ? { stopped: true, pid, forced: true }
    : { stopped: false, reason: 'kill_failed' }
}
