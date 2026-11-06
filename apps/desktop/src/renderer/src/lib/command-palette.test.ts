import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatSearchHit } from '@cerebro/core'
import type { Project, Workspace } from '../../../shared/types'
import {
  PALETTE_GROUP_CAP,
  buildPaletteGroups,
  highlightParts,
  nextPaletteFilter,
  searchPaletteProjects,
  searchPaletteWorkspaces
} from './command-palette'

function workspace(
  partial: Partial<Workspace> & Pick<Workspace, 'id' | 'kind' | 'branch'>
): Workspace {
  return {
    projectId: 1,
    repositoryId: 1,
    localPath: '/tmp/repo',
    status: 'todo',
    displayName: null,
    createdAt: '',
    pullRequest: null,
    ...partial
  }
}

function project(partial: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    kind: 'clone',
    github: null,
    repositories: [{ id: partial.id, defaultBranch: 'main' }],
    workspaces: [],
    ...partial
  } as Project
}

function hit(sessionId: string, workspaceId: number, open: boolean): ChatSearchHit {
  return {
    sessionId,
    workspaceId,
    open,
    title: sessionId,
    updatedAt: 0,
    snippet: ''
  } as ChatSearchHit
}

const cerebro = project({
  id: 1,
  name: 'cerebro',
  workspaces: [
    workspace({ id: 10, kind: 'default', branch: 'main' }),
    workspace({ id: 11, kind: 'worktree', branch: 'command-palette' })
  ]
})
const palette = project({
  id: 2,
  name: 'palette-tokens',
  workspaces: [workspace({ id: 20, projectId: 2, kind: 'default', branch: 'main' })]
})
const notes = project({
  id: 3,
  name: 'notes',
  kind: 'directory',
  repositories: [{ id: 3, defaultBranch: '' }] as Project['repositories'],
  workspaces: [workspace({ id: 30, projectId: 3, kind: 'default', branch: '' })]
})
const projects = [cerebro, palette, notes]

test('projects exclude plain folders and rank prefix matches first', () => {
  assert.deepEqual(
    searchPaletteProjects(projects, '').map((row) => row.key),
    ['project:1', 'project:2']
  )
  assert.deepEqual(
    searchPaletteProjects(projects, 'PAL').map((row) => row.key),
    ['project:2']
  )
})

test('workspaces match label, branch and project name, and name the row kind', () => {
  const rows = searchPaletteWorkspaces(projects, 'palette')
  assert.deepEqual(
    rows.map((row) => row.key),
    ['workspace:20', 'workspace:11']
  )
  const kinds = searchPaletteWorkspaces(projects, '').map((row) =>
    row.type === 'workspace' ? `${row.label}:${row.kind}` : ''
  )
  assert.deepEqual(kinds, [
    'main:default',
    'command-palette:worktree',
    'main:default',
    'notes:directory'
  ])
})

test('All lists Projects, Workspaces, Sessions, then History, capped per group', () => {
  const hits = [
    hit('a', 10, true),
    hit('b', 11, false),
    ...Array.from({ length: 6 }, (_, index) => hit(`h${index}`, 10, false))
  ]
  const groups = buildPaletteGroups({
    projects,
    hits,
    query: '',
    filter: 'all',
    scopeWorkspaceId: null
  })
  assert.deepEqual(
    groups.map((group) => group.key),
    ['project', 'workspace', 'session', 'history']
  )
  const history = groups[3]
  assert.equal(history.total, 7)
  assert.equal(history.rows.length, PALETTE_GROUP_CAP)
})

test('a single filter lists every match of that group', () => {
  const hits = Array.from({ length: 6 }, (_, index) => hit(`h${index}`, 10, false))
  const groups = buildPaletteGroups({
    projects,
    hits,
    query: '',
    filter: 'history',
    scopeWorkspaceId: null
  })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].rows.length, 6)
})

test('workspace scope keeps only that workspace sessions and history', () => {
  const groups = buildPaletteGroups({
    projects,
    hits: [hit('a', 10, true), hit('b', 11, true), hit('c', 10, false)],
    query: '',
    filter: 'all',
    scopeWorkspaceId: 10
  })
  assert.deepEqual(
    groups.map((group) => [group.key, group.rows.map((row) => row.key)]),
    [
      ['session', ['session:a']],
      ['history', ['history:c']]
    ]
  )
})

test('Tab cycles filters in display order', () => {
  assert.equal(nextPaletteFilter('all', 1), 'project')
  assert.equal(nextPaletteFilter('history', 1), 'all')
  assert.equal(nextPaletteFilter('all', -1), 'history')
})

test('highlight splits around the first case-insensitive match', () => {
  assert.deepEqual(highlightParts('Command Palette', 'pal'), {
    before: 'Command ',
    match: 'Pal',
    after: 'ette'
  })
  assert.equal(highlightParts('main', 'x'), null)
  assert.equal(highlightParts('main', ' '), null)
})
