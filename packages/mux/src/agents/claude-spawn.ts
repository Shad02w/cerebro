import { spawn, type ChildProcess } from 'node:child_process'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude Code in its own session. The default SDK spawn stays in the mux process group, so a
 * signal from the harness tears down the host and the desktop reports a dropped chat call.
 */
export function spawnClaudeProcess(options: SpawnOptions): SpawnedProcess {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  if (!child.stdin || !child.stdout) throw new Error('Claude process is missing stdio pipes.')
  const stdin = child.stdin
  const stdout = child.stdout
  const killChild = child.kill.bind(child)
  child.kill = (signal?: NodeJS.Signals | number): boolean => {
    if (process.platform !== 'win32' && child.pid && typeof signal === 'string') {
      try {
        process.kill(-child.pid, signal)
        return true
      } catch {
        /* The process group is already gone. */
      }
    }
    return killChild(signal)
  }
  return Object.assign(spawned(child, stdin, stdout), { pid: child.pid })
}

function spawned(
  child: ChildProcess,
  stdin: NonNullable<ChildProcess['stdin']>,
  stdout: NonNullable<ChildProcess['stdout']>
): SpawnedProcess {
  return {
    stdin,
    stdout,
    get killed() {
      return child.killed
    },
    get exitCode() {
      return child.exitCode
    },
    get signalCode() {
      return child.signalCode
    },
    kill(signal) {
      return child.kill(signal)
    },
    on(event, listener) {
      child.on(event, listener)
    },
    once(event, listener) {
      child.once(event, listener)
    },
    off(event, listener) {
      child.off(event, listener)
    }
  }
}
