import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2).filter((arg) => arg !== '--')

function allowsUnfiltered(argv) {
  if (process.env.CI === 'true' || process.env.CEREBRO_E2E_ALL === '1') return true
  return argv.some((arg) => arg === '--list' || arg === '--help' || arg === '-h')
}

function hasScope(argv) {
  return argv.some((arg, index) => {
    if (arg === '--grep' || arg === '-g') return Boolean(argv[index + 1])
    if (arg.startsWith('--grep=')) return arg.length > '--grep='.length
    return !arg.startsWith('-')
  })
}

if (!allowsUnfiltered(args) && !hasScope(args)) {
  console.error(`Refusing to run the full Electron e2e suite locally.
Pass the spec files for the flow you changed, for example:
  pnpm --filter desktop test:e2e smoke.spec.ts

The full suite runs on CI. To override locally: CEREBRO_E2E_ALL=1`)
  process.exit(2)
}

const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js')
const child = spawn(process.execPath, [cli, 'test', ...args], { stdio: 'inherit' })

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
