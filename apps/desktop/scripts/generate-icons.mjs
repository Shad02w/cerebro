// Run on macOS with ImageMagick installed: node scripts/generate-icons.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = (name) => join(root, name)
const run = (args) => execFileSync('magick', args, { stdio: 'inherit' })
// Trim the supplied transparent canvas for legible in-app marks; retain every dot.
const brain = readFileSync(path('resources/branding/brain.svg'), 'utf8').replace(
  'width="1024" height="1024" viewBox="0 0 1024 1024"',
  'width="650" height="565" viewBox="187 229.5 650 565"'
)
writeFileSync(path('src/renderer/src/assets/brain.svg'), brain)
run([
  '-background',
  'none',
  path('resources/branding/icon.svg'),
  '-resize',
  '1024x1024',
  path('build/icon.png')
])
copyFileSync(path('build/icon.png'), path('resources/icon.png'))
run([
  path('build/icon.png'),
  '-define',
  'icon:auto-resize=256,128,64,48,32,16',
  path('build/icon.ico')
])
const temp = mkdtempSync(join(tmpdir(), 'cerebro-icons-'))
const iconset = join(temp, 'Cerebro.iconset')
execFileSync('mkdir', ['-p', iconset])
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      run([
        path('build/icon.png'),
        '-resize',
        `${size * scale}x${size * scale}`,
        join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)
      ])
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path('build/icon.icns')])
} finally {
  rmSync(temp, { recursive: true, force: true })
}
