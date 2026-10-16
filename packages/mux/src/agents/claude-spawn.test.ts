import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { spawnClaudeProcess } from './claude-spawn'

test(
  'Claude is spawned outside the mux process group',
  { skip: process.platform === 'win32' },
  () => {
    const child = spawnClaudeProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd: process.cwd(),
      env: process.env,
      signal: new AbortController().signal
    }) as ReturnType<typeof spawnClaudeProcess> & { pid?: number }
    try {
      assert.ok(child.pid)
      const pgid = Number(
        execFileSync('ps', ['-o', 'pgid=', '-p', String(child.pid)], { encoding: 'utf8' })
      )
      assert.equal(pgid, child.pid)
    } finally {
      child.kill('SIGKILL')
    }
  }
)
