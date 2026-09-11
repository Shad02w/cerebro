import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { build, type Plugin } from 'vite'

/** Build/watch the standalone CLI alongside Electron, using the build host's Node runtime. */
export function cliBuildPlugin(): Plugin {
  const cliRoot = resolve('../cli/src')
  const coreRoot = resolve('../../packages/core/src')
  return {
    name: 'cerebro-bundled-cli',
    buildStart() {
      for (const root of [cliRoot, coreRoot]) {
        for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
          if (file.endsWith('.ts')) this.addWatchFile(resolve(root, file))
        }
      }
    },
    async closeBundle() {
      const [major, minor] = process.versions.node.split('.').map(Number)
      if (major < 22 || (major === 22 && minor < 13)) {
        throw new Error('Building the bundled CLI requires Node.js 22.13 or newer (node:sqlite).')
      }
      const runtimePath = realpathSync(process.execPath)
      const license = [
        process.env.CEREBRO_NODE_LICENSE,
        resolve(runtimePath, '../../LICENSE'),
        resolve(runtimePath, '../LICENSE'),
        resolve(runtimePath, '../../share/doc/node/LICENSE')
      ].find((file): file is string => Boolean(file && existsSync(file)))
      if (!license)
        throw new Error(
          'Node.js LICENSE not found. Set CEREBRO_NODE_LICENSE to the LICENSE file from your Node distribution.'
        )
      const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
      await build({
        configFile: false,
        publicDir: false,
        resolve: { alias: { '@cerebro/core': resolve(coreRoot, 'index.ts') } },
        define: { __CEREBRO_CLI_VERSION__: JSON.stringify(version) },
        build: {
          outDir: resolve('out/cli'),
          emptyOutDir: true,
          target: 'node22',
          minify: false,
          lib: {
            entry: resolve(cliRoot, 'index.ts'),
            formats: ['cjs'],
            fileName: () => 'cerebro.cjs'
          },
          rollupOptions: { external: (id) => id.startsWith('node:') || builtinModules.includes(id) }
        }
      })
      // Ship exactly the runtime used to build/test; packaging rejects cross-target mismatches.
      const nodePath = resolve('out/cli', process.platform === 'win32' ? 'node.exe' : 'node')
      copyFileSync(process.execPath, nodePath)
      chmodSync(nodePath, 0o755)
      copyFileSync(license, resolve('out/cli/NODE-LICENSE'))
      writeFileSync(
        resolve('out/cli/runtime.json'),
        JSON.stringify({
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          version
        })
      )
    }
  }
}
