import { access, mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  _electron as electron
} from '@playwright/test'
import { electronAppArgs } from './fixtures'
import { startMockGitHubServer, type MockGitHubServer } from './mock-github'

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, '..')
const require = createRequire(path.join(desktopRoot, 'package.json'))
const electronBinary = require('electron') as unknown as string
const mainEntry = path.join(desktopRoot, 'out/main/index.js')

const GITHUB_CLONE_URL = 'https://github.com/octocat/hello-world.git'

type ProjectGitHubFixtures = {
  ghAvailable: boolean
  fakeGh: string

  githubMock: MockGitHubServer
  localRemote: string
  electronApp: ElectronApplication
  page: Page
}

async function initRepoWithBranches(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro E2E'], { cwd: dir })
  await writeFile(path.join(dir, 'README.md'), 'hello-world main\n')
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init main'], { cwd: dir })

  for (const branch of ['feature/review', 'feature/conflict', 'feature/closed']) {
    await execFileAsync('git', ['checkout', '-b', branch], { cwd: dir })
    await writeFile(path.join(dir, 'README.md'), `hello-world ${branch}\n`)
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-m', `init ${branch}`], { cwd: dir })
    await execFileAsync('git', ['checkout', 'main'], { cwd: dir })
  }
}

export const test = base.extend<ProjectGitHubFixtures>({
  ghAvailable: [false, { option: true }],
  fakeGh: async ({ ghAvailable }, use) => {
    if (!ghAvailable) {
      await use('')
      return
    }
    const root = await mkdtemp(path.join(tmpdir(), 'cerebro-fake-gh-'))
    const binary = path.join(root, 'gh')
    const node = {
      ...mainPr({ isDraft: true }),
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
      headRepository: { nameWithOwner: 'octocat/hello-world' },
      repository: { nameWithOwner: 'octocat/hello-world' }
    }
    const response = {
      data: {
        repository: {
          pullRequests: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } }
        }
      }
    }
    await writeFile(
      binary,
      `#!/usr/bin/env node
if(process.argv.includes('graphql')) { process.stdout.write(${JSON.stringify(JSON.stringify(response))}); }
else if(process.argv.includes('--paginate')) process.stdout.write('main\\nfeature/review\\nfeature/conflict\\nfeature/closed');
else if(process.argv.includes('status')) process.stdout.write('Logged in');
else process.exit(1);
`,
      { mode: 0o755 }
    )
    await use(binary)
    await rm(root, { recursive: true, force: true })
  },
  githubMock: async ({}, use) => {
    const mock = await startMockGitHubServer()
    mock.setPullRequests('octocat', 'hello-world', [
      {
        number: 1,
        title: 'Improve main docs',
        url: 'https://github.com/octocat/hello-world/pull/1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        headRefName: 'main',
        repoFullName: 'octocat/hello-world'
      },
      {
        number: 2,
        title: 'Review feedback branch',
        url: 'https://github.com/octocat/hello-world/pull/2',
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-03T00:00:00Z',
        state: 'OPEN',
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'MERGEABLE',
        headRefName: 'feature/review',
        repoFullName: 'octocat/hello-world'
      },
      {
        number: 3,
        title: 'Conflicted feature',
        url: 'https://github.com/octocat/hello-world/pull/3',
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-03T00:00:00Z',
        state: 'OPEN',
        reviewDecision: null,
        mergeable: 'CONFLICTING',
        headRefName: 'feature/conflict',
        repoFullName: 'octocat/hello-world'
      },
      {
        number: 4,
        title: 'Closed experiment',
        url: 'https://github.com/octocat/hello-world/pull/4',
        createdAt: '2024-04-01T00:00:00Z',
        updatedAt: '2024-04-03T00:00:00Z',
        state: 'CLOSED',
        reviewDecision: null,
        mergeable: 'UNKNOWN',
        headRefName: 'feature/closed',
        repoFullName: 'octocat/hello-world'
      }
    ])
    await use(mock)
    await mock.close()
  },

  localRemote: async ({}, use) => {
    const root = await mkdtemp(path.join(tmpdir(), 'cerebro-gh-remote-'))
    const working = path.join(root, 'working')
    const bare = path.join(root, 'hello-world.git')
    await initRepoWithBranches(working)
    await execFileAsync('git', ['clone', '--bare', working, bare])
    await use(bare)
    await rm(root, { recursive: true, force: true })
  },

  electronApp: async ({ githubMock, localRemote, fakeGh }, use) => {
    try {
      await access(mainEntry)
    } catch {
      throw new Error(
        'Desktop app is not built. Run `pnpm --filter desktop build`, then `pnpm --filter desktop test:e2e:repeat projects-github.spec.ts`.'
      )
    }

    const cerebroHome = await mkdtemp(path.join(tmpdir(), 'cerebro-projects-gh-e2e-'))
    const userDataDir = path.join(cerebroHome, 'user-data')
    const urlMap = JSON.stringify({
      [GITHUB_CLONE_URL]: `file://${localRemote}`,
      'https://github.com/octocat/hello-world': `file://${localRemote}`
    })

    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: electronAppArgs(userDataDir),
      cwd: desktopRoot,
      timeout: 60_000,
      env: {
        ...env,
        NODE_ENV: 'test',
        CEREBRO_HOME: cerebroHome,
        CEREBRO_GITHUB_CLIENT_ID: 'cerebro-e2e-client',
        CEREBRO_GITHUB_LOGIN_URL: githubMock.baseUrl,
        CEREBRO_GITHUB_API_URL: githubMock.baseUrl,
        CEREBRO_E2E_GIT_URL_MAP: urlMap,
        CEREBRO_E2E_GH_PATH: fakeGh
      }
    })

    await use(electronApp)
    await electronApp.close()
    await rm(cerebroHome, { recursive: true, force: true })
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect }

