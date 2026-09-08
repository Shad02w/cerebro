import { BrowserWindow, ipcMain } from 'electron'
import {
  getWorkspaceLocalPath,
  type LayoutCommand,
  type LayoutState,
  type Pane,
  type PaneNode,
  type WorkspaceTab,
  type LayoutReply
} from '@cerebro/core'
import { IPC } from '../shared/ipc'

const state: LayoutState = { revision: 0, workspaces: {} }
let nextId = 1
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
function broadcast(): void {
  state.revision++
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.layout.changed, state)
  }
}
export function removeWorkspaceLayout(workspaceId: number): void {
  const workspace = state.workspaces[workspaceId]
  if (!workspace) return
  for (const tab of workspace.tabs) for (const pane of leaves(tab.root)) sizes.delete(pane.id)
  delete state.workspaces[workspaceId]
  broadcast()
}

export function layoutCommand(raw: unknown): LayoutReply {
  if (!raw || typeof raw !== 'object') fail('usage', 'Layout command is required.')
  const command = raw as LayoutCommand
  const workspaceId = id(command.workspaceId, 'Workspace ID')
  if (!['tab', 'pane'].includes(command.target)) fail('usage', 'Unknown layout target.')
  const actions =
    command.target === 'tab'
      ? ['list', 'create', 'focus', 'close', 'reorder', 'open-changes']
      : ['list', 'split', 'focus', 'close', 'resize']
  if (!actions.includes(command.action)) fail('usage', 'Unknown layout action.')
  for (const key of ['tabId', 'paneId', 'splitId'] as const)
    if (command[key] !== undefined) id(command[key], key)
  if (command.kind !== undefined && !['terminal', 'changes'].includes(command.kind))
    fail('usage', 'Kind must be terminal or changes.')
  if (command.direction !== undefined && !['auto', 'right', 'down'].includes(command.direction))
    fail('usage', 'Direction must be auto, right or down.')
  try {
    getWorkspaceLocalPath(workspaceId)
  } catch {
    fail('not_found', `Workspace ${workspaceId} not found.`)
  }
  const workspace = state.workspaces[workspaceId] ?? { tabs: [], activeTabId: null, nextLabel: 1 }
  const reply = (result: unknown): LayoutReply => ({ state, result })
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
        workspace.activeTabId = existing.id
        existing.activePaneId = leaves(existing.root).find((pane) => pane.kind === 'changes')!.id
        broadcast()
        return reply(existing)
      }
    }
    const kind = command.action === 'open-changes' ? 'changes' : (command.kind ?? 'terminal')
    const pane: Pane = { type: 'pane', id: nextId++, kind }
    const tab: WorkspaceTab = {
      id: nextId++,
      kind,
      label: kind === 'terminal' ? `Terminal ${workspace.nextLabel++}` : 'Changes',
      root: pane,
      activePaneId: pane.id
    }
    workspace.tabs.push(tab)
    workspace.activeTabId = tab.id
    state.workspaces[workspaceId] = workspace
    broadcast()
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
        const size = sizes.get(pane.id) ?? { width: 1200, height: 800 }
        const direction =
          !command.direction || command.direction === 'auto'
            ? size.width >= size.height
              ? 'right'
              : 'down'
            : command.direction
        const added: Pane = { type: 'pane', id: nextId++, kind: command.kind ?? 'terminal' }
        // A CLI caller can split again before the renderer reports the new bounds.
        const childSize =
          direction === 'right'
            ? { width: size.width / 2, height: size.height }
            : { width: size.width, height: size.height / 2 }
        sizes.set(pane.id, childSize)
        sizes.set(added.id, childSize)
        tab.root = replace(tab.root, pane.id, {
          type: 'split',
          id: nextId++,
          direction,
          ratio: 0.5,
          first: pane,
          second: added
        })!
        tab.activePaneId = added.id
        workspace.activeTabId = tab.id
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
  broadcast()
  return reply(result)
}

export function registerLayoutIpc(): void {
  ipcMain.handle(IPC.layout.get, () => state)
  ipcMain.handle(IPC.layout.command, (_event, command: unknown) => layoutCommand(command))
  ipcMain.on(IPC.layout.measure, (_event, paneId: unknown, width: unknown, height: unknown) => {
    if (
      typeof paneId !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return
    if (
      !Object.values(state.workspaces).some((workspace) =>
        workspace.tabs.some((tab) => find(tab.root, paneId)?.type === 'pane')
      )
    )
      return
    sizes.set(paneId, { width, height })
  })
}

export function knownWorkspaceIds(): number[] {
  return Object.keys(state.workspaces).map(Number)
}
