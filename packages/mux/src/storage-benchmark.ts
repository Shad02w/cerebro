/** Storage-only comparison: identical checked records and durable 256 KiB batches. */
import { DatabaseSync } from 'node:sqlite'
import {
  mkdtempSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  rmSync,
  writeFileSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'

const root = mkdtempSync(join(tmpdir(), 'cerebro-storage-benchmark-'))
try {
  const data = JSON.stringify({ sequence: 1, type: 'data', data: 'x'.repeat(2048) })
  const record =
    JSON.stringify({ data, checksum: createHash('sha256').update(data).digest('hex') }) + '\n'
  const count = 128,
    batches = 40
  const file = join(root, 'journal')
  const fd = openSync(file, 'w', 0o600)
  const fileTimes: number[] = []
  try {
    for (let i = 0; i < batches; i++) {
      const start = performance.now()
      for (let j = 0; j < count; j++) writeSync(fd, record)
      fsyncSync(fd)
      fileTimes.push(performance.now() - start)
    }
  } finally {
    closeSync(fd)
  }
  const database = join(root, 'output.sqlite')
  const db = new DatabaseSync(database)
  const sqliteTimes: number[] = []
  try {
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE output (id INTEGER PRIMARY KEY, data TEXT NOT NULL)'
    )
    const insert = db.prepare('INSERT INTO output(data) VALUES (?)')
    for (let i = 0; i < batches; i++) {
      const start = performance.now()
      db.exec('BEGIN IMMEDIATE')
      for (let j = 0; j < count; j++) insert.run(record)
      db.exec('COMMIT')
      sqliteTimes.push(performance.now() - start)
    }
  } finally {
    db.close()
  }
  const summary = (values: number[]): { p50: number; p95: number } => {
    values.sort((a, b) => a - b)
    return {
      p50: Number(values[Math.floor(values.length * 0.5)].toFixed(3)),
      p95: Number(values[Math.floor(values.length * 0.95)].toFixed(3))
    }
  }
  const result = {
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    batches,
    recordsPerBatch: count,
    bytesPerRecord: Buffer.byteLength(record),
    file: { durableBatchMs: summary(fileTimes), bytes: statSync(file).size },
    sqlite: { durableBatchMs: summary(sqliteTimes), bytes: statSync(database).size },
    notes:
      'Storage-only microbenchmark, no VT parsing or recovery snapshots. Both sync each identical batch; this tests burst cost of the one-second durability policy, not elapsed one-second intervals. SQLite uses WAL/FULL and includes automatic checkpoint costs.'
  }
  writeFileSync(
    resolve(__dirname, '../../../docs/mux-storage-benchmark.json'),
    JSON.stringify(result, null, 2) + '\n'
  )
  console.log(JSON.stringify(result))
} finally {
  rmSync(root, { recursive: true, force: true })
}
