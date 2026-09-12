import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Run before storage and mux initialization. Packaged builds retain ~/cerebro.
// Explicit home and database overrides continue to take precedence.
if (!app.isPackaged && !process.env.CEREBRO_HOME?.trim()) {
  process.env.CEREBRO_HOME = join(homedir(), 'cerebro-dev')
}
