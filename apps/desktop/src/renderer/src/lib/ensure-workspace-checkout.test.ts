import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Project, ProjectListResult } from '@shared/types'
import { ensureWorkspaceForCheckout } from './ensure-workspace-checkout'

function listed(projects: Project[], activeWorkspaceId: number | null = null): ProjectListResult {
  return { projects, activeWorkspaceId }
}

function projectAt(id: number, localPath: string): Project {
  return { workspaces: [{ id, localPath }] } as Project
}

function install(cerebro: {
  listProjects: () => Promise<ProjectListResult>
  createProjectFromDirectory: (directory: string) => Promise<Project>
}): void {
  Object.assign(globalThis, { window: { cerebro } })
}

test('returns the workspace already registered for the checkout', async () => {
  let created = 0
  install({
    listProjects: async () => listed([projectAt(7, '/apps/backend')]),
    createProjectFromDirectory: async () => {
      created += 1
      return projectAt(8, '/apps/backend')
    }
  })

  assert.equal(await ensureWorkspaceForCheckout('/apps/backend'), 7)
  assert.equal(created, 0)
})

test('registers a checkout that is not a workspace yet', async () => {
  const calls: string[] = []
  install({
    listProjects: async () => listed([]),
    createProjectFromDirectory: async (directory) => {
      calls.push(directory)
      return projectAt(9, directory)
    }
  })

  assert.equal(await ensureWorkspaceForCheckout('/apps/frontend'), 9)
  assert.deepEqual(calls, ['/apps/frontend'])
})

test('shares one registration when the same checkout is opened twice at once', async () => {
  let creates = 0
  let release: (() => void) | null = null
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  install({
    listProjects: async () => listed([]),
    createProjectFromDirectory: async (directory) => {
      creates += 1
      await gate
      return projectAt(4, directory)
    }
  })

  const first = ensureWorkspaceForCheckout('/apps/api')
  const second = ensureWorkspaceForCheckout('/apps/api/')
  release?.()
  assert.equal(await first, 4)
  assert.equal(await second, 4)
  assert.equal(creates, 1)
})

test('reads the workspace again when registration reports it is already added', async () => {
  let lists = 0
  install({
    listProjects: async () => {
      lists += 1
      return lists === 1 ? listed([]) : listed([projectAt(3, '/apps/web')])
    },
    createProjectFromDirectory: async () => {
      throw new Error('already added')
    }
  })

  assert.equal(await ensureWorkspaceForCheckout('/apps/web'), 3)
  assert.equal(lists, 2)
})
