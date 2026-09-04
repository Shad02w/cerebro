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
  | 'approved'
  | 'changes_requested'
  | 'review_required'
  | 'none'

export type WorkspacePullRequest = {
  number: number
  title: string
  url: string
  createdAt: string
  state: WorkspacePullRequestState
  reviewDecision: WorkspacePullRequestReviewDecision
  mergeable: boolean | null
  repoFullName: string
}

export type WorkspaceKind = 'default' | 'worktree'

export type Workspace = {
  id: number
  projectId: number
  repositoryId: number
  kind: WorkspaceKind
  branch: string
  localPath: string
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

export type AppSettings = {
  defaultCloneDir: string
  terminalFontSize: number
  terminalFontFamily: string
}

export type AppSettingsPatch = Partial<AppSettings>

export const TERMINAL_FONT_FAMILY_AUTO = 'auto'
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 24

