import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  ChangedFile,
  ChangedFileKind,
  ChangedFileStatus,
  FileDiffContents,
  FileImageContents
} from './types'

const execFileAsync = promisify(execFile)

export type GitRemoteRunner = (args: string[], cwd?: string) => Promise<string>

const GIT_TIMEOUT_MS = 5 * 60 * 1000

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0'
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: gitEnv
    })
    return stdout.trim()
  } catch (error) {
    throw gitError(error)
  }
}

async function runGitBuffer(args: string[], cwd?: string): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: gitEnv,
      encoding: 'buffer'
    })
    return stdout
  } catch (error) {
    throw gitError(error)
  }
}

function gitError(error: unknown): Error {
  const err = error as { stderr?: Buffer | string; message?: string; code?: string }
  if (err.code === 'ENOENT') {
    return new Error('Git is not installed or not available on PATH.')
  }
  const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : err.stderr
  const detail = (stderr || err.message || 'Unknown git error').trim()
  return new Error(detail)
}

export type ParsedGitUrl = {
  url: string
  name: string
  github: { owner: string; repo: string } | null
}

function parseGitHubOwnerRepo(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')

  if (!trimmed || /^file:/i.test(trimmed)) return null

  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+)$/i)
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase()
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return { owner: sshMatch[2], repo: sshMatch[3] }
    }
    return null
  }

  const httpsMatch = trimmed.match(
    /^(?:(?:https?|ssh):\/\/)(?:[^@/]+@)?([^/:]+)(?::[0-9]+)?\/([^/]+)\/([^/]+)$/i
  )
  if (httpsMatch) {
    const host = httpsMatch[1].toLowerCase()
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return { owner: httpsMatch[2], repo: httpsMatch[3] }
    }
    return null
  }

  const bare = trimmed.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/)
  if (bare) return { owner: bare[1], repo: bare[2] }

  return null
}

/** True when the URL targets github.com (or the configured GitHub login host). */
export function isGitHubGitUrl(raw: string, loginHost?: string | null): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false

  const github = parseGitHubOwnerRepo(trimmed)
  if (!github) return false

  // Bare owner/repo is treated as GitHub.
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/.test(trimmed)) return true

  const hostMatch = trimmed.match(/^(?:(?:https?|ssh):\/\/)?(?:[^@]+@)?([^/:]+)/i)
  const host = hostMatch?.[1]?.toLowerCase()
  if (!host) return false

  if (host === 'github.com' || host.endsWith('.github.com')) return true

  if (loginHost) {
    try {
      const configured = new URL(
        loginHost.includes('://') ? loginHost : `https://${loginHost}`
      ).hostname.toLowerCase()
      if (host === configured) return true
    } catch {
      // Ignore invalid override hosts.
    }
  }

  return false
}

/** Test-only rewrite so Playwright can clone GitHub URLs from local fixtures. */
function resolveCloneUrl(url: string): string {
  if (process.env.NODE_ENV !== 'test') return url
  const raw = process.env.CEREBRO_E2E_GIT_URL_MAP?.trim()
  if (!raw) return url
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return map[url] || map[url.replace(/\.git$/i, '')] || url
  } catch {
    return url
  }
}

export function parseGitUrl(raw: string): ParsedGitUrl {
  const url = raw.trim()
  if (!url) throw new Error('Git URL is required.')

  const isSupported =
    /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)/i.test(url) ||
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/.test(url)

  if (!isSupported) {
    throw new Error('Enter a valid Git URL, such as https://github.com/org/repo.git')
  }

  const normalized = url.replace(/\.git$/i, '').replace(/\/+$/, '')
  const name = normalized
    .split(/[:/]/)
    .filter(Boolean)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, '-')

  if (!name) throw new Error('Could not determine a repository name from that Git URL.')

  const github = parseGitHubOwnerRepo(url)
  return { url, name, github }
}

export async function cloneRepository(
  url: string,
  destination: string,
  remote: GitRemoteRunner = runGit
): Promise<string> {
  const cloneUrl = resolveCloneUrl(url)
  await remote(['clone', '--', cloneUrl, destination])
  return readDefaultBranch(destination)
}

export async function readOriginUrl(repoPath: string): Promise<string | null> {
  try {
    const origin = await runGit(['remote', 'get-url', 'origin'], repoPath)
    return origin || null
  } catch {
    return null
  }
}

