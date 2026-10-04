import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect } from './fixtures'

const execFileAsync = promisify(execFile)
const executable = resolve(__dirname, '../../../packages/mux/src/agents/fixtures/fake-harness.cjs')
const mediaDir = '/cursor/stores/bc-ece937fc-5124-4a69-b19a-e93de51a8c0f/media'
const evidence = '/opt/cursor/artifacts'

test.use({
  agentEnvironment: {
    CEREBRO_CODEX_PATH: executable,
    CEREBRO_CLAUDE_PATH: executable,
    CEREBRO_PI_PATH: executable
  }
})

test('empty glowing composer centers, then docks after send', async ({ page, electronApp }) => {
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-glow-transition-'))
  const framesDir = await mkdtemp(join(tmpdir(), 'cerebro-composer-glow-frames-'))
  const frames: Buffer[] = []
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1250, 900)
    )
    const project = await page.evaluate(
      (folder) => window.cerebro.createProjectFromDirectory(folder),
      directory
    )
    const workspaceId = project.workspaces[0].id
    await page.reload()
    const projectRow = page.getByTestId(/project-row-/).first()
    await expect(projectRow).toBeVisible()
    if ((await projectRow.getAttribute('aria-expanded')) === 'false') await projectRow.click()
    await page.locator(`button[data-workspace-id="${workspaceId}"]`).click()
    await page.getByRole('button', { name: /^New Agent tab/ }).click()

    const dock = page.getByTestId('chat-composer')
    const form = dock.locator('form.chat-composer-shell')
    const glow = page.getByTestId('chat-composer-glow')
    await expect(dock).toHaveAttribute('data-dock', 'center')
    await expect(glow).toHaveCSS('opacity', '1')
    await expect
      .poll(async () => {
        const formBox = await form.boundingBox()
        const viewBox = await page.getByTestId('chat-view').boundingBox()
        if (!formBox || !viewBox) return Number.POSITIVE_INFINITY
        return Math.abs(formBox.y + formBox.height / 2 - (viewBox.y + viewBox.height / 2))
      })
      .toBeLessThan(24)

    await mkdir(evidence, { recursive: true })
    await mkdir(mediaDir, { recursive: true })
    await page.screenshot({ path: join(evidence, 'composer-glow-centered-v5.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-centered-v5.png') })

    const session = await page.context().newCDPSession(page)
    session.on('Page.screencastFrame', async (frame) => {
      frames.push(Buffer.from(frame.data, 'base64'))
      await session.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    })
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      everyNthFrame: 1,
      maxWidth: 1250,
      maxHeight: 900
    })

    await page.waitForTimeout(600)
    const composer = page.getByRole('textbox', { name: 'Message agent' })
    await composer.click()
    await page.keyboard.type('Ship a soft glow on the empty agent composer', { delay: 35 })
    await page.waitForTimeout(350)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(dock).toHaveAttribute('data-dock', 'bottom')
    await expect(dock).toHaveAttribute('data-motion', 'on')
    // Capture the in-flight dock motion, then settle.
    await page.waitForTimeout(280)
    await expect
      .poll(async () => dock.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe('none')
    await page.waitForTimeout(450)
    await expect(glow).toHaveCSS('opacity', '0')
    await expect(page.getByTestId('chat-empty-hero')).toHaveCSS('visibility', 'hidden')
    await page.waitForTimeout(200)

    await session.send('Page.stopScreencast')
    await page.screenshot({ path: join(evidence, 'composer-glow-docked-v5.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-docked-v5.png') })

    expect(frames.length).toBeGreaterThan(10)
    for (const [index, frame] of frames.entries()) {
      await writeFile(join(framesDir, `frame-${String(index).padStart(4, '0')}.jpg`), frame)
    }
    const videoPath = join(mediaDir, 'composer-glow-center-transition.mp4')
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate',
      '20',
      '-i',
      join(framesDir, 'frame-%04d.jpg'),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      videoPath
    ])
    await execFileAsync('cp', [
      '-f',
      videoPath,
      join(evidence, 'composer-glow-center-transition.mp4')
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(framesDir, { recursive: true, force: true })
  }
})
