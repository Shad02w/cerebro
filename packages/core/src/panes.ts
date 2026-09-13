/** Live BSP layout shared by Electron and the CLI. IDs are persistent across mux restarts. */
export type PaneKind = 'terminal' | 'changes' | 'chat'
export type SplitDirection = 'auto' | 'right' | 'down'
export type Pane = {
  type: 'pane'
  id: number
  kind: PaneKind
  repositoryId?: number | null
  state?: { version: 1; selectedId?: string | null; filesOpen?: boolean; filesWidth?: number }
}
export type PaneSplit = {
  type: 'split'
  id: number
  direction: 'right' | 'down'
  ratio: number
  first: PaneNode
  second: PaneNode
}
export type PaneNode = Pane | PaneSplit
export type WorkspaceTab = {
  id: number
  kind: PaneKind
  label: string
  root: PaneNode
  activePaneId: number
}
export type WorkspaceTabs = { tabs: WorkspaceTab[]; activeTabId: number | null; nextLabel: number }
export type LayoutState = {
  epoch?: string
  revision: number
  workspaces: Record<number, WorkspaceTabs>
}
export type LayoutCommand = {
  target: 'tab' | 'pane'
  action: 'list' | 'create' | 'split' | 'focus' | 'close' | 'resize' | 'reorder' | 'open-changes'
  workspaceId: number
  tabId?: number
  paneId?: number
  kind?: PaneKind
  direction?: SplitDirection
  splitId?: number
  ratio?: number
  repositoryId?: number
  toIndex?: number
}
export type LayoutReply = { state: LayoutState; result: unknown }
