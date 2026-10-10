import { DatabaseSync } from 'node:sqlite'
import { appendFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { muxDirectory, socketPath } from './paths'

/** A host that claimed ownership this recently may still be starting up before it listens. */
const STARTUP_GRACE_MS = 30_000

function open(): DatabaseSync {
  const db = new DatabaseSync(join(muxDirectory(), 'ownership.sqlite'))
  // `claim` is a separate table so older hosts, which write `owner` positionally, keep working.
  db.exec(
    'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS claim (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, at INTEGER NOT NULL)'
  )
  return db
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function reachable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const done = (value: boolean): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(1000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** SQLite serializes crash recovery elections; unlinking a stale PID file races
 * another recovering client. This tiny lock database never stores user content.
 *
 * A recorded PID that is still alive is not proof of a live host: after a reboot or
 * crash the PID can belong to an unrelated process. Such an owner only blocks this
 * host while it is starting up or its socket accepts connections. */
export async function claimServer(): Promise<boolean> {
  const read = (db: DatabaseSync): { pid: number; at?: number } | undefined =>
    db
      .prepare(
        'SELECT owner.pid AS pid, claim.at AS at FROM owner LEFT JOIN claim ON claim.id=1 AND claim.pid=owner.pid WHERE owner.id=1'
      )
      .get() as { pid: number; at?: number } | undefined
  let stale: number | undefined
  const db = open()
  try {
    const owner = read(db)
    if (owner && owner.pid !== process.pid && alive(owner.pid)) {
      if (typeof owner.at === 'number' && Date.now() - owner.at < STARTUP_GRACE_MS) return false
      if (await reachable(socketPath())) return false
      stale = owner.pid
    }
    db.exec('BEGIN IMMEDIATE')
    const current = read(db)
    // Another host claimed between the check and the transaction: let it win.
    if (current && current.pid !== stale && current.pid !== process.pid && alive(current.pid)) {
      db.exec('ROLLBACK')
      return false
    }
    db.prepare('INSERT OR REPLACE INTO owner VALUES (1, ?)').run(process.pid)
    db.prepare('INSERT OR REPLACE INTO claim VALUES (1, ?, ?)').run(process.pid, Date.now())
    db.exec('COMMIT')
  } finally {
    db.close()
  }
  if (stale !== undefined) {
    try {
      appendFileSync(
        join(muxDirectory(), 'server.log'),
        `${new Date().toISOString()} Replaced stale mux owner PID ${stale}: its socket was unreachable.\n`,
        { mode: 0o600 }
      )
    } catch {
      /* Logging is best-effort. */
    }
  }
  return true
}

export function releaseServer(): void {
  const db = open()
  try {
    db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid)
    db.prepare('DELETE FROM claim WHERE id=1 AND pid=?').run(process.pid)
  } finally {
    db.close()
  }
}