async function chooseBranch(page: Page, testId: string, branch: string): Promise<void> {
  await page.getByTestId(testId).click()
  const search = page.getByTestId(`${testId}-search`)
  await expect(search).toBeVisible()
  await search.fill(branch)
  await page.getByRole('option', { name: branch, exact: true }).click()
}

async function connectGitHub(page: Page, githubMock: MockGitHubServer): Promise<void> {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-nav-integrations').click()
  await page.getByTestId('github-connect').click()
  await expect(page.getByTestId('github-user-code')).toBeVisible()
  githubMock.authorize()
  await expect(page.getByTestId('github-connected')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Back' }).click()
}

test('GitHub-linked project shows PR state and can create worktree workspaces', async ({
  page,
  githubMock
}) => {
  await connectGitHub(page, githubMock)

  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByLabel('Git URL').fill(GITHUB_CLONE_URL)
  await page.getByRole('button', { name: 'Clone repository' }).click()

  await expect(page.getByTestId(/project-row-/).filter({ hasText: 'hello-world' })).toBeVisible({
    timeout: 60_000
  })

  const projectMeta = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    return {
      projectId: project?.id ?? null,
      activeWorkspaceId: listed.activeWorkspaceId,
      workspaces: project?.workspaces.map((workspace) => ({
        id: workspace.id,
        branch: workspace.branch,
        kind: workspace.kind
      }))
    }
  })

  expect(projectMeta.projectId).not.toBeNull()
  expect(projectMeta.workspaces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        branch: 'main',
        kind: 'default'
      })
    ])
  )

  const defaultWorkspace = projectMeta.workspaces?.find((workspace) => workspace.branch === 'main')
  expect(defaultWorkspace).toBeTruthy()

  const addWorkspace = page.getByTestId(`project-add-workspace-${projectMeta.projectId}`)
  await expect(addWorkspace).toBeVisible()
  await addWorkspace.hover()
  await expect(page.getByRole('tooltip', { name: 'Add workspace' })).toBeVisible()
  await expect(page.getByTestId(`workspace-pr-icon-${defaultWorkspace!.id}`)).toHaveAttribute(
    'data-pr-state',
    'approved'
  )

  // Collapse / expand project row
  await page.getByTestId(`project-row-${projectMeta.projectId}`).click()
  await expect(page.getByTestId(`workspace-row-${defaultWorkspace!.id}`)).toBeHidden()
  await page.getByTestId(`project-row-${projectMeta.projectId}`).click()
  await expect(page.getByTestId(`workspace-row-${defaultWorkspace!.id}`)).toBeVisible()

  await page.getByTestId(`workspace-pr-icon-${defaultWorkspace!.id}`).click()
  const popover = page.getByTestId(`workspace-pr-popover-${defaultWorkspace!.id}`)
  await expect(popover).toBeVisible()
  await expect(page.getByTestId(`workspace-pr-title-${defaultWorkspace!.id}`)).toHaveText(
    'Improve main docs'
  )
  await expect(popover).toContainText('octocat/hello-world')
  await expect(popover).toContainText('Review: Approved')
  await page.keyboard.press('Escape')

  await page.getByTestId(`project-add-workspace-${projectMeta.projectId}`).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add workspace' })).toBeVisible()
  await expect(page.getByTestId('workspace-mode-existing')).toBeVisible()
  await expect(page.getByTestId('workspace-mode-new')).toBeVisible()
  await expect(
    page.getByTestId('workspace-branch-skeleton').or(page.getByTestId('workspace-branch-select'))
  ).toBeVisible()
  await expect(page.getByTestId('workspace-branch-select')).toBeVisible({ timeout: 30_000 })

  const branchPicker = page.getByTestId('workspace-branch-select')
  await branchPicker.click()
  const branchSearch = page.getByTestId('workspace-branch-select-search')
  await branchSearch.press('ArrowDown')
  await branchSearch.fill('feature/review')
  await expect(page.getByRole('option', { name: 'feature/review', exact: true })).toHaveAttribute(
    'data-highlighted',
    'true'
  )
  await branchSearch.press('Enter')
  await expect(branchPicker).toHaveText('feature/review')
  // Reopening clears the filter and starts keyboard navigation at the first result.
  await branchPicker.click()
  await expect(branchSearch).toHaveValue('')
  await expect(page.getByRole('option').first()).toHaveAttribute('data-highlighted', 'true')
  await branchSearch.press('Escape')
  await chooseBranch(page, 'workspace-branch-select', 'feature/review')
  await dialog.getByRole('button', { name: 'Create workspace' }).click()

  await expect(
    page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/review' })
  ).toBeVisible({
    timeout: 60_000
  })

  const afterCreate = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    const review = project?.workspaces.find((workspace) => workspace.branch === 'feature/review')
    return {
      activeWorkspaceId: listed.activeWorkspaceId,
      review
    }
  })

  expect(afterCreate.review).toBeTruthy()
  expect(afterCreate.activeWorkspaceId).toBe(afterCreate.review!.id)

  await expect(page.getByTestId(`workspace-pr-icon-${afterCreate.review!.id}`)).toHaveAttribute(
    'data-pr-state',
    'changes_requested'
  )
  await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

  await page.getByTestId(`workspace-pr-icon-${afterCreate.review!.id}`).click()
  await expect(page.getByTestId(`workspace-pr-title-${afterCreate.review!.id}`)).toHaveText(
    'Review feedback branch'
  )
  await expect(page.getByTestId(`workspace-pr-popover-${afterCreate.review!.id}`)).toContainText(
    'Changes requested'
  )
  await page.keyboard.press('Escape')

  await page.getByTestId(`project-row-${projectMeta.projectId}`).hover()
  await page.getByTestId(`project-add-workspace-${projectMeta.projectId}`).click()
  await expect(page.getByTestId('workspace-mode-new')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('workspace-mode-new').click()
  await expect(page.getByTestId('workspace-new-branch-input')).toBeVisible()
  const createFromBase = page.getByRole('dialog').getByRole('button', { name: 'Create workspace' })
  await expect(createFromBase).toBeEnabled()
  await createFromBase.click()
  await expect(page.getByRole('dialog').getByText('Enter a new branch name.')).toBeVisible()
  await expect(createFromBase).toBeEnabled()
  await page.getByTestId('workspace-new-branch-input').fill('feature/from-main')
  await expect(page.getByTestId('workspace-from-select')).toContainText('main')
  await createFromBase.click()
  await expect(
    page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/from-main' })
  ).toBeVisible({
    timeout: 60_000
  })

  const fromMain = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    return project?.workspaces.find((workspace) => workspace.branch === 'feature/from-main') ?? null
  })
  expect(fromMain?.kind).toBe('worktree')
  expect(fromMain?.id).toBeTruthy()
})

