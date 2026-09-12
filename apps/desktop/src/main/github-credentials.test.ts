import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitHubCredentialManager, type GitHubCredentials } from './github-credentials'

test('rotates expired credentials once for concurrent requests and persists both tokens', async () => {
  let credentials: GitHubCredentials = {
    accessToken: 'old',
    expiresAt: 0,
    refreshToken: 'refresh-old',
    refreshExpiresAt: Date.now() + 100000
  }
  let calls = 0
  const manager = new GitHubCredentialManager({
    read: () => credentials,
    write: (value) => {
      credentials = value
    },
    refresh: async (token) => {
      assert.equal(token, 'refresh-old')
      calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return {
        access_token: 'new',
        expires_in: 28800,
        refresh_token: 'refresh-new',
        refresh_token_expires_in: 15897600
      }
    }
  })
  assert.deepEqual(await Promise.all([manager.token(), manager.token(), manager.token()]), [
    'new',
    'new',
    'new'
  ])
  assert.equal(calls, 1)
  assert.equal(credentials.refreshToken, 'refresh-new')
  assert.ok(credentials.expiresAt! > Date.now())
  assert.equal(await manager.token(), 'new')
  assert.equal(calls, 1)
})

test('disconnect during rotation cannot restore credentials', async () => {
  let credentials: GitHubCredentials | null = {
    accessToken: 'old',
    expiresAt: 0,
    refreshToken: 'refresh-old'
  }
  let finish!: () => void
  const manager = new GitHubCredentialManager({
    read: () => credentials,
    write: (value) => {
      credentials = value
    },
    refresh: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { access_token: 'new', refresh_token: 'refresh-new' }
    }
  })
  const pending = manager.token()
  manager.reset()
  credentials = null
  finish()
  assert.equal(await pending, null)
  assert.equal(credentials, null)
})

test('legacy/nonexpiring tokens work; expired refresh tokens require reconnect', async () => {
  let credentials: GitHubCredentials = { accessToken: 'legacy' }
  const manager = new GitHubCredentialManager({
    read: () => credentials,
    write: () => assert.fail('must not write'),
    refresh: async () => {
      throw new Error('must not refresh')
    }
  })
  assert.equal(await manager.token(), 'legacy')
  credentials = {
    accessToken: 'expired',
    expiresAt: 0,
    refreshToken: 'expired',
    refreshExpiresAt: 0
  }
  await assert.rejects(manager.token(), /Reconnect/)
})
