import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  'target',
  '.turbo'
])

const FILE_LIMIT = 4000

/** Workspace-relative paths, skipping heavy directories and links that leave the tree. */
export async function listRelativeFiles(root: string, limit = FILE_LIMIT): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length && files.length < limit) {
    const dir = queue.shift()
    if (!dir) break
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const path = relative(root, full).split(sep).join('/')
      if (!path || path.startsWith('../') || path === '..') continue
      files.push(path)
      if (files.length >= limit) break
    }
  }
  files.sort((left, right) => left.localeCompare(right))
  return files
}

/**
 * Files currently under a workspace directory.
 * Each call walks again so a file an agent just added is visible to the next `@` search.
 */
export function listWorkspaceFiles(localPath: string): Promise<string[]> {
  return listRelativeFiles(localPath)
}