test('can delete worktrees and remove projects from the app', async ({ page, githubMock }) => {
  await connectGitHub(page, githubMock)

  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByLabel('Git URL').fill(GITHUB_CLONE_URL)
  await page.getByRole('button', { name: 'Clone repository' }).click()

  await expect(page.getByTestId(/project-row-/).filter({ hasText: 'hello-world' })).toBeVisible({
    timeout: 60_000
  })

  const projectMeta = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    const defaultWorkspace = project?.workspaces.find((workspace) => workspace.kind === 'default')
    return {
      projectId: project?.id ?? null,
      defaultWorkspaceId: defaultWorkspace?.id ?? null,
      clonePath: project?.repositories[0]?.localPath ?? null
    }
  })
  expect(projectMeta.projectId).not.toBeNull()
  expect(projectMeta.defaultWorkspaceId).not.toBeNull()
  expect(projectMeta.clonePath).not.toBeNull()

  // Default workspace: Delete / Remove from app are disabled with guidance tooltip.
  await page.getByTestId(`workspace-row-${projectMeta.defaultWorkspaceId}`).hover()
  await page.getByTestId(`workspace-menu-${projectMeta.defaultWorkspaceId}`).click()
  const defaultDelete = page.getByTestId(`workspace-delete-${projectMeta.defaultWorkspaceId}`)
  await expect(defaultDelete).toBeVisible()
  await expect(defaultDelete.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
  await defaultDelete.hover()
  await expect(
    page.getByText("Default workspace — can't be deleted. Remove the project instead.")
  ).toBeVisible()
  // Toggle the same trigger closed (Escape is consumed by the tooltip).
  await page.getByTestId(`workspace-menu-${projectMeta.defaultWorkspaceId}`).click()
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Create a worktree to delete.
  await page.getByTestId(`project-row-${projectMeta.projectId}`).hover()
  await page.getByTestId(`project-add-workspace-${projectMeta.projectId}`).click()
  const dialog = page.getByRole('dialog')
  await expect(page.getByTestId('workspace-branch-select')).toBeVisible({ timeout: 30_000 })
  await chooseBranch(page, 'workspace-branch-select', 'feature/review')
  await dialog.getByRole('button', { name: 'Create workspace' }).click()
  await expect(
    page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/review' })
  ).toBeVisible({
    timeout: 60_000
  })

  const reviewMeta = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    const review = project?.workspaces.find((workspace) => workspace.branch === 'feature/review')
    return { id: review?.id ?? null, localPath: review?.localPath ?? null }
  })
  expect(reviewMeta.id).not.toBeNull()
  expect(reviewMeta.localPath).not.toBeNull()
  await access(reviewMeta.localPath!)

  // Delete worktree from disk.
  await page.getByTestId(`workspace-row-${reviewMeta.id}`).hover()
  await page.getByTestId(`workspace-menu-${reviewMeta.id}`).click()
  await page.getByTestId(`workspace-delete-${reviewMeta.id}`).click()
  await expect(page.getByTestId(`workspace-row-${reviewMeta.id}`)).toHaveCount(0)
  await expect(access(reviewMeta.localPath!)).rejects.toThrow()

  // Create another worktree and remove from app only.
  await page.getByTestId(`project-add-workspace-${projectMeta.projectId}`).click()
  await expect(page.getByTestId('workspace-branch-select')).toBeVisible({ timeout: 30_000 })
  await chooseBranch(page, 'workspace-branch-select', 'feature/conflict')
  await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
  await expect(
    page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/conflict' })
  ).toBeVisible({ timeout: 60_000 })

  const conflictMeta = await page.evaluate(async () => {
    const listed = await window.cerebro.listProjects()
    const project = listed.projects.find((item) => item.name === 'hello-world')
    const conflict = project?.workspaces.find(
      (workspace) => workspace.branch === 'feature/conflict'
    )
    return { id: conflict?.id ?? null, localPath: conflict?.localPath ?? null }
  })
  expect(conflictMeta.id).not.toBeNull()
  expect(conflictMeta.localPath).not.toBeNull()

  await page.getByTestId(`workspace-row-${conflictMeta.id}`).hover()
  await page.getByTestId(`workspace-menu-${conflictMeta.id}`).click()
  await page.getByTestId(`workspace-remove-${conflictMeta.id}`).click()
  await expect(page.getByTestId(`workspace-row-${conflictMeta.id}`)).toHaveCount(0)
  await access(conflictMeta.localPath!)

  // Remove project from app; clone directory remains.
  await page.getByTestId(`project-row-${projectMeta.projectId}`).hover()
  await page.getByTestId(`project-menu-${projectMeta.projectId}`).click()
  await page.getByTestId(`project-remove-${projectMeta.projectId}`).click()
  await expect(page.getByTestId(`project-row-${projectMeta.projectId}`)).toHaveCount(0)
  await access(projectMeta.clonePath!)
})

