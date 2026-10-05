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
  test.setTimeout(90_000)
  const directory = await mkdtemp(join(tmpdir(), 'cerebro-composer-glow-transition-'))
  const framesDir = await mkdtemp(join(tmpdir(), 'cerebro-composer-glow-frames-'))
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
    const hero = page.getByTestId('chat-empty-hero')
    await expect(hero).toBeVisible()
    await expect(hero).toHaveCSS('position', 'absolute')
    // Hero sits above the form in paint order but must not change form geometry.
    const heroBox = await hero.boundingBox()
    const formBoxBefore = await form.boundingBox()
    expect(heroBox).toBeTruthy()
    expect(formBoxBefore).toBeTruthy()
    expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(formBoxBefore!.y + 1)
    await expect
      .poll(async () => {
        const formBox = await form.boundingBox()
        const viewBox = await page.getByTestId('chat-view').boundingBox()
        if (!formBox || !viewBox) return Number.POSITIVE_INFINITY
        return Math.abs(formBox.y + formBox.height / 2 - (viewBox.y + viewBox.height / 2))
      })
      .toBeLessThan(16)

    await mkdir(evidence, { recursive: true })
    await mkdir(mediaDir, { recursive: true })
    await page.screenshot({ path: join(evidence, 'composer-glow-centered-v6.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-centered-empty.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-banding-after.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-aceternity-after.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-aceternity-lighter.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-teal-fresh.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-teal-lighter-bg.png') })
    await page.screenshot({
      path: join(mediaDir, 'composer-glow-banding-after-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(mediaDir, 'composer-glow-aceternity-after-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(mediaDir, 'composer-glow-aceternity-lighter-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(mediaDir, 'composer-glow-teal-fresh-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(mediaDir, 'composer-glow-teal-lighter-bg-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(evidence, 'composer-glow-teal-fresh.png')
    })
    await page.screenshot({
      path: join(evidence, 'composer-glow-teal-fresh-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })
    await page.screenshot({
      path: join(evidence, 'composer-glow-teal-lighter-bg.png')
    })
    await page.screenshot({
      path: join(evidence, 'composer-glow-teal-lighter-bg-crop.png'),
      clip: { x: 380, y: 280, width: 520, height: 320 }
    })

    const frames: Buffer[] = []
    const cdp = await page.context().newCDPSession(page)
    const onFrame = (payload: { data: string; sessionId: number }): void => {
      frames.push(Buffer.from(payload.data, 'base64'))
      void cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId })
    }
    cdp.on('Page.screencastFrame', onFrame)
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 72,
      everyNthFrame: 1,
      maxWidth: 1250,
      maxHeight: 900
    })

    // Hold the empty centered+glow state so the video reads clearly.
    await page.waitForTimeout(900)

    const composer = page.getByRole('textbox', { name: 'Message agent' })
    await composer.click()
    await page.keyboard.type('Ship a soft glow on the empty agent composer', { delay: 28 })
    await page.waitForTimeout(350)

    const beforeSend = await dock.evaluate((el) => getComputedStyle(el).transform)
    expect(beforeSend).not.toBe('none')
    expect(beforeSend).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(dock).toHaveAttribute('data-dock', 'bottom')
    await expect(dock).toHaveAttribute('data-motion', 'on')
    await expect
      .poll(async () => dock.evaluate((el) => el.getAnimations().length))
      .toBeGreaterThan(0)

    const pathYs: number[] = []
    const started = Date.now()
    while (Date.now() - started < 900) {
      const box = await form.boundingBox()
      if (box) pathYs.push(box.y)
      await page.waitForTimeout(16)
    }
    const uniqueBands = new Set(pathYs.map((y) => Math.round(y / 8)))
    expect(
      uniqueBands.size,
      `expected multiple vertical samples during dock, got ${JSON.stringify(pathYs)}`
    ).toBeGreaterThan(2)

    await expect(glow).toHaveCSS('opacity', '0')
    await expect(page.getByTestId('chat-empty-hero')).toHaveCSS('visibility', 'hidden')
    await page.waitForTimeout(500)

    await cdp.send('Page.stopScreencast')
    cdp.off('Page.screencastFrame', onFrame)
    await cdp.detach().catch(() => undefined)

    await page.screenshot({ path: join(evidence, 'composer-glow-docked-v6.png') })
    await page.screenshot({ path: join(mediaDir, 'composer-glow-docked-v6.png') })

    expect(frames.length).toBeGreaterThan(30)
    for (const [index, frame] of frames.entries()) {
      await writeFile(join(framesDir, `frame-${String(index).padStart(4, '0')}.jpg`), frame)
    }
    const videoPath = join(mediaDir, 'composer-glow-center-transition.mp4')
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate',
      '30',
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
