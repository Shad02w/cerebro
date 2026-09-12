import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getReleaseIdentity } from '../shared/release-identity'

// Packaged channel metadata is immutable at runtime and independent of NODE_ENV.
const metadata = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
export const appIdentity = getReleaseIdentity(
  app.isPackaged ? (metadata.cerebroChannel ?? 'production') : 'dev'
)

if (app.isPackaged) {
  app.setName(appIdentity.productName)
  if (appIdentity.channel === 'dev' && !process.env.CEREBRO_HOME?.trim()) {
    process.env.CEREBRO_HOME = join(homedir(), appIdentity.dataDirectory)
  }
}
