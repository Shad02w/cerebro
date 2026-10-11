import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'

const MARK = '__CEREBRO_SHELL_ENV__'
// Shell bookkeeping and Cerebro's own routing must stay as the daemon received them.
const SKIP = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])

let resolved: NodeJS.ProcessEnv | undefined
let loading: Promise<void> | undefined

export function parseShellEnv(output: string): Record<string, string> | undefined {
  const parts = output.split(MARK)
  if (parts.length < 3) return undefined
  try {
    const env: unknown = JSON.parse(parts[1])
    if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined
    return Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    return undefined
  }
}

export function mergeShellEnv(
  base: NodeJS.ProcessEnv,
  shell: Record<string, string>
): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const [key, value] of Object.entries(shell)) {
    if (SKIP.has(key) || key.startsWith('CEREBRO_') || key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  return env
}

function defaultShell(): string {
  try {
    return process.env.SHELL || userInfo().shell || '/bin/sh'
  } catch {
    return process.env.SHELL || '/bin/sh'
  }
}

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** Resolves the environment a login, interactive shell builds, as a terminal pane does. */
export function resolveShellEnv(
  shell = defaultShell(),
  timeoutMs = 10_000
): Promise<NodeJS.ProcessEnv | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  const script = `printf '${MARK}'; ${quote(process.execPath)} -p 'JSON.stringify(process.env)'; printf '${MARK}'`
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const done = (env: NodeJS.ProcessEnv | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(env)
    }
    const child = spawn(shell, ['-l', '-i', '-c', script], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      done(undefined)
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.on('error', () => done(undefined))
    child.on('close', () => {
      const env = parseShellEnv(output)
      done(env && mergeShellEnv(process.env, env))
    })
  })
}

export function loadShellEnv(): Promise<void> {
  loading ??= resolveShellEnv().then((env) => {
    resolved = env
  })
  return loading
}

/** Environment for agent processes: the login shell's once loaded, else the daemon's own. */
export function shellEnv(): NodeJS.ProcessEnv {
  return resolved ?? process.env
}
