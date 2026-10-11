import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeShellEnv, parseShellEnv, resolveShellEnv } from './shell-env'

const MARK = '__CEREBRO_SHELL_ENV__'

async function fakeShell(body: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'cerebro-shell-env-'))
  const path = join(dir, 'shell')
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('parseShellEnv reads the JSON between markers and ignores profile output', () => {
  const output = `Welcome!\n${MARK}${JSON.stringify({ PATH: '/a:/b', COUNT: 1 })}\n${MARK}bye`
  assert.deepEqual(parseShellEnv(output), { PATH: '/a:/b' })
})

test('parseShellEnv rejects missing markers and invalid JSON', () => {
  assert.equal(parseShellEnv('no markers'), undefined)
  assert.equal(parseShellEnv(`${MARK}{"PATH":`), undefined)
  assert.equal(parseShellEnv(`${MARK}not json${MARK}`), undefined)
  assert.equal(parseShellEnv(`${MARK}[]${MARK}`), undefined)
})

test('mergeShellEnv keeps Cerebro routing and drops shell bookkeeping', () => {
  const env = mergeShellEnv(
    { PATH: '/usr/bin', CEREBRO_HOME: '/home/cerebro', KEEP: 'base' },
    {
      PATH: '/opt/homebrew/bin:/usr/bin',
      CEREBRO_HOME: '/elsewhere',
      ELECTRON_RUN_AS_NODE: '1',
      PWD: '/tmp',
      SHLVL: '2',
      _: '/usr/bin/env',
      EDITOR: 'nvim'
    }
  )
  assert.deepEqual(env, {
    PATH: '/opt/homebrew/bin:/usr/bin',
    CEREBRO_HOME: '/home/cerebro',
    KEEP: 'base',
    EDITOR: 'nvim'
  })
})

test(
  'resolveShellEnv returns what the login shell exports',
  { skip: process.platform === 'win32' },
  async () => {
    const shell = await fakeShell(
      [
        'echo "profile banner"',
        'export FROM_PROFILE=yes',
        'export PATH="/opt/fake/bin:$PATH"',
        'export CEREBRO_HOME=/wrong',
        'eval "$4"'
      ].join('\n')
    )
    try {
      const env = await resolveShellEnv(shell.path)
      assert.ok(env)
      assert.equal(env.FROM_PROFILE, 'yes')
      assert.ok(env.PATH?.startsWith('/opt/fake/bin:'))
      assert.equal(env.CEREBRO_HOME, process.env.CEREBRO_HOME)
      assert.equal(env.ELECTRON_RUN_AS_NODE, process.env.ELECTRON_RUN_AS_NODE)
    } finally {
      await shell.cleanup()
    }
  }
)

test(
  'resolveShellEnv falls back when the shell is missing, fails, or hangs',
  { skip: process.platform === 'win32' },
  async () => {
    assert.equal(await resolveShellEnv('/nonexistent/cerebro-shell'), undefined)
    const failing = await fakeShell('exit 1')
    const hanging = await fakeShell('sleep 5')
    try {
      assert.equal(await resolveShellEnv(failing.path), undefined)
      assert.equal(await resolveShellEnv(hanging.path, 200), undefined)
    } finally {
      await failing.cleanup()
      await hanging.cleanup()
    }
  }
)