async function focusCerebro(electronApp: ElectronApplication): Promise<void> {
  // Exercise native main-process focus events and the actual preload/Query bridge.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.emit('blur')
    window.emit('focus')
  })
}

function mainPr(
  patch: Partial<import('./mock-github').MockPullRequest> = {}
): import('./mock-github').MockPullRequest {
  return {
    number: 10,
    title: 'Live PR',
    url: 'https://github.com/octocat/hello-world/pull/10',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-02-01T00:00:00Z',
    state: 'OPEN',
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    headRefName: 'main',
    repoFullName: 'octocat/hello-world',
    ...patch
  }
}

async function cloneProject(page: Page): Promise<import('../src/shared/types').Project> {
  await page.getByRole('button', { name: 'Add project' }).first().click()
  await page.getByLabel('Git URL').fill(GITHUB_CLONE_URL)
  await page.getByRole('button', { name: 'Clone repository' }).click()
  await expect(page.getByTestId(/project-row-/).filter({ hasText: 'hello-world' })).toBeVisible({
    timeout: 30_000
  })
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0)
  return page.evaluate(async () =>
    (await window.cerebro.listProjects()).projects.find(
      (project) => project.name === 'hello-world'
    )!
  )
}

test('refreshes PR icons on native focus and background interval, retains stale data and recovers', async ({
  page,
  githubMock,
  electronApp
}) => {
  await connectGitHub(page, githubMock)
  const project = await cloneProject(page)
  const id = project.workspaces[0].id
  await expect(page.getByTestId(`workspace-pr-icon-${id}`)).toHaveAttribute(
    'data-pr-state',
    'approved'
  )
  await page.clock.install()
  await page.reload()
  const icon = page.getByTestId(`workspace-pr-icon-${id}`)
  await expect(icon).toHaveAttribute('data-pr-state', 'approved')

  githubMock.setPullRequests('octocat', 'hello-world', [
    mainPr({ isDraft: true, reviewDecision: 'APPROVED' })
  ])
  await focusCerebro(electronApp)
  await expect(icon).toHaveAttribute('data-pr-state', 'draft')
  githubMock.setPullRequests('octocat', 'hello-world', [
    mainPr({ reviewDecision: 'CHANGES_REQUESTED' })
  ])
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].emit('blur')
  })
  await page.clock.runFor(61_000)
  await expect(icon).toHaveAttribute('data-pr-state', 'changes_requested')

  githubMock.setApiError(503)
  await focusCerebro(electronApp)
  await expect(icon).toHaveAttribute('data-stale', 'true')
  await expect(icon).toHaveAttribute('data-pr-state', 'changes_requested')
  githubMock.setApiError(null)
  for (const [state, patch] of [
    ['open', {}],
    ['merged', { state: 'MERGED', isDraft: true }],
    ['closed', { state: 'CLOSED' }]
  ] as const) {
    githubMock.setPullRequests('octocat', 'hello-world', [mainPr(patch)])
    await focusCerebro(electronApp)
    await expect(icon).toHaveAttribute('data-pr-state', state)
    await expect(icon).toHaveAttribute('data-stale', 'false')
  }
  githubMock.setPullRequests('octocat', 'hello-world', [])
  await focusCerebro(electronApp)
  await expect(icon).toHaveCount(0)
  await expect(page.getByTestId(`workspace-default-icon-${id}`)).toBeVisible()
})

