import type { LayoutCommand, LayoutState, LayoutReply } from '@cerebro/core'
import type { TerminalThemeId } from './terminal-themes'
export type LinkedRepository = {
  id: number
  projectId: number
  gitUrl: string
  name: string
  localPath: string
  defaultBranch: string
  createdAt: string
}

export type WorkspacePullRequestState = 'open' | 'closed' | 'merged'

export type WorkspacePullRequestReviewDecision =
  'approved' | 'changes_requested' | 'review_required' | 'none'

export type WorkspaceCiCheck = {
  name: string
  state:
    | 'success'
    | 'failure'
    | 'in_progress'
    | 'queued'
    | 'pending'
    | 'waiting'
    | 'cancelled'
    | 'skipped'
    | 'neutral'
    | 'timed_out'
    | 'action_required'
    | 'startup_failure'
    | 'stale'
    | 'unavailable'
  url: string | null
  description: string | null
}

export type WorkspacePullRequest = {
  number: number
  title: string
  url: string
  createdAt: string
  state: WorkspacePullRequestState
  isDraft: boolean
  reviewDecision: WorkspacePullRequestReviewDecision
  mergeable: boolean | null
  ciStatus?: 'success' | 'failure' | 'pending' | 'none' | 'unavailable'
  ciChecks?: WorkspaceCiCheck[]
  ciCheckCount?: number
  repoFullName: string
}

export type WorkspaceKind = 'default' | 'worktree' | 'root'

export type Workspace = {
  id: number
  projectId: number
  repositoryId: number
  kind: WorkspaceKind
  branch: string
  localPath: string
  createdAt: string
  pullRequest: WorkspacePullRequest | null
  prStatus?: {
    state: 'loading' | 'ready' | 'stale' | 'unavailable'
    provider: RepositoryProvider | null
    checkedAt: string | null
    message: string | null
  }
}

export type RepositoryProvider = 'github-app' | 'gh' | 'git'
export type ProviderIssue = { provider: RepositoryProvider; message: string }
export type RepositoryPullRequests = {
  provider: RepositoryProvider
  available: boolean
  checkedAt: string
  byBranch: Record<string, WorkspacePullRequest>
  issues: ProviderIssue[]
  retryAfterMs?: number
}
export type WorkspaceRepository = {
  workspaceId: number
  branch: string | null
  github: ProjectGitHub | null
}

export type ProjectGitHub = {
  owner: string
  repo: string
}

export type ProjectKind = 'clone' | 'directory' | 'multi-root'

export type Project = {
  id: number
  name: string
  kind: ProjectKind
  createdAt: string
  updatedAt: string
  repositories: LinkedRepository[]
  workspaces: Workspace[]
  github: ProjectGitHub | null
}

export type ProjectListResult = {
  projects: Project[]
  activeWorkspaceId: number | null
}

export type ProjectBranch = {
  name: string
  hasWorkspace: boolean
}

export type PtyOpenResult = {
  sessionId: number
  continuation?: import('@cerebro/core').TerminalContinuation
  scrollback?: number
  data: string
  cols: number
  rows: number
  sequence: number
  status: 'running' | 'exited' | 'interrupted' | 'failed'
  readOnly?: boolean
  previousScreen?: string
  error?: string
}

export type PtyDataEvent = {
  sessionId: number
  data: string
  sequence: number
  cols: number
  rows: number
}

export type PtyExitEvent = {
  sessionId: number
  exitCode: number
  status?: string
  error?: string
  signal?: number
}

export const TERMINAL_FONT_FAMILY_AUTO = 'auto'
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 24

export type ChangedFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export type ChangedFileKind = 'text' | 'binary' | 'image'

export type ChangedFile = {
  path: string
  oldPath: string | null
  status: ChangedFileStatus
}

export type RepoChangeGroup = {
  repositoryId: number
  repositoryName: string
  workspaceId: number
  files: ChangedFile[]
}

export type WorkspaceChanges = {
  workspaceId: number
  groups: RepoChangeGroup[]
}

export type FileImageContents = {
  dataUrl: string | null
  byteLength: number
}

export type FileDiffContents = {
  repositoryId: number
  path: string
  oldPath: string | null
  status: ChangedFileStatus
  kind: ChangedFileKind
  oldContents: string | null
  newContents: string | null
  oldImage?: FileImageContents | null
  newImage?: FileImageContents | null
}

/** Stored keyboard shortcut overrides keyed by action id (e.g. `closeTab`). */
export type KeybindOverrides = Partial<Record<string, string>>

