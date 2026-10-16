import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspaceChanges } from '@cerebro/core'
import { workspaceDiffStat } from './changed-file-count'

const file = (path: string, additions: number, deletions: number) => ({
  path,
  oldPath: null,
  status: 'modified' as const,
  additions,
  deletions
})

test('sums additions and deletions across every nested repository', () => {
  const changes: WorkspaceChanges = {
    workspaceId: 1,
    groups: [
      {
        repositoryId: 10,
        repositoryName: 'api',
        workspaceId: 2,
        files: [file('src/a.ts', 10, 2), file('src/b.ts', 1, 0)]
      },
      {
        repositoryId: 11,
        repositoryName: 'web',
        workspaceId: 3,
        files: [file('app.tsx', 4, 3)]
      },
      {
        repositoryId: 12,
        repositoryName: 'docs',
        workspaceId: 4,
        files: []
      }
    ]
  }
  assert.deepEqual(workspaceDiffStat(changes), { additions: 15, deletions: 5 })
})

test('keeps a single repository as one stat', () => {
  const changes: WorkspaceChanges = {
    workspaceId: 1,
    groups: [
      {
        repositoryId: 10,
        repositoryName: 'app',
        workspaceId: 1,
        files: [file('README.md', 3, 2)]
      }
    ]
  }
  assert.deepEqual(workspaceDiffStat(changes), { additions: 3, deletions: 2 })
})

test('is zero when the workspace has no line changes', () => {
  assert.deepEqual(workspaceDiffStat(undefined), { additions: 0, deletions: 0 })
  assert.deepEqual(workspaceDiffStat({ workspaceId: 1, groups: [] }), {
    additions: 0,
    deletions: 0
  })
  assert.deepEqual(
    workspaceDiffStat({
      workspaceId: 1,
      groups: [
        {
          repositoryId: 10,
          repositoryName: 'app',
          workspaceId: 1,
          files: [file('empty.txt', 0, 0)]
        }
      ]
    }),
    { additions: 0, deletions: 0 }
  )
})
