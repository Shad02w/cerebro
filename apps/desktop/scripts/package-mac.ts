import { execFileSync } from 'node:child_process'
import { build, Platform } from 'electron-builder'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const requireSigning = process.env.CEREBRO_REQUIRE_SIGNING === 'true'
  if (process.platform !== 'darwin') throw new Error('Build macOS releases on macOS.')
  if (args.some((arg) => arg !== '--dir')) throw new Error('Only --dir is supported.')

  execFileSync('pnpm', ['exec', 'electron-vite', 'build'], { stdio: 'inherit' })
  await build({
    targets: Platform.MAC.createTarget(args.includes('--dir') ? ['dir'] : ['dmg', 'zip']),
    publish: 'never',
    config: {
      extends: './electron-builder.yml',
      extraMetadata: {
        ...(process.env.CEREBRO_RELEASE_VERSION
          ? { version: process.env.CEREBRO_RELEASE_VERSION }
          : {})
      },
      directories: { output: 'dist/production' },
      artifactName: 'Cerebro-${version}-${arch}.${ext}',
      forceCodeSigning: requireSigning,
      mac: {
        // Re-seal the modified Electron bundle even without a Developer ID.
        identity: requireSigning ? undefined : '-',
        hardenedRuntime: requireSigning,
        notarize: requireSigning,
        ...(process.env.GITHUB_RUN_NUMBER ? { bundleVersion: process.env.GITHUB_RUN_NUMBER } : {})
      }
    }
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