export async function readDefaultBranch(repoPath: string): Promise<string> {
  try {
    const head = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    if (head) return head
  } catch {
    // Fall through to other probes when HEAD is detached.
  }

  try {
    const originHead = await runGit(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repoPath)
    const branch = originHead.replace(/^origin\//, '')
    if (branch) return branch
  } catch {
    // Some clones (including file://) may not have origin/HEAD.
  }

  const current = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
  if (!current || current === 'HEAD') {
    throw new Error('Cloned the repository, but could not determine its default branch.')
  }
  return current
}

export async function fetchRemote(
  repoPath: string,
  remote: GitRemoteRunner = runGit
): Promise<void> {
  const origin = await readOriginUrl(repoPath)
  const mapped = origin ? resolveCloneUrl(origin) : null
  if (mapped && mapped !== origin) {
    await remote(
      ['fetch', '--prune', '--', mapped, '+refs/heads/*:refs/remotes/origin/*'],
      repoPath
    )
  } else {
    await remote(['fetch', '--prune', 'origin'], repoPath)
  }
}

export async function listRemoteBranches(repoPath: string): Promise<string[]> {
  try {
    const origin = await readOriginUrl(repoPath)
    const output = await runGit(
      ['ls-remote', '--heads', '--', origin ? resolveCloneUrl(origin) : 'origin'],
      repoPath
    )
    return [
      ...new Set(
        output.split('\n').flatMap((line) => line.match(/\srefs\/heads\/(.+)$/)?.[1] ?? [])
      )
    ].sort()
  } catch {
    const output = await runGit(
      ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'],
      repoPath
    )
    const names = output
      .split('\n')
      .filter((name) => name && name !== 'refs/remotes/origin/HEAD')
      .map((name) => name.replace(/^refs\/(?:heads|remotes\/origin)\//, ''))
    if (!names.length) throw new Error('Git could not read remote or local branches.')
    return [...new Set(names)].sort()
  }
}

async function gitRefExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await runGit(['show-ref', '--verify', '--quiet', ref], repoPath)
    return true
  } catch {
    return false
  }
}

async function resolveStartPoint(repoPath: string, branch: string): Promise<string | null> {
  if (await gitRefExists(repoPath, `refs/remotes/origin/${branch}`)) {
    return `origin/${branch}`
  }
  if (await gitRefExists(repoPath, `refs/heads/${branch}`)) {
    return branch
  }
  return null
}

export async function addWorktree(
  repoPath: string,
  destination: string,
  branch: string,
  from?: string | null,
  remote: GitRemoteRunner = runGit
): Promise<void> {
  await fetchRemote(repoPath, remote)

  const base = from?.trim() || null
  if (base) {
    if (base === branch) {
      throw new Error('New branch name must be different from the base branch.')
    }

    if (await gitRefExists(repoPath, `refs/heads/${branch}`)) {
      throw new Error(`A local branch "${branch}" already exists.`)
    }
    if (await gitRefExists(repoPath, `refs/remotes/origin/${branch}`)) {
      throw new Error(`A branch "${branch}" already exists.`)
    }

    const startPoint = await resolveStartPoint(repoPath, base)
    if (!startPoint) {
      throw new Error(`Base branch "${base}" was not found.`)
    }

    await runGit(['worktree', 'add', '-b', branch, destination, startPoint], repoPath)
    return
  }

  // Prefer attaching an existing local branch; otherwise create from origin/<branch>.
  if (await gitRefExists(repoPath, `refs/heads/${branch}`)) {
    await runGit(['worktree', 'add', destination, branch], repoPath)
    return
  }

  await runGit(
    ['worktree', 'add', '--track', '-b', branch, destination, `origin/${branch}`],
    repoPath
  )
}

/** Remove a linked worktree directory from the primary repository. */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await runGit(['worktree', 'remove', '--force', worktreePath], repoPath)
}

export function sanitizeBranchForPath(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch'
}

const MAX_TEXT_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

function imageContents(buf: Buffer | null, path: string): FileImageContents | null {
  if (!buf) return null
  const mime = IMAGE_MIME_TYPES[extname(path).toLowerCase()]
  return {
    byteLength: buf.byteLength,
    dataUrl:
      mime && buf.byteLength <= MAX_IMAGE_BYTES
        ? `data:${mime};base64,${buf.toString('base64')}`
        : null
  }
}

