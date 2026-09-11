const { readFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function checkCliRuntime(context) {
  const runtime = JSON.parse(
    readFileSync(join(context.packager.info.appDir, 'out/cli/runtime.json'), 'utf8')
  )
  const architectures = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']
  if (
    runtime.platform !== context.electronPlatformName ||
    runtime.arch !== architectures[context.arch]
  ) {
    throw new Error(
      'Bundled CLI runtime does not match the package target. Build on the target OS and architecture.'
    )
  }
}
