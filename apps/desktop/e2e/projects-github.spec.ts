import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
import { startMockGitHubServer, type MockGitHubServer } from './mock-github'

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, '..')
const require = createRequire(path.join(desktopRoot, 'package.json'))
const electronBinary = require('electron') as unknown as string
const mainEntry = path.join(desktopRoot, 'out/main/index.js')

const GITHUB_CLONE_URL = 'https://github.com/octocat/hello-world.git'

type ProjectGitHubFixtures = {
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

  electronApp: async ({ githubMock, localRemote }, use) => {
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
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: desktopRoot,
      timeout: 60_000,
      env: {
        ...env,
        NODE_ENV: 'test',
        CEREBRO_HOME: cerebroHome,
        CEREBRO_GITHUB_CLIENT_ID: 'cerebro-e2e-client',
        CEREBRO_GITHUB_LOGIN_URL: githubMock.baseUrl,
        CEREBRO_GITHUB_API_URL: githubMock.baseUrl,
        CEREBRO_E2E_GIT_URL_MAP: urlMap
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
        kind: workspace.kind,
        prTitle: workspace.pullRequest?.title ?? null,
        prState: workspace.pullRequest?.state ?? null,
        reviewDecision: workspace.pullRequest?.reviewDecision ?? null,
        mergeable: workspace.pullRequest?.mergeable ?? null
      }))
    }
  })

  expect(projectMeta.projectId).not.toBeNull()
  expect(projectMeta.workspaces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        branch: 'main',
        kind: 'default',
        prTitle: 'Improve main docs',
        prState: 'open',
        reviewDecision: 'approved',
        mergeable: true
      })
    ])
  )

  const defaultWorkspace = projectMeta.workspaces?.find((workspace) => workspace.branch === 'main')
  expect(defaultWorkspace).toBeTruthy()

  const addWorkspace = page.getByTestId(`project-add-workspace-${projectMeta.projectId}`)
  await expect(addWorkspace).toBeVisible()
  await addWorkspace.hover()
  await expect(page.getByRole('tooltip', { name: 'Add workspace' })).toBeVisible()
  await expect(page.getByTestId(`workspace-pr-badge-${defaultWorkspace!.id}`)).toContainText('Open')

  // Collapse / expand project row
  await page.getByTestId(`project-row-${projectMeta.projectId}`).click()
  await expect(page.getByTestId(`workspace-row-${defaultWorkspace!.id}`)).toBeHidden()
  await page.getByTestId(`project-row-${projectMeta.projectId}`).click()
  await expect(page.getByTestId(`workspace-row-${defaultWorkspace!.id}`)).toBeVisible()

  await page.getByTestId(`workspace-pr-badge-${defaultWorkspace!.id}`).click()
  const popover = page.getByTestId(`workspace-pr-popover-${defaultWorkspace!.id}`)
  await expect(popover).toBeVisible()
  await expect(page.getByTestId(`workspace-pr-title-${defaultWorkspace!.id}`)).toHaveText(
    'Improve main docs'
  )
  await expect(popover).toContainText('octocat/hello-world')
  await expect(popover).toContainText('Review passed')
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
  expect(afterCreate.review!.pullRequest?.title).toBe('Review feedback branch')
  expect(afterCreate.review!.pullRequest?.reviewDecision).toBe('changes_requested')

  await expect(page.getByTestId(`workspace-pr-badge-${afterCreate.review!.id}`)).toContainText(
    'Changes requested'
  )
  await expect(page.getByTestId('terminal-tab-bar')).toBeVisible()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.locator('[data-terminal-workspace-id]')).toHaveCount(0)

  await page.getByTestId(`workspace-pr-badge-${afterCreate.review!.id}`).click()
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
