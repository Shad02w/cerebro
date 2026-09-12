import { parseGitUrl, isGitHubGitUrl } from '../../../../packages/core/src/git'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepositoryService, runCommand, githubJson } from './repository-service'
import { PULL_REQUESTS_QUERY, fetchPullRequestsByBranch } from './github-prs'
import { startMockGitHubServer, type MockPullRequest } from '../../e2e/mock-github'

function pr(number: number, patch: Partial<MockPullRequest> = {}): MockPullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/octocat/repo/pull/${number}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    mergeable: 'UNKNOWN',
    headRefName: `branch-${number}`,
    repoFullName: 'octocat/repo',
    ...patch
  }
}
async function login(mock: Awaited<ReturnType<typeof startMockGitHubServer>>): Promise<string> {
  const device = (await fetch(`${mock.baseUrl}/login/device/code`, { method: 'POST' }).then(
    (response) => response.json()
  )) as { device_code: string }
  mock.authorize(device.device_code)
  const result = (await fetch(`${mock.baseUrl}/login/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({ device_code: device.device_code })
  }).then((response) => response.json())) as { access_token: string }
  return result.access_token
}

test('real HTTP App provider validates GraphQL, paginates, preserves drafts and avoids fork collisions', async () => {
  const mock = await startMockGitHubServer()
  try {
    const token = await login(mock)
    mock.setPullRequests('octocat', 'repo', [
      ...Array.from({ length: 101 }, (_, index) => pr(index + 1)),
      pr(200, {
        headRefName: 'branch-1',
        isDraft: true,
        ciStatus: 'SUCCESS',
        ciChecks: [
          {
            __typename: 'CheckRun',
            name: 'Unit tests',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/octocat/repo/actions/runs/1'
          }
        ],
        reviewDecision: 'APPROVED',
        updatedAt: '2025-01-01T00:00:00Z'
      }),
      pr(201, {
        headRefName: 'branch-1',
        headRepoFullName: 'someone/fork',
        updatedAt: '2026-01-01T00:00:00Z'
      }),
      pr(202, { headRefName: 'branch-1', state: 'MERGED', updatedAt: '2026-01-01T00:00:00Z' })
    ])
    const service = new RepositoryService({
      getToken: async () => token,
      apiUrl: mock.baseUrl,
      run: async () => {
        throw new Error('Fallback must not run')
      }
    })
    const result = await service.pullRequests('octocat', 'repo')
    assert.equal(result.provider, 'github-app')
    assert.equal(result.available, true)
    assert.equal(Object.keys(result.byBranch).length, 101)
    assert.equal(result.byBranch['branch-1'].number, 200)
    assert.equal(result.byBranch['branch-1'].isDraft, true)
    assert.equal(result.byBranch['branch-1'].reviewDecision, 'approved')
    assert.equal(result.byBranch['branch-1'].ciStatus, 'success')
    assert.equal(result.byBranch['branch-1'].ciChecks?.[0].name, 'Unit tests')
    assert.equal(result.byBranch['branch-1'].ciChecks?.[0].state, 'success')
    assert.equal(result.byBranch['branch-1'].ciCheckCount, 1)
    assert.equal(result.byBranch['branch-2'].ciStatus, 'none')
    assert.equal(mock.requestCount(), 2)
    const malformed = await githubJson<{ errors: unknown[] }>(`${mock.baseUrl}/graphql`, token, {
      method: 'POST',
      body: JSON.stringify({
        query: PULL_REQUESTS_QUERY.replace(
          'orderBy: { field: UPDATED_AT, direction: DESC }',
          'states: UPDATED_AT, direction: DESC'
        ),
        variables: { owner: 'octocat', name: 'repo' }
      })
    })
    assert.ok(malformed.errors.length)
    mock.setPullRequests('octocat', 'repo', [])
    assert.deepEqual((await service.pullRequests('octocat', 'repo')).byBranch, {})
  } finally {
    await mock.close()
  }
})

test('CI states and denied checks preserve readable PR details', async () => {
  for (const [state, expected] of [
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['ERROR', 'failure'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
    [null, 'none']
  ] as const) {
    const node = {
      ...pr(1),
      isDraft: false,
      headRepository: { nameWithOwner: 'octocat/repo' },
      repository: { nameWithOwner: 'octocat/repo' },
      commits: { nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }] }
    }
    const data = {
      repository: {
        pullRequests: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } }
      }
    }
    const result = await fetchPullRequestsByBranch('octocat', 'repo', async () => ({ data }))
    assert.equal(result['branch-1'].ciStatus, expected)
    const denied = await fetchPullRequestsByBranch('octocat', 'repo', async () => ({
      data,
      errors: [
        {
          message: 'Checks denied',
          path: [
            'repository',
            'pullRequests',
            'nodes',
            0,
            'commits',
            'nodes',
            0,
            'commit',
            'statusCheckRollup'
          ]
        }
      ]
    }))
    assert.equal(denied['branch-1'].number, 1)
    assert.equal(denied['branch-1'].ciStatus, 'unavailable')
  }
})

test('App access failure falls through an actual gh executable; git-only status remains unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-provider-test-'))
  const mock = await startMockGitHubServer()
  try {
    const token = await login(mock)
    mock.setApiError(403)
    const fakeGh = join(root, 'gh')
    await writeFile(
      fakeGh,
      `#!/usr/bin/env node\nlet input='';process.stdin.on('data', x=>input+=x);process.stdin.on('end',()=>{const request=JSON.parse(input);if(!request.query.includes('orderBy:'))process.exit(2);process.stdout.write(JSON.stringify({data:{repository:{pullRequests:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}));});\n`,
      { mode: 0o755 }
    )
    const service = new RepositoryService({
      getToken: async () => token,
      apiUrl: mock.baseUrl,
      run: (command, args, options) =>
        runCommand(command === 'gh' ? fakeGh : command, args, options)
    })
    const result = await service.pullRequests('octocat', 'repo')
    assert.equal(result.provider, 'gh')
    assert.equal(result.available, true)
    assert.match(result.issues[0].message, /access failed/)
    const offline = new RepositoryService({
      getToken: async () => null,
      run: async () => {
        throw new Error('gh is not installed')
      }
    })
    const unavailable = await offline.pullRequests('octocat', 'repo')
    assert.equal(unavailable.available, false)
    assert.deepEqual(
      unavailable.issues.map((issue) => issue.provider),
      ['github-app', 'gh', 'git']
    )
  } finally {
    await mock.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('expired App token is renewed before fallback; rate limits stop fallback', async () => {
  const mock = await startMockGitHubServer()
  try {
    const token = await login(mock)
    let renewed = 0
    const service = new RepositoryService({
      getToken: async (force) => {
        if (force) renewed++
        return force ? token : 'expired'
      },
      apiUrl: mock.baseUrl,
      run: async () => {
        throw new Error('must not use gh')
      }
    })
    assert.equal((await service.pullRequests('octocat', 'repo')).provider, 'github-app')
    assert.equal(renewed, 1)
    mock.setApiError(429)
    const result = await service.pullRequests('octocat', 'repo')
    assert.equal(result.available, false)
    assert.equal(result.issues.length, 1)
    assert.ok(result.retryAfterMs! >= 60000)
  } finally {
    await mock.close()
  }
})

test('Git fallback reads real branches and creates a checkout without persisting App credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cerebro-git-provider-'))
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await runCommand('git', ['init', '-b', 'main'], { cwd: source })
    await runCommand(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'init'
      ],
      { cwd: source }
    )
    await runCommand('git', ['branch', 'feature/test'], { cwd: source })
    const clone = join(root, 'clone')
    const service = new RepositoryService({
      getToken: async () => 'test-secret-token',
      run: (command, args, options) =>
        command === 'gh'
          ? Promise.reject(new Error('not logged in'))
          : runCommand(command, args, options)
    })
    await service.git(['clone', '--', source, clone])
    assert.doesNotMatch(
      await readFile(join(clone, '.git/config'), 'utf8'),
      /test-secret-token|AUTHORIZATION/
    )
    const offline = new RepositoryService({
      getToken: async () => null,
      run: (command, args, options) =>
        command === 'gh'
          ? Promise.reject(new Error('not logged in'))
          : runCommand(command, args, options)
    })
    assert.deepEqual(await offline.branches('octocat', 'repo', clone), ['feature/test', 'main'])
    await runCommand('git', ['remote', 'set-url', 'origin', join(root, 'missing')], { cwd: clone })
    assert.deepEqual(await offline.branches('octocat', 'repo', clone), ['feature/test', 'main'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Git network strategy tries App then gh then system credentials without replaying local mutations', async () => {
  const calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = []
  const service = new RepositoryService({
    getToken: async () => 'secret',
    run: async (command, args, options) => {
      calls.push({ command, args, env: options?.env })
      if (command === 'gh') return 'logged in'
      if (options?.env) throw new Error('denied')
      return 'fetched'
    }
  })
  assert.equal(await service.git(['fetch', '--prune', 'origin'], '/checkout'), 'fetched')
  assert.deepEqual(
    calls.map((call) => call.command),
    ['git', 'gh', 'git', 'git']
  )
  assert.ok(
    Object.values(calls[0].env!).some((value) => value?.startsWith('AUTHORIZATION: basic '))
  )
  assert.ok(Object.values(calls[2].env!).includes('!gh auth git-credential'))
  assert.equal(calls[3].env, undefined)
  assert.ok(calls.every((call) => !call.args.join(' ').includes('secret')))
})

