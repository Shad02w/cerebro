import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from './fixtures'

const execFileAsync = promisify(execFile)

async function initGitRepo(dir: string, branch: string, marker: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', branch], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'e2e@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro E2E'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), `${marker}\n`)
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', `init ${marker}`], { cwd: dir })
}

test('shows the more action only on the hovered sidebar tree row', async ({ page }) => {
  const sourcesRoot = await mkdtemp(join(tmpdir(), 'cerebro-sidebar-tree-e2e-'))
  const source = join(sourcesRoot, 'tree-alpha')

  try {
    await initGitRepo(source, 'main', 'tree-alpha')

    await page.getByRole('button', { name: 'Add workspace' }).first().click()
    await page.getByLabel('Git URL').fill(`file://${source}`)
    await page.getByRole('button', { name: 'Clone repository' }).click()
    await expect(page.getByRole('button', { name: 'tree-alpha', exact: true })).toBeVisible({
      timeout: 60_000
    })

    const ids = await page.evaluate(async () => {
      const listed = await window.cerebro.listWorkspaces()
      const workspace = listed.workspaces[0]
      return {
        workspaceId: workspace?.id ?? null,
        repositoryId: workspace?.repositories[0]?.id ?? null
      }
    })
    expect(ids.workspaceId).not.toBeNull()
    expect(ids.repositoryId).not.toBeNull()

    const sidebar = page.locator('[data-slot="sidebar"]')
    const parentRow = sidebar.getByRole('button', { name: 'tree-alpha', exact: true })
    const childRow = sidebar.getByTestId(`repository-branch-${ids.repositoryId}`)
    const parentMore = sidebar.getByTestId(`workspace-more-${ids.workspaceId}`)
    const childMore = sidebar.getByTestId(`repository-more-${ids.repositoryId}`)

    await expect(parentMore).toHaveCSS('opacity', '0')
    await expect(childMore).toHaveCSS('opacity', '0')

    await parentRow.hover()
    await expect(parentMore).toHaveCSS('opacity', '1')
    await expect(childMore).toHaveCSS('opacity', '0')

    await childRow.hover()
    await expect(childMore).toHaveCSS('opacity', '1')
    await expect(parentMore).toHaveCSS('opacity', '0')
  } finally {
    await rm(sourcesRoot, { recursive: true, force: true })
  }
})
