import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession } from '@cerebro/core'
import { SessionSearchIndex, sessionSnippet, tokenize } from './search-index'

function session(patch: Partial<AgentSession> & Pick<AgentSession, 'id' | 'title'>): AgentSession {
  return {
    version: 1,
    workspaceId: 1,
    repositoryId: null,
    cwd: '/tmp',
    model: {
      key: 'test',
      instance: 'local',
      harness: 'codex',
      provider: 'test',
      id: 'test',
      label: 'Test Model',
      source: 'native',
      available: true,
      reasoning: []
    },
    status: 'idle',
    generation: '',
    sequence: 1,
    updatedAt: 1,
    items: [],
    commands: [],
    ...patch
  }
}

test('tokenize keeps words of two or more characters', () => {
  assert.deepEqual(tokenize('Fix the login'), ['fix', 'the', 'login'])
  assert.deepEqual(tokenize('a'), [])
  assert.deepEqual(tokenize('Log-in, please'), ['log', 'in', 'please'])
})

test('prefix matches a word stem and a mid-token substring does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerebro-search-'))
  const index = SessionSearchIndex.open(join(dir, 'search.sqlite'))
  try {
    index.upsert(
      session({
        id: 'body',
        title: 'Notes',
        updatedAt: 10,
        items: [
          {
            id: 'u',
            turnId: 't',
            kind: 'user',
            text: 'Please fix the login form'
          }
        ]
      })
    )
    index.upsert(
      session({
        id: 'title',
        title: 'Login outage',
        updatedAt: 5,
        items: [{ id: 'u', turnId: 't', kind: 'user', text: 'Nothing about the form' }]
      })
    )
    assert.deepEqual(index.rank('log', [1]), ['title', 'body'])
    assert.deepEqual(index.rank('ogin', [1]), [])
    assert.deepEqual(index.rank('fix login', [1]), ['body'])
    assert.deepEqual(index.rank('a', [1]), [])
    assert.deepEqual(index.rank('', [1]), ['body', 'title'])
    assert.deepEqual(index.rank('login', [2]), [])
    const hit = session({
      id: 'body',
      title: 'Notes',
      items: [
        { id: 'u', turnId: 't', kind: 'tool', text: 'Please fix the login form before shipping' }
      ]
    })
    assert.match(sessionSnippet(hit, 'log'), /login form/)
    assert.equal(sessionSnippet(hit, 'ogin'), 'Notes')
  } finally {
    index.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