test('PR loading stays hidden and the leading icon updates without moving the workspace label', async ({
  page,
  githubMock,
  electronApp
}) => {
  await connectGitHub(page, githubMock)
  const release = githubMock.holdPullRequests()
  try {
    const before = githubMock.requestCount()
    const project = await cloneProject(page)
    const id = project.workspaces[0].id
    await expect.poll(() => githubMock.requestCount()).toBeGreaterThan(before)
    const row = page.getByTestId(`workspace-row-${id}`)
    const container = row.locator('..')
    const label = row.locator('span').last()
    const fallback = page.getByTestId(`workspace-default-icon-${id}`)
    const icon = page.getByTestId(`workspace-pr-icon-${id}`)
    await expect(fallback).toBeVisible()
    await expect(icon).toHaveCount(0)
    await expect(container.locator('.animate-spin')).toHaveCount(0)
    const labelBefore = await label.boundingBox()
    const fallbackBefore = await fallback.boundingBox()
    // Workspace selection remains usable while the provider response is held.
    await row.click()
    await expect(row).toHaveAttribute('data-active', 'true')
    release()
    await expect(icon).toHaveAttribute('data-pr-state', 'approved')
    await expect(fallback).toHaveCount(0)
    await expect(icon).toHaveText('')
    await expect(row.locator('button')).toHaveCount(0)
    const labelAfter = await label.boundingBox()
    const iconAfter = await icon.boundingBox()
    expect(labelAfter!.x).toBe(labelBefore!.x)
    expect(iconAfter!.x).toBe(fallbackBefore!.x)
    expect(iconAfter!.x + iconAfter!.width).toBeLessThan(labelAfter!.x)

    const releaseRefresh = githubMock.holdPullRequests()
    try {
      const beforeRefresh = githubMock.requestCount()
      githubMock.setPullRequests('octocat', 'hello-world', [mainPr({ isDraft: true })])
      await focusCerebro(electronApp)
      await expect.poll(() => githubMock.requestCount()).toBeGreaterThan(beforeRefresh)
      await expect(icon).toHaveAttribute('data-pr-state', 'approved')
      await expect(container.locator('.animate-spin')).toHaveCount(0)
    } finally {
      releaseRefresh()
    }
    await expect(icon).toHaveAttribute('data-pr-state', 'draft')
    await icon.click()
    const popover = page.getByTestId(`workspace-pr-popover-${id}`)
    await expect(popover).toContainText('State: Draft')
    const popoverBox = await popover.boundingBox()
    const openButtonBox = await page.getByTestId(`workspace-pr-open-${id}`).boundingBox()
    expect(openButtonBox!.x + openButtonBox!.width).toBeLessThan(popoverBox!.x + popoverBox!.width)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await row.click()
    await page.mouse.move(500, 200)
    const artifacts =
      process.env.CEREBRO_E2E_ARTIFACTS ?? path.join(tmpdir(), 'cerebro-e2e-artifacts')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: path.join(artifacts, 'workspace-leading-pr-icon.png') })
  } finally {
    release()
  }
})

