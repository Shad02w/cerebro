import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

async function expectScrollsToLastTab(page: Page): Promise<void> {
  const bar = page.getByTestId('content-tab-bar')
  const strip = bar.locator('[data-slot="tabs-list"]')
  const lastTab = page.getByTestId('changes-tab').last()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const barBox = (await bar.boundingBox())!
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewportWidth + 1)

  await strip.evaluate((element) => (element.scrollLeft = 0))
  await expect(lastTab).not.toBeInViewport({ ratio: 1 })
  const stripBox = (await strip.boundingBox())!
  await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2)
  await expect(async () => {
    await page.mouse.wheel(4000, 0)
    expect(
      await strip.evaluate(
        (element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1
      )
    ).toBe(true)
  }).toPass()
  await expect(lastTab).toBeInViewport({ ratio: 1 })
  const addBox = (await page.getByTestId('new-content-tab').boundingBox())!
  const scrolledStripBox = (await strip.boundingBox())!
  expect(addBox.x + addBox.width).toBeLessThanOrEqual(
    scrolledStripBox.x + scrolledStripBox.width + 1
  )
}

test('the tab strip scrolls to its last tab with the sidebar open, resized, or collapsed', async ({
  page,
  electronApp
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-tab-strip-scroll-'))
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1024, 640)
    )
    const project = await page.evaluate(
      (directory) => window.cerebro.createProjectFromDirectory(directory),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.evaluate(async (workspaceId) => {
      for (let index = 0; index < 16; index++) {
        await window.cerebro.layoutCommand({
          target: 'tab',
          action: 'create',
          workspaceId,
          kind: 'changes'
        })
      }
    }, workspaceId)
    await page.reload()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    const tabs = page.getByTestId('changes-tab')
    await expect(tabs).toHaveCount(16)
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')

    await expectScrollsToLastTab(page)

    await page
      .getByTestId('content-tab-bar')
      .locator('[data-slot="tabs-list"]')
      .evaluate((element) => {
        element.scrollLeft = 0
      })
    await tabs.last().getByRole('tab').focus()
    await expect(tabs.last()).toBeInViewport({ ratio: 1 })

    const rail = page.getByRole('button', { name: 'Resize Sidebar' })
    const railBox = (await rail.boundingBox())!
    const sidebarWidth = (await page.locator('[data-slot="sidebar-gap"]').boundingBox())!.width
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(railBox.x + railBox.width / 2 + 150, railBox.y + railBox.height / 2, {
      steps: 10
    })
    await page.mouse.up()
    await expect
      .poll(async () => (await page.locator('[data-slot="sidebar-gap"]').boundingBox())!.width)
      .toBeGreaterThan(sidebarWidth + 100)
    await expectScrollsToLastTab(page)

    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await expectScrollsToLastTab(page)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
