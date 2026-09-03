import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
    const err = error as { stderr?: string; message?: string; code?: string }
    if (err.code === 'ENOENT') {
      throw new Error('Git is not installed or not available on PATH.')
    }
    const detail = (err.stderr || err.message || 'Unknown git error').trim()
    throw new Error(detail)
  }
}

export function parseGitUrl(raw: string): { url: string; name: string } {
  const url = raw.trim()
  if (!url) {
    throw new Error('Git URL is required.')
  }

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

  if (!name) {
    throw new Error('Could not determine a repository name from that Git URL.')
  }

  return { url, name }
}

export async function cloneRepository(url: string, destination: string): Promise<string> {
  await runGit(['clone', '--', url, destination])
  return readDefaultBranch(destination)
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
