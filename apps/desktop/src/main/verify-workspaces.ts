import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { closeDb } from './db'
import { createWorkspaceFromGitUrl, listWorkspaces } from './workspaces'

const execFileAsync = promisify(execFile)

async function initGitRepo(dir: string, branch: string, marker: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', branch], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'verify@cerebro.local'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Cerebro Verify'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), `${marker}\n`)
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', `init ${marker}`], { cwd: dir })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export async function verifyWorkspaces(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-verify-'))
  const home = join(root, 'cerebro')
  const sources = join(root, 'sources')
  process.env.CEREBRO_HOME = home

  try {
    const sourceA = join(sources, 'source-alpha')
    const sourceB = join(sources, 'source-beta')
    await initGitRepo(sourceA, 'main', 'alpha-workspace')
    await initGitRepo(sourceB, 'develop', 'beta-workspace')

    const workspaceA = await createWorkspaceFromGitUrl(`file://${sourceA}`)
    const workspaceB = await createWorkspaceFromGitUrl(`file://${sourceB}`)
    const workspaceC = await createWorkspaceFromGitUrl('https://github.com/octocat/Hello-World.git')

    assert(workspaceA.repositories.length === 1, 'Workspace A should link one git repository.')
    assert(workspaceB.repositories.length === 1, 'Workspace B should link one git repository.')
    assert(workspaceC.repositories.length === 1, 'HTTPS clone should link one git repository.')
    assert(
      workspaceA.repositories[0].defaultBranch === 'main',
      'Workspace A should use the default branch main.'
    )
    assert(
      workspaceB.repositories[0].defaultBranch === 'develop',
      'Workspace B should use the default branch develop.'
    )
    assert(
      workspaceA.repositories[0].localPath === join(home, 'source-alpha'),
      'Workspace A should clone into the Cerebro home directory.'
    )

    await access(join(workspaceA.repositories[0].localPath, 'README.md'))
    await access(join(workspaceB.repositories[0].localPath, 'README.md'))
    await access(join(workspaceA.repositories[0].localPath, '.git'))
    await access(join(workspaceB.repositories[0].localPath, '.git'))
    await access(join(workspaceC.repositories[0].localPath, '.git'))

    const listed = listWorkspaces()
    assert(
      listed.workspaces.length === 3,
      `Expected 3 workspaces, found ${listed.workspaces.length}.`
    )
    assert(listed.activeWorkspaceId === workspaceC.id, 'The newest workspace should become active.')
    assert(
      listed.workspaces.every((workspace) => workspace.repositories.length === 1),
      'Each workspace should list its linked git repository.'
    )
    assert(
      listed.workspaces.some((workspace) =>
        workspace.repositories[0].gitUrl.endsWith('source-alpha')
      ),
      'Listed workspaces should include the first cloned repository.'
    )
    assert(
      listed.workspaces.some((workspace) =>
        workspace.repositories[0].gitUrl.endsWith('source-beta')
      ),
      'Listed workspaces should include the second cloned repository.'
    )
    assert(
      listed.workspaces.some((workspace) =>
        workspace.repositories[0].gitUrl.includes('octocat/Hello-World')
      ),
      'Listed workspaces should include the HTTPS GitHub repository.'
    )

    console.log('Workspace clone + multi-workspace persistence verified.')
    console.log(
      JSON.stringify(
        {
          home,
          workspaces: listed.workspaces.map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            repos: workspace.repositories.map((repo) => ({
              gitUrl: repo.gitUrl,
              localPath: repo.localPath,
              defaultBranch: repo.defaultBranch
            }))
          }))
        },
        null,
        2
      )
    )
  } finally {
    closeDb()
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[1]?.includes('verify-workspaces')) {
  verifyWorkspaces().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
