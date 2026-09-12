import {
  mkdirSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  openSync,
  closeSync,
  fsyncSync,
  appendFileSync,
  renameSync,
  rmSync,
  existsSync
} from 'node:fs'
import { join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { muxDirectory } from './paths'

const checksum = (value: string): string => createHash('sha256').update(value).digest('hex')
export type Checkpoint = { paneId: number; sequence: number; [key: string]: unknown }
type Manifest = { current: number; previous?: number }
export class TerminalFiles {
  private dirty = new Set<string>()
  private manifests = new Map<number, Manifest>()
  private dir(id: number): string {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid terminal ID.')
    const dir = join(muxDirectory(), 'terminals', String(id))
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  }
  private atomic(path: string, value: unknown): void {
    const fd = openSync(`${path}.tmp`, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(value))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(`${path}.tmp`, path)
    // Windows does not support opening directories for fsync.
    if (process.platform !== 'win32') {
      const parent = openSync(join(path, '..'), 'r')
      try {
        fsyncSync(parent)
      } finally {
        closeSync(parent)
      }
    }
  }
  checkpoint(snapshot: Checkpoint): void {
    const dir = this.dir(snapshot.paneId)
    const old = this.manifests.get(snapshot.paneId)
    const generation = (old?.current ?? 0) + 1
    const data = JSON.stringify(snapshot)
    this.atomic(join(dir, `${generation}.snapshot`), { data, checksum: checksum(data) })
    const journal = join(dir, `${generation}.journal`)
    const fd = openSync(journal, 'w', 0o600)
    fsyncSync(fd)
    closeSync(fd)
    const manifest = { current: generation, previous: old?.current }
    this.atomic(join(dir, 'manifest.json'), manifest)
    this.manifests.set(snapshot.paneId, manifest)
    for (const name of readdirSync(dir)) {
      const match = /^(\d+)\.(snapshot|journal)(?:\.tmp)?$/.exec(name)
      if (
        match &&
        Number(match[1]) !== manifest.current &&
        Number(match[1]) !== manifest.previous
      ) {
        const path = join(dir, name)
        this.dirty.delete(path)
        rmSync(path, { force: true })
      }
    }
  }
  prune(paneIds: number[]): void {
    const root = join(muxDirectory(), 'terminals')
    if (!existsSync(root)) return
    const retained = new Set(paneIds)
    for (const name of readdirSync(root))
      if (/^\d+$/.test(name) && !retained.has(Number(name))) this.remove(Number(name))
  }

  append(paneId: number, event: unknown): void {
    const manifest = this.manifests.get(paneId)
    if (!manifest) throw new Error('Terminal has no checkpoint.')
    const path = join(this.dir(paneId), `${manifest.current}.journal`)
    const data = JSON.stringify(event)
    appendFileSync(path, JSON.stringify({ data, checksum: checksum(data) }) + '\n', { mode: 0o600 })
    this.dirty.add(path)
  }
  flush(): void {
    for (const path of this.dirty) {
      if (existsSync(path)) {
        const fd = openSync(path, 'r+')
        try {
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      }
      this.dirty.delete(path)
    }
  }
  load(paneId: number): { snapshot: Checkpoint; events: unknown[] } | null {
    const dir = this.dir(paneId)
    const path = join(dir, 'manifest.json')
    if (!existsSync(path)) return null
    const manifest: Manifest = JSON.parse(readFileSync(path, 'utf8'))
    this.manifests.set(paneId, manifest)
    let lastError: unknown
    for (const generation of [manifest.current, manifest.previous]) {
      if (!generation) continue
      try {
        const saved = JSON.parse(readFileSync(join(dir, `${generation}.snapshot`), 'utf8'))
        if (checksum(saved.data) !== saved.checksum) throw new Error('Invalid snapshot checksum.')
        const snapshot = JSON.parse(saved.data) as Checkpoint
        const events: unknown[] = []
        for (const journal of generation === manifest.current
          ? [generation]
          : [generation, manifest.current]) {
          const file = join(dir, `${journal}.journal`)
          if (!existsSync(file)) continue
          const lines = readFileSync(file, 'utf8').split('\n')
          lines.pop()
          for (const line of lines) {
            try {
              const record = JSON.parse(line)
              if (checksum(record.data) !== record.checksum) break
              const event = JSON.parse(record.data)
              if (event.sequence > snapshot.sequence) events.push(event)
            } catch {
              break
            }
          }
        }
        const continuation = snapshot.continuation as { version?: number } | undefined
        if (continuation?.version === 1) this.backupLegacy(dir)
        return { snapshot, events }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  private backupLegacy(dir: string): void {
    const destination = join(dir, 'xterm-5.5-backup')
    if (existsSync(destination)) return
    const temporary = `${destination}.tmp`
    rmSync(temporary, { recursive: true, force: true })
    mkdirSync(temporary, { mode: 0o700 })
    for (const name of readdirSync(dir)) {
      if (name === 'manifest.json' || /^\d+\.(snapshot|journal)$/.test(name)) {
        const target = join(temporary, name)
        copyFileSync(join(dir, name), target)
        const fd = openSync(target, 'r')
        try {
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      }
    }
    renameSync(temporary, destination)
    if (process.platform !== 'win32') {
      const fd = openSync(dir, 'r')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    }
  }
  remove(paneId: number): void {
    const dir = this.dir(paneId)
    for (const path of this.dirty) if (path.startsWith(dir + sep)) this.dirty.delete(path)
    this.manifests.delete(paneId)
    rmSync(dir, { recursive: true, force: true })
  }
}
