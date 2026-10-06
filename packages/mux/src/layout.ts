import {
  getWorkspaceLocalPath,
  TAB_LABEL_MAX_LENGTH,
  type LayoutCommand,
  type LayoutState,
  type Pane,
  type PaneNode,
  type WorkspaceTabs,
  type WorkspaceTab
} from '@cerebro/core'
import { getDb } from '@cerebro/core'
import type { DatabaseSync } from 'node:sqlite'

// SQLite is the source of truth: `workspaces` decides which workspaces exist, `mux_layout` holds
// one tab/pane JSON record per workspace, and `mux_meta` holds the ID/revision counters. Nothing
// here is cached between calls, so a deleted workspace can never be written back.
type Sequence = { nextId: number; revision: number }
export type LayoutChange = {
  revision: number
  workspaceId: number
  workspace: WorkspaceTabs | null
  result: unknown
}
type LayoutRow = { workspace_id: number; value: string }

export function loadLayout(): LayoutState {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS mux_layout (workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mux_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  const workspaces: Record<number, WorkspaceTabs> = {}
  for (const row of db.prepare('SELECT workspace_id, value FROM mux_layout').all() as LayoutRow[])
    workspaces[row.workspace_id] = parseLayout(row.value)
  return { revision: readSequence(db).revision, workspaces }
}
function parseLayout(value: string): WorkspaceTabs {
  const record = JSON.parse(value)
  if (record.version !== undefined && record.version !== 1)
    throw new Error('Unsupported mux layout storage version.')
  return record.layout ?? record
}
function readSequence(db: DatabaseSync): Sequence {
  const saved = db.prepare("SELECT value FROM mux_meta WHERE key = 'sequence'").get() as
    { value: string } | undefined
  return saved ? JSON.parse(saved.value) : { nextId: 1, revision: 0 }
}
function writeSequence(db: DatabaseSync, sequence: Sequence): void {
  db.prepare("INSERT OR REPLACE INTO mux_meta VALUES ('sequence', ?)").run(JSON.stringify(sequence))
}
function readWorkspace(db: DatabaseSync, workspaceId: number): WorkspaceTabs | undefined {
  const row = db.prepare('SELECT value FROM mux_layout WHERE workspace_id = ?').get(workspaceId) as
    { value: string } | undefined
  return row ? parseLayout(row.value) : undefined
}
function writeWorkspace(db: DatabaseSync, workspaceId: number, workspace: WorkspaceTabs): void {
  db.prepare(
    'INSERT INTO mux_layout VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET value = excluded.value'
  ).run(workspaceId, JSON.stringify({ version: 1, layout: workspace }))
}
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
/** Drop layouts whose workspace was already deleted from the database and bump the revision. */
export function removeWorkspaceLayouts(workspaceIds: number[], paneIds: number[]): LayoutState {
  const db = getDb()
  transaction(db, () => {
    for (const workspaceId of workspaceIds)
      db.prepare('DELETE FROM mux_layout WHERE workspace_id = ?').run(workspaceId)
    const sequence = readSequence(db)
    sequence.revision++
    writeSequence(db, sequence)
  })
  for (const paneId of paneIds) sizes.delete(paneId)
  return loadLayout()
}
export function setPaneState(
  workspaceId: number,
  paneId: number,
  value: Pane['state']
): LayoutChange {
  const db = getDb()
  const workspace = readWorkspace(db, workspaceId)
  const pane = workspace?.tabs.flatMap((tab) => leaves(tab.root)).find((pane) => pane.id === paneId)
  if (!workspace || !pane) fail('not_found', 'Pane not found.')
  if (
    !value ||
    value.version !== 1 ||
    (value.selectedId !== undefined &&
      value.selectedId !== null &&
      typeof value.selectedId !== 'string') ||
    (value.filesOpen !== undefined && typeof value.filesOpen !== 'boolean') ||
    (value.filesWidth !== undefined &&
      (!Number.isFinite(value.filesWidth) || value.filesWidth < 160 || value.filesWidth > 480))
  )
    fail('usage', 'Invalid pane state.')
  if (JSON.stringify(pane.state) === JSON.stringify(value))
    return { revision: readSequence(db).revision, workspaceId, workspace, result: null }
  pane.state = value
  return transaction(db, () => {
    const sequence = readSequence(db)
    sequence.revision++
    writeWorkspace(db, workspaceId, workspace)
    writeSequence(db, sequence)
    return { revision: sequence.revision, workspaceId, workspace, result: null }
  })
}
// Pane sizes are renderer measurements, not layout state, so they stay in memory. They are only
// a hint for choosing a split direction, so the map is bounded instead of validated against the DB.
const MAX_MEASURED_PANES = 4096
export function measure(paneId: number, width: number, height: number): void {
  if (
    Number.isSafeInteger(paneId) &&
    paneId > 0 &&
    width <= 100000 &&
    height <= 100000 &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    sizes.delete(paneId)
    sizes.set(paneId, { width, height })
    if (sizes.size > MAX_MEASURED_PANES) sizes.delete(sizes.keys().next().value!)
  }
}
const sizes = new Map<number, { width: number; height: number }>()

export class LayoutError extends Error {
  constructor(
    public code: 'usage' | 'not_found' | 'conflict',
    message: string
  ) {
    super(message)
  }
}
function fail(code: 'usage' | 'not_found' | 'conflict', message: string): never {
  throw new LayoutError(code, message)
}
function id(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    fail('usage', `${name} must be a positive integer.`)
  return value
}
function leaves(node: PaneNode): Pane[] {
  return node.type === 'pane' ? [node] : [...leaves(node.first), ...leaves(node.second)]
}
function find(node: PaneNode, target: number): PaneNode | undefined {
  return node.id === target
    ? node
    : node.type === 'split'
      ? (find(node.first, target) ?? find(node.second, target))
      : undefined
}
function replace(node: PaneNode, target: number, replacement: PaneNode | null): PaneNode | null {
  if (node.id === target) return replacement
  if (node.type === 'pane') return node
  const first = replace(node.first, target, replacement)
  const second = replace(node.second, target, replacement)
  return first && second ? { ...node, first, second } : (first ?? second)
}
type CommandOutcome = {
  workspaceId: number
  workspace: WorkspaceTabs
  result: unknown
  changed: boolean
}
function applyCommand(raw: unknown, db: DatabaseSync, sequence: Sequence): CommandOutcome {
  let changed = false
  if (!raw || typeof raw !== 'object') fail('usage', 'Layout command is required.')
  const command = raw as LayoutCommand
  const workspaceId = id(command.workspaceId, 'Workspace ID')
  if (!['tab', 'pane'].includes(command.target)) fail('usage', 'Unknown layout target.')
  const actions =
    command.target === 'tab'
      ? ['list', 'create', 'focus', 'close', 'reorder', 'open-changes', 'rename']
      : ['list', 'split', 'focus', 'close', 'resize']
  if (!actions.includes(command.action)) fail('usage', 'Unknown layout action.')
  for (const key of ['tabId', 'paneId', 'splitId'] as const)
    if (command[key] !== undefined) id(command[key], key)
  if (command.kind !== undefined && !['terminal', 'changes', 'chat'].includes(command.kind))
    fail('usage', 'Kind must be terminal, changes or chat.')
  if (command.direction !== undefined && !['auto', 'right', 'down'].includes(command.direction))
    fail('usage', 'Direction must be auto, right or down.')
  if (command.focus !== undefined && typeof command.focus !== 'boolean')
    fail('usage', 'Focus must be a boolean.')
  const focus = command.focus !== false
  try {
    getWorkspaceLocalPath(workspaceId)
  } catch {
    fail('not_found', `Workspace ${workspaceId} not found.`)
  }
  const workspace = readWorkspace(db, workspaceId) ?? { tabs: [], activeTabId: null, nextLabel: 1 }
  const reply = (result: unknown): CommandOutcome => ({
    workspaceId,
    workspace,
    result,
    changed
  })
  if (command.target === 'tab' && command.action === 'list') return reply(workspace.tabs)
  if (
    command.target === 'tab' &&
    (command.action === 'create' || command.action === 'open-changes')
  ) {
    if (command.action === 'open-changes') {
      const existing = workspace.tabs.find((tab) =>
        leaves(tab.root).some((pane) => pane.kind === 'changes')
      )
      if (existing) {
        if (focus) {
          workspace.activeTabId = existing.id
          existing.activePaneId = leaves(existing.root).find((pane) => pane.kind === 'changes')!.id
          changed = true
        }
        return reply(existing)
      }
    }
    if (workspace.tabs.length >= 256) fail('conflict', 'Workspace tab limit reached.')
    const kind = command.action === 'open-changes' ? 'changes' : (command.kind ?? 'terminal')
    const pane: Pane = {
      type: 'pane',
      id: sequence.nextId++,
      kind,
      repositoryId: command.repositoryId ?? null
    }
    const tab: WorkspaceTab = {
      id: sequence.nextId++,
      kind,
      label:
        kind === 'terminal'
          ? `Terminal ${workspace.nextLabel++}`
          : kind === 'chat'
            ? 'Agent'
            : 'Changes',
      root: pane,
      activePaneId: pane.id
    }
    workspace.tabs.push(tab)
    if (focus) workspace.activeTabId = tab.id
    changed = true
    return reply(tab)
  }
  const tab =
    command.tabId !== undefined
      ? workspace.tabs.find((tab) => tab.id === command.tabId)
      : command.paneId !== undefined
        ? workspace.tabs.find((tab) => leaves(tab.root).some((pane) => pane.id === command.paneId))
        : workspace.tabs.find((tab) => tab.id === workspace.activeTabId)
  if (!tab) fail('not_found', 'Tab not found in this workspace.')
  const closeTab = (): void => {
    const index = workspace.tabs.indexOf(tab)
    for (const pane of leaves(tab.root)) sizes.delete(pane.id)
    workspace.tabs.splice(index, 1)
    if (workspace.activeTabId === tab.id)
      workspace.activeTabId = (workspace.tabs[index] ?? workspace.tabs[index - 1])?.id ?? null
  }
  let result: unknown = tab
  if (command.target === 'tab') {
    if (command.action === 'close') {
      closeTab()
      result = { closedTabId: tab.id }
    } else if (command.action === 'focus') workspace.activeTabId = tab.id
    else if (command.action === 'reorder') {
      if (
        !Number.isInteger(command.toIndex) ||
        command.toIndex! < 0 ||
        command.toIndex! >= workspace.tabs.length
      )
        fail('usage', 'Tab index is out of range.')
      workspace.tabs.splice(workspace.tabs.indexOf(tab), 1)
      workspace.tabs.splice(command.toIndex!, 0, tab)
    } else if (command.action === 'rename') {
      const label = command.label?.trim()
      if (!label) fail('usage', 'Label is required.')
      tab.label = label.slice(0, TAB_LABEL_MAX_LENGTH)
    }
  } else {
    if (command.action === 'list')
      return reply(
        leaves(tab.root).map((pane) => ({
          ...pane,
          tabId: tab.id,
          active: pane.id === tab.activePaneId
        }))
      )
    if (command.action === 'resize') {
      const split = find(tab.root, id(command.splitId, 'Split ID'))
      if (!split || split.type !== 'split') fail('not_found', 'Split not found in this tab.')
      if (
        typeof command.ratio !== 'number' ||
        !Number.isFinite(command.ratio) ||
        command.ratio < 0.1 ||
        command.ratio > 0.9
      )
        fail('usage', 'Ratio must be between 0.1 and 0.9.')
      split.ratio = command.ratio
      result = split
    } else {
      const pane = find(tab.root, command.paneId ?? tab.activePaneId)
      if (!pane || pane.type !== 'pane') fail('not_found', 'Pane not found in this tab.')
      if (command.action === 'split') {
        if (leaves(tab.root).length >= 256) fail('conflict', 'Tab pane limit reached.')
        const size = sizes.get(pane.id) ?? { width: 1200, height: 800 }
        const direction =
          !command.direction || command.direction === 'auto'
            ? size.width >= size.height
              ? 'right'
              : 'down'
            : command.direction
        const added: Pane = {
          type: 'pane',
          id: sequence.nextId++,
          kind: command.kind ?? 'terminal',
          repositoryId: command.repositoryId ?? pane.repositoryId ?? null
        }
        // A CLI caller can split again before the renderer reports the new bounds.
        const childSize =
          direction === 'right'
            ? { width: size.width / 2, height: size.height }
            : { width: size.width, height: size.height / 2 }
        sizes.set(pane.id, childSize)
        sizes.set(added.id, childSize)
        tab.root = replace(tab.root, pane.id, {
          type: 'split',
          id: sequence.nextId++,
          direction,
          ratio: 0.5,
          first: pane,
          second: added
        })!
        if (focus) {
          tab.activePaneId = added.id
          workspace.activeTabId = tab.id
        }
        result = { ...added, tabId: tab.id }
      } else if (command.action === 'focus') {
        tab.activePaneId = pane.id
        workspace.activeTabId = tab.id
        result = pane
      } else if (command.action === 'close') {
        const root = replace(tab.root, pane.id, null)
        sizes.delete(pane.id)
        if (!root) closeTab()
        else {
          // Prefer the surviving sibling subtree before falling back to another leaf.
          function sibling(node: PaneNode): PaneNode | undefined {
            if (node.type === 'pane') return undefined
            if (node.first.id === pane!.id) return node.second
            if (node.second.id === pane!.id) return node.first
            return sibling(node.first) ?? sibling(node.second)
          }
          const neighbor = sibling(tab.root)
          tab.root = root
          if (tab.activePaneId === pane.id) tab.activePaneId = leaves(neighbor ?? root)[0].id
        }
        result = { closedPaneId: pane.id }
      }
    }
  }
  changed = true
  return reply(result)
}

export function layoutCommand(raw: unknown): LayoutChange {
  const db = getDb()
  const measurements = new Map(sizes)
  try {
    return transaction(db, () => {
      const sequence = readSequence(db)
      const outcome = applyCommand(raw, db, sequence)
      if (outcome.changed) {
        sequence.revision++
        writeWorkspace(db, outcome.workspaceId, outcome.workspace)
        writeSequence(db, sequence)
      }
      return {
        revision: sequence.revision,
        workspaceId: outcome.workspaceId,
        workspace: outcome.workspace,
        result: outcome.result
      }
    })
  } catch (error) {
    sizes.clear()
    for (const [key, value] of measurements) sizes.set(key, value)
    throw error
  }
}
