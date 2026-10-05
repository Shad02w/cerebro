import type { AgentHarness } from './chat'
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

/** Sidebar label override. Null keeps the default directory or branch name. */
export const WORKSPACE_NAME_MAX_LENGTH = 80

export type Workspace = {
  id: number
  projectId: number
  repositoryId: number
  kind: WorkspaceKind
  branch: string
  localPath: string
  /** Custom sidebar label. Null uses the directory name or branch name. */
  displayName: string | null
  createdAt: string
  pullRequest: WorkspacePullRequest | null
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

/** Stored keyboard shortcut overrides keyed by action id (e.g. `closeTab`). */
export type KeybindOverrides = Partial<Record<string, string>>

/** Empty agent pane background. `stars` is the default. */
export const AGENT_BACKGROUNDS = ['glow', 'stars', 'off'] as const
export type AgentBackground = (typeof AGENT_BACKGROUNDS)[number]
export const DEFAULT_AGENT_BACKGROUND: AgentBackground = 'stars'

export function isAgentBackground(value: unknown): value is AgentBackground {
  return typeof value === 'string' && (AGENT_BACKGROUNDS as readonly string[]).includes(value)
}

/** Model key chosen as the default for one harness provider. */
export type AgentModelDefaults = Partial<Record<AgentHarness, Record<string, string>>>
/** Harness and provider last used for a new agent pane. */
export type LastAgent = { harness: AgentHarness; provider: string }

export type AppSettings = {
  defaultCloneDir: string
  terminalTheme: TerminalThemeId
  terminalFontSize: number
  terminalFontFamily: string
  /** Empty agent pane: composer glow, star field, or neither. */
  agentBackground: AgentBackground
  /** Partial overrides; missing keys use app defaults. */
  keybinds: KeybindOverrides
  /** Default model key for each harness provider. Missing keys use that provider's current first model. */
  agentModelDefaults: AgentModelDefaults
  /** Remembered harness for new agent panes. The model comes from `agentModelDefaults`. */
  lastAgent: LastAgent | null
}

export type AppSettingsPatch = Partial<AppSettings>

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
