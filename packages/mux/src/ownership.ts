import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { muxDirectory } from './paths'

/** SQLite serializes crash recovery elections; unlinking a stale PID file races
 * another recovering client. This tiny lock database never stores user content. */
export function claimServer(): boolean {
  const db = new DatabaseSync(join(muxDirectory(), 'ownership.sqlite'))
  try {
    db.exec(
      'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL); BEGIN IMMEDIATE'
    )
    const previous = db.prepare('SELECT pid FROM owner WHERE id=1').get() as
      { pid: number } | undefined
    if (previous) {
      try {
        process.kill(previous.pid, 0)
        db.exec('ROLLBACK')
        return false
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          db.exec('ROLLBACK')
          return false
        }
      }
    }
    db.prepare('INSERT OR REPLACE INTO owner VALUES (1, ?)').run(process.pid)
    db.exec('COMMIT')
    return true
  } finally {
    db.close()
  }
}

export function releaseServer(): void {
  const db = new DatabaseSync(join(muxDirectory(), 'ownership.sqlite'))
  try {
    db.exec('PRAGMA busy_timeout=5000')
    db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid)
  } finally {
    db.close()
  }
}