test('renderer offline events do not pause PR refresh or local workspace selection', async ({
  page,
  githubMock,
  electronApp
}) => {
  await connectGitHub(page, githubMock)
  const project = await cloneProject(page)
  const id = project.workspaces[0].id
  const icon = page.getByTestId(`workspace-pr-icon-${id}`)
  await expect(icon).toHaveAttribute('data-pr-state', 'approved')
  githubMock.setPullRequests('octocat', 'hello-world', [mainPr({ isDraft: true })])
  // Chromium's network signal must not gate IPC: main-process networking still works.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await focusCerebro(electronApp)
  await expect(icon).toHaveAttribute('data-pr-state', 'draft')
  await page.getByTestId(`project-add-workspace-${project.id}`).click()
  await expect(page.getByTestId('workspace-branch-select')).toBeVisible()
  await chooseBranch(page, 'workspace-branch-select', 'feature/review')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  const review = page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/review' })
  await expect(review).toHaveAttribute('data-active', 'true')
  await page.getByTestId(`workspace-row-${id}`).click()
  await expect(page.getByTestId(`workspace-row-${id}`)).toHaveAttribute('data-active', 'true')
})

test('login refreshes existing workspaces and disconnect clears their cached PRs', async ({
  page,
  githubMock
}) => {
  const project = await cloneProject(page)
  const id = project.workspaces[0].id
  await expect(page.getByTestId(`workspace-default-icon-${id}`)).toBeVisible()
  await expect(page.getByTestId(`workspace-pr-icon-${id}`)).toHaveCount(0)
  await connectGitHub(page, githubMock)
  const icon = page.getByTestId(`workspace-pr-icon-${id}`)
  await expect(icon).toHaveAttribute('data-pr-state', 'approved')
  await page.evaluate(() => window.cerebro.disconnectGitHub())
  await expect(icon).toHaveCount(0)
  await expect(page.getByTestId(`workspace-default-icon-${id}`)).toBeVisible()
})

test('multi-root repositories and sibling worktrees share PR queries and track live branches', async ({
  page,
  githubMock,
  electronApp
}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cerebro-multiroot-pr-')))
  try {
    const repoA = path.join(root, 'repo-a')
    const worktree = path.join(root, 'repo-a-review')
    const repoB = path.join(root, 'repo-b')
    await initRepoWithBranches(repoA)
    await execFileAsync('git', ['remote', 'add', 'origin', GITHUB_CLONE_URL], { cwd: repoA })
    await execFileAsync('git', ['worktree', 'add', worktree, 'feature/review'], { cwd: repoA })
    await initRepoWithBranches(repoB)
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'ssh://git@github.com/octocat/second.git'],
      { cwd: repoB }
    )
    githubMock.setPullRequests('octocat', 'second', [
      mainPr({ repoFullName: 'octocat/second', state: 'MERGED' })
    ])
    await connectGitHub(page, githubMock)
    const before = githubMock.requestCount()
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      root
    )
    await focusCerebro(electronApp)
    await expect(page.getByTestId(`project-row-${project.id}`)).toBeVisible()
    const a = project.workspaces.find((workspace) => workspace.localPath === repoA)!
    const review = project.workspaces.find((workspace) => workspace.localPath === worktree)!
    const b = project.workspaces.find((workspace) => workspace.localPath === repoB)!
    await expect(page.getByTestId(`workspace-pr-icon-${a.id}`)).toHaveAttribute(
      'data-pr-state',
      'approved'
    )
    await expect(page.getByTestId(`workspace-pr-icon-${review.id}`)).toHaveAttribute(
      'data-pr-state',
      'changes_requested'
    )
    await expect(page.getByTestId(`workspace-pr-icon-${b.id}`)).toHaveAttribute(
      'data-pr-state',
      'merged'
    )
    for (const workspace of [a, review, b]) {
      const row = page.getByTestId(`workspace-row-${workspace.id}`)
      const icon = page.getByTestId(`workspace-pr-icon-${workspace.id}`)
      const branch = page.getByTestId(`workspace-branch-${workspace.id}`).locator('span').last()
      const iconBox = await icon.boundingBox()
      const branchBox = await branch.boundingBox()
      expect(iconBox!.x + iconBox!.width).toBeLessThan(branchBox!.x)
      expect(Math.abs(iconBox!.y - branchBox!.y)).toBeLessThanOrEqual(1)
      await expect(row.locator('button')).toHaveCount(0)
      await icon.click()
      await expect(page.getByTestId(`workspace-pr-popover-${workspace.id}`)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId(`workspace-pr-popover-${workspace.id}`)).toHaveCount(0)
      await row.hover()
      const card = page.getByTestId(`workspace-hover-${workspace.id}`)
      await expect(card).toContainText(workspace.branch)
      await expect(card).toContainText('Workspace created')
      await expect(card.getByRole('link')).toBeVisible()
      await page.mouse.move(1000, 700)
      await expect(card).toHaveCount(0)
    }
    expect(githubMock.requestCount() - before).toBe(2)
    // An external git checkout must update matching without reopening the project.
    await execFileAsync('git', ['checkout', 'feature/closed'], { cwd: worktree })
    await focusCerebro(electronApp)
    await expect(page.getByTestId(`workspace-pr-icon-${review.id}`)).toHaveAttribute(
      'data-pr-state',
      'closed'
    )
    const artifacts =
      process.env.CEREBRO_E2E_ARTIFACTS ?? path.join(tmpdir(), 'cerebro-e2e-artifacts')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: path.join(artifacts, 'multi-root-pr-states.png') })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('renews an expired App access token before fetching PRs', async ({ page, githubMock }) => {
  await connectGitHub(page, githubMock)
  await cloneProject(page)
  githubMock.expireAccessTokens()
  const result = await page.evaluate(() =>
    window.cerebro.getRepositoryPullRequests('octocat', 'hello-world')
  )
  expect(result.available).toBe(true)
  expect(result.provider).toBe('github-app')
  expect(githubMock.refreshCount()).toBe(1)
})

