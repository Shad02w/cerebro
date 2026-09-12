const { existsSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function checkMuxRuntime(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : join(context.appOutDir, 'resources')
  const runtime = join(resources, 'cli')
  for (const file of ['mux.cjs', 'mux-worker.cjs', 'node_modules/node-pty/lib/index.js']) {
    if (!existsSync(join(runtime, file))) throw new Error(`Packaged mux asset missing: ${file}`)
  }
  // extraResources excludes node_modules by default; audit the actual package,
  // not just out/cli, so a successful source build cannot hide this failure.
  const arch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch]
  if (
    !existsSync(
      join(runtime, 'node_modules/node-pty/prebuilds', `${context.electronPlatformName}-${arch}`)
    ) &&
    !existsSync(join(runtime, 'node_modules/node-pty/build/Release/pty.node'))
  ) {
    throw new Error('Packaged mux native PTY is missing.')
  }
}