async function readImageVersion(
  repoPath: string,
  path: string,
  fromHead: boolean
): Promise<FileImageContents | null> {
  let byteLength: number
  if (fromHead) {
    try {
      byteLength = Number(await runGit(['cat-file', '-s', `HEAD:${path}`], repoPath))
    } catch {
      return null
    }
  } else {
    try {
      const info = await stat(repoFilePath(repoPath, path))
      if (!info.isFile()) return null
      byteLength = info.size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  // Bound both IPC payloads and image decoding, including versions stored in HEAD.
  if (byteLength > MAX_IMAGE_BYTES || !IMAGE_MIME_TYPES[extname(path).toLowerCase()]) {
    return { byteLength, dataUrl: null }
  }
  try {
    const buf = fromHead
      ? await gitShowBytes(repoPath, `HEAD:${path}`)
      : await readFile(repoFilePath(repoPath, path))
    return imageContents(buf, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function splitNul(raw: string): string[] {
  if (!raw) return []
  return raw.split('\0').filter((part) => part.length > 0)
}

function parseNameStatusZ(raw: string): ChangedFile[] {
  const tokens = splitNul(raw)
  const files: ChangedFile[] = []
  let index = 0
  while (index < tokens.length) {
    const code = tokens[index]
    if (!code) {
      index += 1
      continue
    }
    const kind = code[0]
    if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[index + 1]
      const path = tokens[index + 2]
      if (!oldPath || !path) break
      files.push({
        path,
        oldPath,
        status: kind === 'R' ? 'renamed' : 'added'
      })
      index += 3
      continue
    }
    const path = tokens[index + 1]
    if (!path) break
    const status: ChangedFileStatus = kind === 'A' ? 'added' : kind === 'D' ? 'deleted' : 'modified'
    files.push({ path, oldPath: null, status })
    index += 2
  }
  return files
}

async function hasHeadCommit(repoPath: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', 'HEAD'], repoPath)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/not a git repository/i.test(message)) throw error
    return false
  }
}

/** Working-tree changes versus HEAD, including untracked files. */
export async function listChangedFiles(repoPath: string): Promise<ChangedFile[]> {
  const files: ChangedFile[] = []
  if (await hasHeadCommit(repoPath)) {
    const nameStatus = await runGit(['diff', '--name-status', '-z', 'HEAD'], repoPath)
    files.push(...parseNameStatusZ(nameStatus))
  }

  const others = await runGit(['ls-files', '--others', '--exclude-standard', '-z'], repoPath)
  for (const path of splitNul(others)) {
    files.push({ path, oldPath: null, status: 'untracked' })
  }

  files.sort((left, right) => left.path.localeCompare(right.path))
  return files
}

function repoFilePath(repoPath: string, gitPath: string): string {
  if (!gitPath || gitPath.startsWith('/') || gitPath.split(/[/\\]/).includes('..')) {
    throw new Error('Path is outside the repository.')
  }
  const full = resolve(join(repoPath, ...gitPath.split('/')))
  const root = resolve(repoPath)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('Path is outside the repository.')
  }
  return full
}

function classifyBuffer(buf: Buffer): { kind: ChangedFileKind; text: string | null } {
  if (buf.byteLength > MAX_TEXT_BYTES || buf.includes(0)) {
    return { kind: 'binary', text: null }
  }
  return { kind: 'text', text: buf.toString('utf8') }
}

async function gitShowBytes(repoPath: string, spec: string): Promise<Buffer | null> {
  try {
    return await runGitBuffer(['show', spec], repoPath)
  } catch {
    return null
  }
}

export async function readChangedFileDiff(
  repoPath: string,
  file: ChangedFile
): Promise<Omit<FileDiffContents, 'repositoryId'>> {
  const fsPath = repoFilePath(repoPath, file.path)

  if (
    IMAGE_MIME_TYPES[extname(file.path).toLowerCase()] ||
    IMAGE_MIME_TYPES[extname(file.oldPath ?? '').toLowerCase()]
  ) {
    const [oldImage, newImage] = await Promise.all([
      file.status === 'added' || file.status === 'untracked'
        ? null
        : readImageVersion(repoPath, file.oldPath ?? file.path, true),
      file.status === 'deleted' ? null : readImageVersion(repoPath, file.path, false)
    ])
    return {
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      kind: 'image',
      oldContents: null,
      newContents: null,
      oldImage,
      newImage
    }
  }

  let oldBuf: Buffer | null = null
  let newBuf: Buffer | null = null

  if (file.status !== 'added' && file.status !== 'untracked') {
    oldBuf = await gitShowBytes(repoPath, `HEAD:${file.oldPath ?? file.path}`)
  }

  if (file.status !== 'deleted') {
    try {
      const info = await stat(fsPath)
      if (info.isDirectory()) {
        return {
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          kind: 'binary',
          oldContents: null,
          newContents: null
        }
      }
      newBuf = await readFile(fsPath)
    } catch (error) {
      const err = error as { code?: string }
      if (err.code !== 'ENOENT') throw error
    }
  }

  const oldSide = oldBuf ? classifyBuffer(oldBuf) : null
  const newSide = newBuf ? classifyBuffer(newBuf) : null
  if (oldSide?.kind === 'binary' || newSide?.kind === 'binary') {
    return {
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      kind: 'binary',
      oldContents: null,
      newContents: null
    }
  }

  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    kind: 'text',
    oldContents: oldSide?.text ?? null,
    newContents: newSide?.text ?? null
  }
}
