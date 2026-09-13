import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { delimiter, join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { AgentHarness } from '@cerebro/core'

// Native protocols are versioned externally. Keep their permissive boundary inside adapters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Frame = Record<string, any>
export const describe = (value: unknown): string => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')
  return text.length > 100_000
    ? text.slice(0, 100_000) + '\n[Output truncated at 100,000 characters]'
    : text
}

export function executable(harness: AgentHarness): string {
  const name = harness === 'claude' ? 'claude' : harness
  const override = process.env[`CEREBRO_${harness.toUpperCase()}_PATH`]
  const paths = override
    ? [override]
    : (process.env.PATH ?? '').split(delimiter).map((p) => join(p, name))
  if (!override)
    paths.push(
      join(homedir(), '.local/bin', name),
      join('/opt/homebrew/bin', name),
      join('/usr/local/bin', name)
    )
  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK)
      return isAbsolute(path) ? path : join(process.cwd(), path)
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `${name} is not installed or not on PATH. Install and sign in with ${name}, then refresh models. CEREBRO_${harness.toUpperCase()}_PATH can specify its executable.`
  )
}

/** JSON-lines transport with bounded frames, request deadlines and deterministic teardown. */
export class JsonProcess {
  readonly child: ChildProcessWithoutNullStreams
  private pending = new Map<
    string,
    {
      resolve: (v: Frame) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private buffer = ''
  private stderr = ''
  private closed = false
  onFrame: (frame: Frame) => void = () => {}
  onExit: (error: Error) => void = () => {}
  constructor(
    binary: string,
    args: string[],
    cwd: string,
    private pi = false
  ) {
    this.child = spawn(binary, args, {
      cwd,
      env: process.env,
      stdio: 'pipe',
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.fail(new Error('Agent frame exceeded 8 MiB.'))
        return
      }
      let index: number
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index)
        this.buffer = this.buffer.slice(index + 1)
        if (!line.trim()) continue
        try {
          const frame: Frame = JSON.parse(line)
          if (!frame || typeof frame !== 'object') throw new Error('Invalid agent frame')
          const pending =
            frame.id != null && !frame.method && (!this.pi || frame.type === 'response')
              ? this.pending.get(String(frame.id))
              : undefined
          if (pending) {
            this.pending.delete(String(frame.id))
            clearTimeout(pending.timer)
            if (frame.error || frame.success === false)
              pending.reject(new Error(describe(frame.error ?? 'Agent request failed')))
            else pending.resolve(this.pi ? (frame.data ?? {}) : (frame.result ?? {}))
          } else this.onFrame(frame)
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
    })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('error', (error) => this.fail(error))
    this.child.on('close', (code) =>
      this.fail(new Error(`Agent exited (${code ?? 'signal'}). ${this.stderr}`))
    )
  }
  send(frame: Frame): void {
    if (this.closed) throw new Error('Agent process is closed.')
    if (this.child.stdin.writableLength > 8 * 1024 * 1024)
      throw new Error('Agent input queue is full.')
    this.child.stdin.write(JSON.stringify(frame) + '\n')
  }
  request(method: string, params: Frame = {}): Promise<Frame> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send(this.pi ? { id, type: method, ...params } : { id, method, params })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }
  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && this.child.pid) process.kill(-this.child.pid, signal)
        else this.child.kill(signal)
      } catch {
        this.child.kill(signal)
      }
    }
    kill('SIGTERM')
    const escalation = setTimeout(() => kill('SIGKILL'), 2000)
    escalation.unref()
    this.child.once('close', () => clearTimeout(escalation))
    this.onExit(error)
  }
  close(): void {
    this.fail(new Error('Agent stopped.'))
  }
}