test('workspace hover shows relative dates, PR details, CI and a usable link', async ({
  page,
  githubMock,
  electronApp
}) => {
  await connectGitHub(page, githubMock)
  const ciChecks: import('./mock-github').MockPullRequest['ciChecks'] = [
    {
      __typename: 'CheckRun',
      name: 'Unit tests',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      detailsUrl: 'https://github.com/octocat/hello-world/actions/runs/1'
    },
    {
      __typename: 'CheckRun',
      name: 'Electron E2E',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/octocat/hello-world/actions/runs/2'
    },
    {
      __typename: 'CheckRun',
      name: 'Build',
      status: 'IN_PROGRESS',
      conclusion: null,
      detailsUrl: null
    },
    {
      __typename: 'CheckRun',
      name: 'Deploy approval',
      status: 'WAITING',
      conclusion: null,
      detailsUrl: null
    },
    {
      __typename: 'CheckRun',
      name: 'Cancelled job',
      status: 'COMPLETED',
      conclusion: 'CANCELLED',
      detailsUrl: null
    },
    {
      __typename: 'CheckRun',
      name: 'Optional job',
      status: 'COMPLETED',
      conclusion: 'SKIPPED',
      detailsUrl: null
    },
    {
      __typename: 'CheckRun',
      name: 'Timeout job',
      status: 'COMPLETED',
      conclusion: 'TIMED_OUT',
      detailsUrl: null
    },
    {
      __typename: 'StatusContext',
      context: 'Preview',
      state: 'PENDING',
      description: 'Waiting for deployment',
      targetUrl: 'https://ci.example.com/preview'
    },
    ...Array.from({ length: 15 }, (_, i) => ({
      __typename: 'CheckRun' as const,
      name: `Matrix ${i}`,
      status: 'QUEUED',
      conclusion: null,
      detailsUrl: null
    }))
  ]
  githubMock.setPullRequests('octocat', 'hello-world', [
    mainPr({
      ciStatus: 'SUCCESS',
      ciChecks,
      reviewDecision: 'CHANGES_REQUESTED',
      createdAt: new Date(Date.now() - 20 * 86400_000).toISOString()
    })
  ])
  const project = await cloneProject(page)
  const id = project.workspaces[0].id
  const row = page.getByTestId(`workspace-row-${id}`)
  await expect(page.getByTestId(`workspace-pr-icon-${id}`)).toBeVisible()
  await row.hover()
  const card = page.getByTestId(`workspace-hover-${id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('main')
  await expect(card).toContainText('Workspace created just now')
  await expect(card).toContainText('PR created 20 days ago')
  await expect(card).toContainText('Changes requested')
  await expect(card).toContainText('Passing')
  const checks = card.getByRole('region', { name: 'CI checks' })
  await expect(checks).toContainText('Showing 20 of 23 checks')
  await expect(checks.locator('li')).toHaveCount(20)
  await expect(checks.locator('[data-ci-state="success"] svg')).toHaveCount(1)
  await expect(checks.locator('[data-ci-state="failure"] svg')).toHaveCount(1)
  const successColor = await checks
    .locator('[data-ci-state="success"]')
    .evaluate((e) => getComputedStyle(e).color)
  const failureColor = await checks
    .locator('[data-ci-state="failure"]')
    .evaluate((e) => getComputedStyle(e).color)
  expect(successColor).not.toBe(failureColor)
  await expect(checks).toContainText('Running')
  await expect(checks).toContainText('Waiting')
  await expect(checks).toContainText('Cancelled')
  await expect(checks).toContainText('Skipped')
  await expect(checks).toContainText('Timed out')
  await expect(checks.locator('.animate-spin')).toHaveCount(0)
  await expect(checks.getByRole('link', { name: 'View all checks on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/octocat/hello-world/pull/10/checks'
  )
  const checkLink = checks.getByRole('link', { name: 'Unit tests' })
  await expect(checkLink).toHaveAttribute(
    'href',
    'https://github.com/octocat/hello-world/actions/runs/1'
  )
  await checkLink.click()
  const link = card.getByRole('link', { name: '#10 · Live PR' })
  await expect(link).toHaveAttribute('href', 'https://github.com/octocat/hello-world/pull/10')
  await link.hover()
  await expect(card).toBeVisible()
  // Real IPC reaches the external-link handler, which suppresses browser launches in tests.
  await link.click()
  await expect(page).not.toHaveURL(/github.com/)
  await page.mouse.move(1000, 700)
  await expect(card).toHaveCount(0)
  githubMock.setPullRequests('octocat', 'hello-world', [mainPr({ ciStatus: 'FAILURE', ciChecks })])
  await focusCerebro(electronApp)
  await row.hover()
  await expect(card).toContainText('Failing')
  const artifacts =
    process.env.CEREBRO_E2E_ARTIFACTS ?? path.join(tmpdir(), 'cerebro-e2e-artifacts')
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: path.join(artifacts, 'workspace-hover-details.png') })
  await page.mouse.move(1000, 700)
  await page.evaluate(() => window.cerebro.disconnectGitHub())
  await expect(page.getByTestId(`workspace-pr-icon-${id}`)).toHaveCount(0)
  await row.hover()
  await expect(card).toContainText('Workspace created')
  await expect(card.getByRole('link')).toHaveCount(0)
  await expect(card.locator('.animate-spin')).toHaveCount(0)
})

test.describe('GitHub CLI fallback', () => {
  test.use({ ghAvailable: true })
  test('uses gh without App login, prefers a working App, and falls back after App permission failure', async ({
    page,
    githubMock,
    electronApp,
    fakeGh
  }) => {
    const project = await cloneProject(page)
    const icon = page.getByTestId(`workspace-pr-icon-${project.workspaces[0].id}`)
    await expect(icon).toHaveAttribute('data-pr-state', 'draft')
    await page.getByTestId(`workspace-row-${project.workspaces[0].id}`).hover()
    const card = page.getByTestId(`workspace-hover-${project.workspaces[0].id}`)
    await expect(card).toContainText('Draft')
    await expect(card).toContainText('Pending')
    await page.mouse.move(1000, 700)
    await expect(card).toHaveCount(0)
    await icon.click()
    await expect(
      page.getByTestId(`workspace-pr-popover-${project.workspaces[0].id}`)
    ).toContainText('Source: GitHub CLI')
    await page.keyboard.press('Escape')
    await connectGitHub(page, githubMock)
    await expect(icon).toHaveAttribute('data-pr-state', 'approved')
    githubMock.setApiError(403)
    await focusCerebro(electronApp)
    await expect(icon).toHaveAttribute('data-pr-state', 'draft')
    await writeFile(fakeGh, '#!/usr/bin/env node\nprocess.exit(1)\n', { mode: 0o755 })
    await page.evaluate(() => window.cerebro.disconnectGitHub())
    await expect(icon).toHaveCount(0)
    await expect(
      page.getByTestId(`workspace-default-icon-${project.workspaces[0].id}`)
    ).toBeVisible()
    await page.getByTestId(`project-add-workspace-${project.id}`).click()
    await expect(page.getByTestId('workspace-branch-select')).toBeVisible()
    await chooseBranch(page, 'workspace-branch-select', 'feature/review')
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(
      page.getByTestId(/workspace-row-/).filter({ hasText: 'feature/review' })
    ).toBeVisible({ timeout: 30_000 })
  })
})
