import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  chmodSync,
  cpSync,
  mkdirSync,
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
  const muxRoot = resolve('../../packages/mux/src')
  return {
    name: 'cerebro-bundled-cli',
    buildStart() {
      for (const root of [cliRoot, coreRoot, muxRoot]) {
        for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
          if (file.endsWith('.ts')) this.addWatchFile(resolve(root, file))
        }
      }
    },
    closeBundle: {
      // electron-vite's watch hook launches/restarts Electron from closeBundle.
      // Rollup runs these hooks in parallel unless this prerequisite is sequential.
      order: 'pre',
      sequential: true,
      async handler() {
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
        const version =
          process.env.CEREBRO_RELEASE_VERSION ||
          JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
        await build({
          configFile: false,
          publicDir: false,
          resolve: {
            alias: {
              '@cerebro/core': resolve(coreRoot, 'index.ts'),
              '@cerebro/mux': resolve(muxRoot, 'client.ts')
            }
          },
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
            rollupOptions: {
              external: (id) => id.startsWith('node:') || builtinModules.includes(id)
            }
          }
        })
        for (const [name, entry] of [
          ['mux', 'server.ts'],
          ['mux-worker', 'worker.ts']
        ]) {
          await build({
            configFile: false,
            publicDir: false,
            resolve: {
              alias: {
                '@cerebro/core': resolve(coreRoot, 'index.ts'),
                // headless 6.0 advertises a nonexistent ESM path; resolve its
                // published CJS entry without changing other packages' resolution.
                '@xterm/headless': createRequire(resolve(muxRoot, '../package.json')).resolve(
                  '@xterm/headless'
                )
              }
            },
            build: {
              outDir: resolve('out/cli'),
              emptyOutDir: false,
              target: 'node22',
              minify: false,
              lib: {
                entry: resolve(muxRoot, entry),
                formats: ['cjs'],
                fileName: () => `${name}.cjs`
              },
              rollupOptions: {
                external: (id) =>
                  id.startsWith('node:') ||
                  builtinModules.includes(id) ||
                  id === 'node-pty' ||
                  id === '@anthropic-ai/claude-agent-sdk'
              }
            }
          })
        }
        // The SDK is self-contained ESM. It launches the user's installed Claude binary.
        const sdkRoot = resolve(
          createRequire(resolve(muxRoot, '../package.json')).resolve(
            '@anthropic-ai/claude-agent-sdk'
          ),
          '..'
        )
        const sdkTarget = resolve('out/cli/node_modules/@anthropic-ai/claude-agent-sdk')
        mkdirSync(sdkTarget, { recursive: true })
        for (const file of ['package.json', 'sdk.mjs', 'README.md'])
          copyFileSync(resolve(sdkRoot, file), resolve(sdkTarget, file))
        // node-pty prebuilds use Node-API; never copy an Electron-rebuilt build/ directory.
        const require = createRequire(import.meta.url)
        const ptyRoot = resolve(require.resolve('node-pty/package.json'), '..')
        const ptyTarget = resolve('out/cli/node_modules/node-pty')
        mkdirSync(ptyTarget, { recursive: true })
        for (const file of ['package.json', 'lib', 'prebuilds', 'third_party', 'LICENSE']) {
          if (existsSync(resolve(ptyRoot, file)))
            cpSync(resolve(ptyRoot, file), resolve(ptyTarget, file), { recursive: true })
        }
        if (!existsSync(resolve(ptyTarget, 'prebuilds', `${process.platform}-${process.arch}`))) {
          for (const file of ['binding.gyp', 'src', 'deps', 'scripts'])
            cpSync(resolve(ptyRoot, file), resolve(ptyTarget, file), { recursive: true })
          const ptyRequire = createRequire(resolve(ptyRoot, 'package.json'))
          cpSync(
            resolve(ptyRequire.resolve('node-addon-api/package.json'), '..'),
            resolve(ptyTarget, 'node_modules/node-addon-api'),
            { recursive: true }
          )
          execFileSync(
            process.execPath,
            [
              require.resolve('node-gyp/bin/node-gyp.js'),
              'rebuild',
              `--target=${process.versions.node}`,
              `--arch=${process.arch}`
            ],
            { cwd: ptyTarget, stdio: 'inherit' }
          )
        }
        const helper = resolve(
          ptyTarget,
          'prebuilds',
          `${process.platform}-${process.arch}`,
          'spawn-helper'
        )
        if (existsSync(helper)) chmodSync(helper, 0o755)
        // Verify native ABI and helper execution with the same Node shipped to users.
        execFileSync(
          process.execPath,
          [
            '-e',
            `const p=require(${JSON.stringify(ptyTarget)}).spawn(process.platform==='win32'?'cmd.exe':'/bin/sh',[],{cwd:process.cwd(),env:process.env});p.onExit(()=>process.exit(0));p.write('exit\\r');setTimeout(()=>{p.kill();process.exit(1)},5000);`
          ],
          { timeout: 10000 }
        )
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
            muxHash: createHash('sha256')
              .update(readFileSync(resolve('out/cli/mux.cjs')))
              .update(readFileSync(resolve('out/cli/mux-worker.cjs')))
              .update(readFileSync(resolve(sdkTarget, 'sdk.mjs')))
              .update(readFileSync(resolve(sdkTarget, 'README.md')))
              .digest('hex'),
            version
          })
        )
      }
    }
  }
}
