import { existsSync } from 'node:fs'
import { readdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises'
import { arch, cpus, freemem, homedir, platform, release, totalmem, uptime } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { LayoutState, PaneNode, ProjectListResult } from '@cerebro/core'
import { connectMux, type MuxClient } from './client'
import { log, logPath } from './log'
import { home, muxDirectory } from './paths'
import { ownerStatus } from './ownership'
import { readRuntimeManifest } from './runtime-manifest'
import { createZip, type ZipEntry } from './zip'

/**
 * Support bundle: logs plus counts and versions, never content.
 *
 * Included: `server.log` (+ rotated copy), system/version info, mux and ownership state, and
 * aggregate counts of projects, workspaces, tabs and panes. Excluded by construction: terminal
 * output, chat sessions, project/workspace/branch names, file contents, and
 * GitHub credentials. Home directories are rewritten to `~` and known secret shapes are scrubbed
 * from the log text as a second line of defence.
 */
export type DiagnosticsOptions = {
  /** Destination `.zip`, or an existing directory to receive a timestamped file. */
  outputPath: string
  /** Caller facts, e.g. the desktop app version. Must not contain user content. */
  app?: Record<string, unknown>
  /** Skips talking to the daemon; used by tests and by callers that already know it is down. */
  skipMux?: boolean
}
export type DiagnosticsResult = {
  path: string
  bytes: number
  files: Array<{ name: string; bytes: number }>
  muxRunning: boolean
}

const BUNDLE_VERSION = 1
const MUX_TIMEOUT_MS = 5000
const README = `Cerebro diagnostics bundle

Created so a problem can be investigated without screen-sharing. Contents:

  logs/server.log, logs/server.log.1  Timestamped events from the mux daemon, desktop app and CLI
  system.json                         App, OS and runtime versions; mux and ownership state; file sizes
  layout-summary.json                 Counts of projects, workspaces, tabs and panes (no names)

Not included: terminal output or input, chat sessions, project/workspace/branch names, file
contents, and GitHub credentials. Your home directory appears as "~".
Review the files before sharing; they are plain text and JSON.
`

export function defaultDiagnosticsName(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `cerebro-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
  )
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Longest paths first, so `$CEREBRO_HOME` wins over the `~` prefix it usually sits under. */
function pathReplacements(): Array<[RegExp, string]> {
  const pairs: Array<[string, string]> = [
    [home(), '$CEREBRO_HOME'],
    [homedir(), '~']
  ]
  const out: Array<[RegExp, string]> = []
  for (const [path, label] of pairs.sort((a, b) => b[0].length - a[0].length)) {
    if (path.length < 2 || path === '/') continue
    // Windows paths appear raw and JSON-escaped (double backslashes) in the log.
    for (const variant of new Set([
      path,
      path.replaceAll('\\', '\\\\'),
      path.replaceAll('\\', '/')
    ]))
      out.push([new RegExp(escapeRegExp(variant), 'gi'), label])
  }
  return out
}
const SECRETS: Array<[RegExp, string]> = [
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted-token]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted-token]'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]'],
  [
    /("?(?:authorization|access_?token|refresh_?token|password|secret|api_?key)"?\s*[:=]\s*"?)[^\s",}]{6,}/gi,
    '$1[redacted]'
  ],
  // URLs with credentials: https://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@']
]
export function redactDiagnostics(text: string, extraSecrets: string[] = []): string {
  let result = text
  for (const secret of extraSecrets)
    if (secret.length >= 8) result = result.split(secret).join('[redacted-token]')
  for (const [pattern, replacement] of SECRETS) result = result.replace(pattern, replacement)
  for (const [pattern, label] of pathReplacements()) result = result.replace(pattern, label)
  return result
}

async function size(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}
async function treeStats(path: string, depth = 4): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        if (depth <= 0) continue
        const nested = await treeStats(child, depth - 1)
        files += nested.files
        bytes += nested.bytes
      } else if (entry.isFile()) {
        files++
        bytes += (await size(child)) ?? 0
      }
    }
  } catch {
    /* Missing directory counts as empty. */
  }
  return { files, bytes }
}
const tally = (items: Iterable<string>): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1
  return counts
}
const leaves = (node: PaneNode): Array<{ kind: string }> =>
  node.type === 'pane' ? [node] : [...leaves(node.first), ...leaves(node.second)]

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), MUX_TIMEOUT_MS)
    })
  ]).finally(() => clearTimeout(timer))
}
const describeError = (error: unknown): { code?: string; message: string } => ({
  code: (error as { code?: string })?.code,
  message: error instanceof Error ? error.message : String(error)
})

type MuxSnapshot = {
  mux: Record<string, unknown>
  layout: Record<string, unknown> | null
  running: boolean
}
/** Asks a running daemon for status and counts. Never starts one: the point is to see what is. */
async function muxSnapshot(skip: boolean): Promise<MuxSnapshot> {
  if (skip) return { mux: { running: null, skipped: true }, layout: null, running: false }
  let client: MuxClient | undefined
  try {
    client = await withTimeout(connectMux({ autoStart: false }), 'Connecting to mux')
    const request = <T>(method: string, params: unknown = {}): Promise<T> =>
      client!.request<T>(method, params, MUX_TIMEOUT_MS)
    const status = await request<Record<string, unknown>>('server.status')
    const [state, registry] = await Promise.all([
      request<LayoutState>('layout.get').catch(() => null),
      request<ProjectListResult>('registry', { action: 'list' }).catch(() => null)
    ])
    const workspaces = Object.values(state?.workspaces ?? {})
    const tabs = workspaces.flatMap((workspace) => workspace.tabs)
    const panes = tabs.flatMap((tab) => leaves(tab.root))
    const projects = registry?.projects ?? []
    const checkouts = projects.flatMap((project) => project.workspaces)
    return {
      running: true,
      mux: { running: true, ...status },
      layout: {
        layoutRevision: state?.revision ?? null,
        workspacesWithLayout: workspaces.length,
        tabs: tabs.length,
        panes: tally(panes.map((pane) => pane.kind)),
        projects: projects.length,
        projectKinds: tally(projects.map((project) => project.kind)),
        githubLinkedProjects: projects.filter((project) => project.github).length,
        workspaces: checkouts.length,
        workspaceKinds: tally(checkouts.map((workspace) => workspace.kind)),
        workspaceStatuses: tally(checkouts.map((workspace) => workspace.status)),
        // A missing checkout is a common cause of terminals that will not start.
        workspacesMissingOnDisk: checkouts.filter((workspace) => !existsSync(workspace.localPath))
          .length
      }
    }
  } catch (error) {
    return { running: false, mux: { running: false, error: describeError(error) }, layout: null }
  } finally {
    client?.close()
  }
}

async function runtimes(): Promise<unknown[]> {
  const root = join(muxDirectory(), 'runtimes')
  try {
    return await Promise.all(
      (await readdir(root)).sort().map(async (fingerprint) => ({
        fingerprint,
        manifest: (await readRuntimeManifest(join(root, fingerprint))) ?? null
      }))
    )
  } catch {
    return []
  }
}

export async function exportDiagnostics(options: DiagnosticsOptions): Promise<DiagnosticsResult> {
  log('info', 'diagnostics.export_started', {})
  const now = new Date()
  let target = resolve(options.outputPath)
  if (existsSync(target) && (await stat(target)).isDirectory())
    target = join(target, defaultDiagnosticsName(now))
  else if (!target.toLowerCase().endsWith('.zip')) target += '.zip'

  const scrub = (text: string): string => redactDiagnostics(text)

  const snapshot = await muxSnapshot(Boolean(options.skipMux))
  const database = join(home(), 'cerebro.sqlite')
  const terminals = await treeStats(join(muxDirectory(), 'terminals'))
  const agents = await treeStats(join(muxDirectory(), 'agents'))
  const free = await statfs(home())
    .then((value) => value.bavail * value.bsize)
    .catch(() => null)
  const system = {
    bundleVersion: BUNDLE_VERSION,
    generatedAt: now.toISOString(),
    app: options.app ?? null,
    process: {
      node: process.version,
      electron: process.versions.electron ?? null,
      execName: basename(process.execPath)
    },
    os: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpus: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
      uptimeSeconds: Math.round(uptime())
    },
    environment: {
      home: '$CEREBRO_HOME',
      customDatabasePath: Boolean(process.env.CEREBRO_DB_PATH),
      scrollbackOverride: process.env.CEREBRO_SCROLLBACK ?? null,
      shell: process.env.SHELL ? basename(process.env.SHELL) : null
    },
    mux: snapshot.mux,
    ownership: await ownerStatus(),
    runtimes: await runtimes(),
    storage: {
      freeBytes: free,
      database: await size(database),
      databaseWal: await size(`${database}-wal`),
      ownershipDatabase: await size(join(muxDirectory(), 'ownership.sqlite')),
      terminals,
      agentSessions: agents,
      serverLog: await size(logPath()),
      serverLogRotated: await size(`${logPath()}.1`)
    }
  }

  const entries: ZipEntry[] = [
    { name: 'README.txt', data: README, modified: now },
    { name: 'system.json', data: scrub(JSON.stringify(system, null, 2)) + '\n', modified: now },
    {
      name: 'layout-summary.json',
      data:
        JSON.stringify(snapshot.layout ?? { unavailable: 'The mux was not reachable.' }, null, 2) +
        '\n',
      modified: now
    }
  ]
  for (const name of ['server.log', 'server.log.1']) {
    const path = join(muxDirectory(), name)
    try {
      const text = await readFile(path, 'utf8')
      entries.push({
        name: `logs/${name}`,
        data: scrub(text),
        modified: (await stat(path)).mtime
      })
    } catch {
      /* Not written yet. */
    }
  }

  const zip = createZip(entries)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, zip, { mode: 0o600 })
  await rename(temporary, target)
  const result: DiagnosticsResult = {
    path: target,
    bytes: zip.length,
    files: entries.map((entry) => ({
      name: entry.name,
      bytes: Buffer.byteLength(entry.data as string)
    })),
    muxRunning: snapshot.running
  }
  log('info', 'diagnostics.exported', { bytes: result.bytes, files: result.files.length })
  return result
}
