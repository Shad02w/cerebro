import { createHash } from 'node:crypto'
import { getCerebroHome, getDatabasePath } from '@cerebro/core'
import { realpathSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir, userInfo } from 'node:os'
export function home(): string {
  return resolve(getCerebroHome())
}
export function muxDirectory(): string {
  return join(home(), 'mux')
}
export function socketPath(): string {
  const root = existsSync(home()) ? realpathSync(home()) : home()
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 24)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\cerebro-${userInfo().username}-${hash}`
    : join(tmpdir(), `cerebro-${process.getuid?.() ?? 'user'}-${hash}.sock`)
}
export function databasePath(): string {
  return resolve(getDatabasePath())
}
