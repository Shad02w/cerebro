export type LinkedRepository = {
  id: number
  workspaceId: number
  gitUrl: string
  name: string
  localPath: string
  defaultBranch: string
  createdAt: string
}

export type Workspace = {
  id: number
  name: string
  createdAt: string
  updatedAt: string
  repositories: LinkedRepository[]
}

export type WorkspaceListResult = {
  workspaces: Workspace[]
  activeWorkspaceId: number | null
}

export type PtyOpenResult = {
  sessionId: number
}

export type PtyDataEvent = {
  sessionId: number
  data: string
}

export type PtyExitEvent = {
  sessionId: number
  exitCode: number
  signal?: number
}

export const TERMINAL_FONT_FAMILY_AUTO = 'auto'
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 24

export type AppSettings = {
  defaultCloneDir: string
  terminalFontSize: number
  /** `'auto'` or a CSS font-family name such as `Cerebro Mono`. */
  terminalFontFamily: string
}

export type AppSettingsPatch = Partial<AppSettings>

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
  | { state: 'connected'; account: GitHubAccount }
  | { state: 'error'; message: string }

export type CerebroApi = {
  listWorkspaces: () => Promise<WorkspaceListResult>
  createWorkspace: (gitUrl: string) => Promise<Workspace>
  setActiveWorkspace: (workspaceId: number) => Promise<WorkspaceListResult>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: AppSettingsPatch) => Promise<AppSettings>
  pickDirectory: () => Promise<string | null>
  getGitHubStatus: () => Promise<GitHubStatus>
  beginGitHubDeviceFlow: () => Promise<GitHubStatus>
  cancelGitHubDeviceFlow: () => Promise<GitHubStatus>
  disconnectGitHub: () => Promise<GitHubStatus>
  onGitHubStatus: (listener: (status: GitHubStatus) => void) => () => void
  openPty: (workspaceId: number, cols: number, rows: number) => Promise<PtyOpenResult>
  writePty: (sessionId: number, data: string) => Promise<void>
  resizePty: (sessionId: number, cols: number, rows: number) => Promise<void>
  killPty: (sessionId: number) => Promise<void>
  onPtyData: (listener: (event: PtyDataEvent) => void) => () => void
  onPtyExit: (listener: (event: PtyExitEvent) => void) => () => void
}
