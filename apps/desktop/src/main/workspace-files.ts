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

const cache = new Map<string, { expires: number; files: Promise<string[]> }>()
const CACHE_MS = 5_000

/** Cached file list for a workspace directory. The walk stays off the renderer. */
export function listWorkspaceFiles(localPath: string): Promise<string[]> {
  const hit = cache.get(localPath)
  if (hit && hit.expires > Date.now()) return hit.files
  const files = listRelativeFiles(localPath)
  cache.set(localPath, { expires: Date.now() + CACHE_MS, files })
  void files.catch(() => cache.delete(localPath))
  return files
}