test('repository polling bounds simultaneous provider requests', async () => {
  let active = 0
  let maximum = 0
  const service = new RepositoryService({
    getToken: async () => null,
    run: async () => {
      maximum = Math.max(maximum, ++active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return JSON.stringify({
        data: {
          repository: {
            pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
          }
        }
      })
    }
  })
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) => service.pullRequests('octocat', `repo-${index}`))
  )
  assert.equal(maximum, 4)
  assert.ok(results.every((result) => result.available && result.provider === 'gh'))
})

test('repository identity supports HTTPS, scp and ssh Git remotes', () => {
  for (const url of [
    'https://github.com/octocat/repo.git',
    'git@github.com:octocat/repo.git',
    'ssh://git@github.com/octocat/repo.git',
    'ssh://git@github.com:443/octocat/repo.git',
    'https://github.com/octocat/repo.git/'
  ]) {
    assert.deepEqual(parseGitUrl(url).github, { owner: 'octocat', repo: 'repo' })
    assert.equal(isGitHubGitUrl(url), true)
  }
  assert.equal(parseGitUrl('https://example.com/octocat/repo.git').github, null)
})

test('individual CI checks preserve conclusions, running states, external statuses and bounded results', async () => {
  const mock = await startMockGitHubServer()
  try {
    const token = await login(mock)
    const states = [
      'SUCCESS',
      'FAILURE',
      'CANCELLED',
      'SKIPPED',
      'NEUTRAL',
      'TIMED_OUT',
      'ACTION_REQUIRED',
      'STARTUP_FAILURE',
      'STALE'
    ]
    mock.setPullRequests('octocat', 'repo', [
      pr(1, {
        ciStatus: 'PENDING',
        ciChecks: [
          ...states.map((conclusion) => ({
            __typename: 'CheckRun' as const,
            name: conclusion,
            status: 'COMPLETED',
            conclusion,
            detailsUrl: 'https://github.com/octocat/repo/actions/runs/1'
          })),
          ...['IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED', 'PENDING'].map((status) => ({
            __typename: 'CheckRun' as const,
            name: status,
            status,
            conclusion: null,
            detailsUrl: null
          })),
          {
            __typename: 'StatusContext',
            context: 'Deploy',
            state: 'ERROR',
            description: 'Deploy failed',
            targetUrl: 'https://ci.example.com/build/1'
          },
          {
            __typename: 'StatusContext',
            context: 'Unsafe link',
            state: 'SUCCESS',
            description: null,
            targetUrl: 'javascript:alert(1)'
          },
          ...Array.from({ length: 10 }, (_, i) => ({
            __typename: 'CheckRun' as const,
            name: `extra-${i}`,
            status: 'QUEUED',
            conclusion: null,
            detailsUrl: null
          }))
        ]
      })
    ])
    const service = new RepositoryService({ getToken: async () => token, apiUrl: mock.baseUrl })
    const result = (await service.pullRequests('octocat', 'repo')).byBranch['branch-1']
    assert.equal(result.ciCheckCount, 26)
    assert.equal(result.ciChecks?.length, 20)
    assert.deepEqual(
      result.ciChecks?.slice(0, 9).map((c) => c.state),
      states.map((s) => s.toLowerCase())
    )
    assert.deepEqual(
      result.ciChecks?.slice(9, 14).map((c) => c.state),
      ['in_progress', 'queued', 'waiting', 'queued', 'pending']
    )
    assert.equal(result.ciChecks?.[14].state, 'failure')
    assert.equal(result.ciChecks?.[14].description, 'Deploy failed')
    assert.equal(result.ciChecks?.[14].url, 'https://ci.example.com/build/1')
    assert.equal(result.ciChecks?.[15].url, null)
  } finally {
    await mock.close()
  }
})
