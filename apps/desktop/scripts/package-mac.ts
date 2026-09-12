import { execFileSync } from 'node:child_process'
import { build, Platform } from 'electron-builder'
import { getReleaseIdentity } from '../src/shared/release-identity'

async function main(): Promise<void> {
  const [channel = 'production', ...args] = process.argv.slice(2)
  const identity = getReleaseIdentity(channel)
  if (process.platform !== 'darwin') throw new Error('Build macOS releases on macOS.')
  if (args.some((arg) => arg !== '--dir')) throw new Error('Only --dir is supported.')

  execFileSync('pnpm', ['exec', 'electron-vite', 'build'], { stdio: 'inherit' })
  await build({
    targets: Platform.MAC.createTarget(args.includes('--dir') ? ['dir'] : ['dmg', 'zip']),
    publish: 'never',
    config: {
      extends: './electron-builder.yml',
      appId: identity.appId,
      productName: identity.productName,
      extraMetadata: {
        cerebroChannel: identity.channel,
        ...(process.env.CEREBRO_RELEASE_VERSION
          ? { version: process.env.CEREBRO_RELEASE_VERSION }
          : {})
      },
      directories: { output: `dist/${identity.channel}` },
      artifactName: `Cerebro${channel === 'dev' ? '-Dev' : ''}-\${version}-\${arch}.\${ext}`,
      forceCodeSigning: process.env.CEREBRO_REQUIRE_SIGNING === 'true',
      mac: {
        notarize: process.env.CEREBRO_REQUIRE_SIGNING === 'true',
        ...(process.env.GITHUB_RUN_NUMBER ? { bundleVersion: process.env.GITHUB_RUN_NUMBER } : {})
      }
    }
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
