/** Run after the desktop runtime build. Uses an isolated home and real PTYs. */
import { mkdtemp, mkdir, rm, readdir, stat, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir, cpus, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import type { Project, WorkspaceTab } from '@cerebro/core'
import { connectMux, type TerminalSnapshot } from './client'

async function bytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? bytes(join(path, entry.name))
        : stat(join(path, entry.name)).then((value) => value.size)
    )
  )
  return sizes.reduce((a, b) => a + b, 0)
}
const percentile = (values: number[], quantile: number): number =>
  Number(
    [...values]
      .sort((a, b) => a - b)
      [Math.min(values.length - 1, Math.floor(values.length * quantile))].toFixed(2)
  )
async function main(): Promise<void> {
  if (process.platform === 'win32')
    throw new Error('This workload uses POSIX awk; use native Windows smoke tests on Windows.')
  const home = await mkdtemp(join(tmpdir(), 'cerebro-mux-benchmark-'))
  process.env.CEREBRO_HOME = home
  delete process.env.CEREBRO_DB_PATH
  process.env.SHELL = '/bin/sh'
  const directory = join(home, 'project')
  await mkdir(directory)
  const client = await connectMux({
    runtimeDir: resolve(__dirname, '../../../apps/desktop/out/cli')
  })
  const results: unknown[] = []
  const targets: Array<{ workspaceId: number; paneId: number }> = []
  try {
    const project = await client.request<Project>('registry', {
      action: 'project.createDirectory',
      directory
    })
    const workspaceId = project.workspaces[0].id
    for (const count of [1, 10, 50]) {
      while (targets.length < count) {
        const reply = await client.request<{ result: WorkspaceTab }>('layout.command', {
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'terminal'
        })
        targets.push({ workspaceId, paneId: reply.result.root.id })
      }
      const fillStart = performance.now()
      await Promise.all(
        targets.map((target) =>
          client.request('terminal.write', {
            ...target,
            data: `awk 'BEGIN {for(i=0;i<10500;i++) print i,"012345678901234567890123456789"; print "HISTORY_DONE_${count}"}'\r`
          })
        )
      )
      for (const target of targets) {
        for (let i = 0; ; i++) {
          const capture = await client.request<TerminalSnapshot>('terminal.capture', target)
          if (capture.data.includes(`\nHISTORY_DONE_${count}\n`)) break
          if (i > 2000) throw new Error('History fill timed out.')
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      const fillMs = performance.now() - fillStart
      const reconnect: number[] = []
      let snapshotBytes = 0
      for (let i = 0; i < 12; i++) {
        const start = performance.now()
        const snapshot = await client.request<TerminalSnapshot>(
          'terminal.attach',
          targets[i % targets.length]
        )
        reconnect.push(performance.now() - start)
        snapshotBytes = Buffer.byteLength(snapshot.data)
        await client.request('terminal.detach', { attachmentId: snapshot.attachmentId })
      }
      const latency: number[] = []
      if (count > 1)
        await client.request('terminal.write', {
          ...targets.at(-1),
          data: `awk 'BEGIN {for(i=0;i<100000;i++) print i,"background output"; print "NOISE_DONE"}'\r`
        })
      for (let i = 0; i < 12; i++) {
        const marker = `PROBE_${count}_${i}_${Date.now()}`
        const start = performance.now()
        await client.request('terminal.write', {
          ...targets[0],
          data: `printf '\\n%s\\n' '${marker}'\r`
        })
        for (let attempts = 0; ; attempts++) {
          const snapshot = await client.request<TerminalSnapshot>('terminal.capture', targets[0])
          if (snapshot.data.includes(`\n${marker}\n`)) break
          if (attempts > 2000) throw new Error('Input probe timed out.')
          await new Promise((resolve) => setTimeout(resolve, 2))
        }
        latency.push(performance.now() - start)
      }
      if (count > 1)
        for (let i = 0; i < 2000; i++) {
          const snapshot = await client.request<TerminalSnapshot>(
            'terminal.capture',
            targets.at(-1)
          )
          if (snapshot.data.includes('\nNOISE_DONE\n')) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      const status = await client.request<{
        memory: { rss: number }
        cpu: { user: number; system: number }
      }>('server.status')
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const idle = await client.request<typeof status>('server.status')
      const result = {
        terminals: count,
        historyRows: 10000,
        fillMs: Math.round(fillMs),
        snapshotBytes,
        reconnectMs: { p50: percentile(reconnect, 0.5), p95: percentile(reconnect, 0.95) },
        inputToCaptureMs: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95) },
        rssBytes: idle.memory.rss,
        idleCpuMs: (idle.cpu.user + idle.cpu.system - status.cpu.user - status.cpu.system) / 1000,
        retainedFileBytes: await bytes(join(home, 'mux/terminals'))
      }
      results.push(result)
      process.stdout.write(JSON.stringify(result) + '\n')
    }
    const report = {
      date: new Date().toISOString(),
      runtime: JSON.parse(
        await readFile(resolve(__dirname, '../../../apps/desktop/out/cli/runtime.json'), 'utf8')
      ),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0].model,
      totalMemory: totalmem(),
      notes:
        '12 samples per measurement. Input-to-capture is daemon latency, not renderer paint. Idle sample is 1.2 seconds. RSS covers daemon and its storage worker, excluding shell children. File bytes include bounded current and previous checkpoints/journals.',
      results
    }
    await writeFile(
      resolve(__dirname, '../../../docs/mux-benchmark.json'),
      JSON.stringify(report, null, 2) + '\n'
    )
  } finally {
    const stopped = new Promise<void>((resolve) => client.once('disconnected', resolve))
    await client.request('server.stop').catch(() => {})
    await stopped
    client.close()
    await rm(home, { recursive: true, force: true, maxRetries: 3 })
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
