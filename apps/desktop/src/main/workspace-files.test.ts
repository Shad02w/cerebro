import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listRelativeFiles } from './workspace-files'

test('workspace file lists are relative and skip heavy directories and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-files-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# hi\n')
  await writeFile(join(root, 'src', 'app.ts'), 'export {}\n')
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), '')
  await writeFile(join(root, '.git', 'config'), '')
  await symlink(join(root, 'src', 'app.ts'), join(root, 'linked.ts'))
  const files = await listRelativeFiles(root)
  assert.deepEqual(files, ['README.md', 'src/app.ts'])
})
