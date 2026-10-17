import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { listRelativeFiles, listWorkspaceFiles } from './workspace-files'

const exec = promisify(execFile)

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

test('a git workspace lists every current file, including ones added after the last read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-files-git-'))
  await exec('git', ['init', '-b', 'main'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# hi\n')
  await writeFile(join(root, '.gitignore'), 'secret.env\n')
  await writeFile(join(root, 'secret.env'), 'TOKEN=1\n')
  assert.deepEqual(await listWorkspaceFiles(root), ['.gitignore', 'README.md', 'secret.env'])
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'added.ts'), 'export {}\n')
  assert.deepEqual(await listWorkspaceFiles(root), [
    '.gitignore',
    'README.md',
    'secret.env',
    'src/added.ts'
  ])
})
