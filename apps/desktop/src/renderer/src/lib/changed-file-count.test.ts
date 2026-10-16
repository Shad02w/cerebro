import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspaceChanges } from '@cerebro/core'
import { changedFileCount, changedFileRows } from './changed-file-count'

const file = (path: string) => ({ path, oldPath: null, status: 'modified' as const })

test('sums changed files across every nested repository', () => {
  const changes: WorkspaceChanges = {
    workspaceId: 1,
    groups: [
      {
        repositoryId: 10,
        repositoryName: 'api',
        workspaceId: 2,
        files: [file('src/a.ts'), file('src/b.ts')]
      },
      {
        repositoryId: 11,
        repositoryName: 'web',
        workspaceId: 3,
        files: [file('app.tsx')]
      },
      {
        repositoryId: 12,
        repositoryName: 'docs',
        workspaceId: 4,
        files: []
      }
    ]
  }
  assert.equal(changedFileCount(changes), 3)
  assert.deepEqual(
    changedFileRows(changes).map((row) => row.label),
    ['api/src/a.ts', 'api/src/b.ts', 'web/app.tsx']
  )
})

test('counts a single repository without a repo prefix', () => {
  const changes: WorkspaceChanges = {
    workspaceId: 1,
    groups: [
      {
        repositoryId: 10,
        repositoryName: 'app',
        workspaceId: 1,
        files: [file('README.md')]
      }
    ]
  }
  assert.equal(changedFileCount(changes), 1)
  assert.deepEqual(changedFileRows(changes), [{ id: '10:README.md', label: 'README.md' }])
})

test('is zero when the workspace has no changes', () => {
  assert.equal(changedFileCount(undefined), 0)
  assert.deepEqual(changedFileRows(undefined), [])
  assert.equal(changedFileCount({ workspaceId: 1, groups: [] }), 0)
})