export type AppSettings = {
  defaultCloneDir: string
  terminalTheme: TerminalThemeId
  terminalFontSize: number
  /** `'auto'` or a CSS font-family name such as `Cerebro Mono`. */
  terminalFontFamily: string
  /** Partial overrides; missing keys use app defaults. */
  keybinds: KeybindOverrides
}

export type AppSettingsPatch = Partial<AppSettings>

export type NativeCommandId = 'closeWindow' | 'toggleDevTools'

export type GitHubAccount = {
  login: string
  name: string | null
  avatarUrl: string
}

export type GitHubStatus =
  | { state: 'unconfigured' }
  | { state: 'disconnected' }
  | {
      state: 'pending'
      userCode: string
      verificationUri: string
      expiresAt: string
    }
  | {
      state: 'connected'
      account: GitHubAccount
      configureUrl: string
      installationCount: number
      repositoryAccess: boolean
    }
  | { state: 'error'; message: string }

export type CliInstallStatus = {
  onPath: boolean
  command: string
  path: string
  profile: string
  development: boolean
  version: string
  state: 'not-installed' | 'installed' | 'repair' | 'conflict' | 'unsupported'
  message: string
}

export type CerebroApi = {
  listWorkspaceRepositories: () => Promise<WorkspaceRepository[]>
  getRepositoryPullRequests: (owner: string, repo: string) => Promise<RepositoryPullRequests>
  onWindowFocus: (listener: (focused: boolean) => void) => () => void
  getCliStatus: () => Promise<CliInstallStatus>
  installCli: () => Promise<CliInstallStatus>
  removeCli: () => Promise<CliInstallStatus>
  setPaneState: (
    workspaceId: number,
    paneId: number,
    state: import('@cerebro/core').Pane['state']
  ) => Promise<LayoutState>
  restartPty: (workspaceId: number, paneId: number) => Promise<void>
  getLayout: () => Promise<LayoutState>
  onLayoutFocusWorkspace: (listener: (workspaceId: number) => void) => () => void
  layoutCommand: (command: LayoutCommand) => Promise<LayoutReply>
  onLayoutChanged: (listener: (state: LayoutState) => void) => () => void
  measurePane: (paneId: number, width: number, height: number) => void
  listProjects: () => Promise<ProjectListResult>
  createProject: (gitUrl: string) => Promise<Project>
  createProjectFromDirectory: (directory: string) => Promise<Project>
  pickProjectDirectory: () => Promise<string | null>
  removeProject: (projectId: number, deleteFiles: boolean) => Promise<ProjectListResult>
  setActiveWorkspace: (workspaceId: number) => Promise<ProjectListResult>
  createWorkspace: (projectId: number, branch: string, from?: string | null) => Promise<Workspace>
  removeWorkspace: (workspaceId: number, deleteFiles: boolean) => Promise<ProjectListResult>
  listProjectBranches: (projectId: number) => Promise<ProjectBranch[]>
  listWorkspaceChanges: (
    workspaceId: number,
    repositoryId?: number | null
  ) => Promise<WorkspaceChanges>
  getWorkspaceFileDiff: (
    workspaceId: number,
    repositoryId: number,
    file: ChangedFile
  ) => Promise<FileDiffContents>
  openExternal: (url: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: AppSettingsPatch) => Promise<AppSettings>
  pickDirectory: () => Promise<string | null>
  runNativeCommand: (command: NativeCommandId) => Promise<void>
  getGitHubStatus: () => Promise<GitHubStatus>
  beginGitHubDeviceFlow: () => Promise<GitHubStatus>
  cancelGitHubDeviceFlow: () => Promise<GitHubStatus>
  disconnectGitHub: () => Promise<GitHubStatus>
  onGitHubStatus: (listener: (status: GitHubStatus) => void) => () => void
  /** Subscribe to project-list invalidation events (emitted after CLI mutations). */
  onProjectsInvalidate: (listener: () => void) => () => void
  /** File › Close menu (no accelerator); runs the same path as the closeTab keybind. */
  onMenuClose: (listener: () => void) => () => void
  openPty: (workspaceId: number, paneId: number) => Promise<PtyOpenResult>
  ackPty: (sessionId: number, sequence: number) => void
  writePty: (sessionId: number, data: string) => Promise<void>
  resizePty: (sessionId: number, cols: number, rows: number) => Promise<void>
  killPty: (sessionId: number) => Promise<void>
  onPtyData: (listener: (event: PtyDataEvent) => void) => () => void
  onPtyExit: (listener: (event: PtyExitEvent) => void) => () => void
}
