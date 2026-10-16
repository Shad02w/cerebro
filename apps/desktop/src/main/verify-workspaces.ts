import { mkdtemp, mkdir, rm, writeFile, access, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { closeDb } from './db'
import { createProjectFromDirectory, createProjectFromGitUrl, listProjects } from './projects'

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

    const projectA = await createProjectFromGitUrl(`file://${sourceA}`)
    const projectB = await createProjectFromGitUrl(`file://${sourceB}`)
    const projectC = await createProjectFromGitUrl('https://github.com/octocat/Hello-World.git')

    assert(projectA.repositories.length === 1, 'Project A should link one git repository.')
    assert(projectB.repositories.length === 1, 'Project B should link one git repository.')
    assert(projectC.repositories.length === 1, 'HTTPS clone should link one git repository.')
    assert(projectA.workspaces.length === 1, 'Project A should create a default workspace.')
    assert(projectA.workspaces[0].kind === 'default', 'Default workspace kind should be default.')
    assert(
      projectA.repositories[0].defaultBranch === 'main',
      'Project A should use the default branch main.'
    )
    assert(
      projectB.repositories[0].defaultBranch === 'develop',
      'Project B should use the default branch develop.'
    )
    assert(
      projectA.repositories[0].localPath === join(home, 'source-alpha'),
      'Project A should clone into the Cerebro home directory.'
    )

    await access(join(projectA.repositories[0].localPath, 'README.md'))
    await access(join(projectB.repositories[0].localPath, 'README.md'))
    await access(join(projectA.repositories[0].localPath, '.git'))
    await access(join(projectB.repositories[0].localPath, '.git'))
    await access(join(projectC.repositories[0].localPath, '.git'))

    const listed = await listProjects()
    assert(listed.projects.length === 3, `Expected 3 projects, found ${listed.projects.length}.`)
    assert(
      listed.activeWorkspaceId === null,
      'Creating a project should not auto-focus a workspace.'
    )
    assert(
      listed.projects.every((project) => project.repositories.length === 1),
      'Each project should list its linked git repository.'
    )
    assert(
      listed.projects.every((project) => project.workspaces.length >= 1),
      'Each project should have at least one workspace.'
    )
    assert(
      listed.projects.some((project) => project.repositories[0].gitUrl.endsWith('source-alpha')),
      'Listed projects should include the first cloned repository.'
    )
    assert(
      listed.projects.some((project) => project.repositories[0].gitUrl.endsWith('source-beta')),
      'Listed projects should include the second cloned repository.'
    )
    assert(
      listed.projects.some((project) =>
        project.repositories[0].gitUrl.includes('octocat/Hello-World')
      ),
      'Listed projects should include the HTTPS GitHub repository.'
    )
    assert(projectC.github?.owner === 'octocat', 'GitHub owner should be parsed.')
    assert(projectC.github?.repo === 'Hello-World', 'GitHub repo should be parsed.')

    console.log('Project clone + multi-project persistence verified.')

    const openedRepo = join(sources, 'opened-local')
    await initGitRepo(openedRepo, 'main', 'opened-local')
    const opened = await createProjectFromDirectory(openedRepo)
    assert(opened.kind === 'directory', 'Opened git folder should be a directory project.')
    assert(opened.repositories.length === 1, 'Opened git folder should link one repository.')
    assert(
      opened.repositories[0].localPath === (await realpath(openedRepo)),
      'Opened git folder should use the original path instead of cloning.'
    )

    const siblingsDir = join(sources, 'siblings')
    await initGitRepo(join(siblingsDir, 'svc-a'), 'main', 'svc-a')
    await initGitRepo(join(siblingsDir, 'svc-b'), 'develop', 'svc-b')
    const siblings = await createProjectFromDirectory(siblingsDir)
    assert(siblings.kind === 'directory', 'A non-git parent should be a directory workspace.')
    assert(siblings.github === null, 'A non-git folder is not GitHub-linked.')
    assert(siblings.repositories.length === 1, 'Sibling git repos should not be imported.')
    assert(
      siblings.repositories[0].localPath === (await realpath(siblingsDir)),
      'The selected folder should be the workspace path.'
    )
    assert(siblings.workspaces.length === 1, 'A non-git folder is one workspace.')
    assert(siblings.workspaces[0].kind === 'default', 'A non-git folder workspace is kind default.')
    assert(siblings.workspaces[0].branch === '', 'A non-git folder has no branch.')

    const plainDir = join(sources, 'plain-folder')
    await mkdir(plainDir, { recursive: true })
    await writeFile(join(plainDir, 'notes.txt'), 'hello\n')
    const plain = await createProjectFromDirectory(plainDir)
    assert(plain.kind === 'directory', 'A non-git folder should still become a directory project.')
    assert(
      plain.repositories[0].localPath === (await realpath(plainDir)),
      'A non-git folder should open at the selected path.'
    )

    const afterDirectory = await listProjects()
    assert(
      afterDirectory.projects.length === 6,
      `Expected 6 projects, found ${afterDirectory.projects.length}.`
    )
    assert(
      afterDirectory.projects.every((project) => project.kind !== 'multi-root'),
      'Listed projects should not include a multi-root workspace.'
    )

    console.log('Directory project import verified.')
    console.log(
      JSON.stringify(
        {
          home,
          projects: afterDirectory.projects.map((project) => ({
            id: project.id,
            name: project.name,
            kind: project.kind,
            github: project.github,
            workspaces: project.workspaces.map((workspace) => ({
              id: workspace.id,
              kind: workspace.kind,
              branch: workspace.branch,
              localPath: workspace.localPath
            })),
            repos: project.repositories.map((repo) => ({
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
