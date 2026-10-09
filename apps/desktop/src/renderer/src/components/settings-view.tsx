import { AgentModelSettings } from '@/components/agent-model-settings'
import { TerminalThemeCombobox } from '@/components/terminal-theme-combobox'
import { CliSettings } from '@/components/cli-settings'
import type { TerminalThemeId } from '@shared/terminal-themes'
import { useEffect, useRef, useState } from 'react'
import type {
  AgentBackground,
  AppSettings,
  AppSettingsPatch,
  ComposerVimMode,
  GitHubStatus
} from '@shared/types'
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_FAMILY_AUTO
} from '@shared/types'
import type { SettingsSectionId } from '@/lib/app-route'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { listAvailableTerminalFonts, type TerminalFontOption } from '@/lib/terminal-font'
import { KeyboardSettings } from '@/keybinds'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

type SettingsViewProps = {
  section: SettingsSectionId
  settings: AppSettings | null
  loading: boolean
  error: string | null
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
  onPickDirectory: () => Promise<string | null>
  githubStatus: GitHubStatus | null
  githubLoading: boolean
  githubError: string | null
  onConnectGitHub: () => Promise<GitHubStatus>
  onCancelGitHub: () => Promise<GitHubStatus>
  onDisconnectGitHub: () => Promise<GitHubStatus>
}

export function SettingsView({
  section,
  settings,
  loading,
  error,
  onUpdate,
  onPickDirectory,
  githubStatus,
  githubLoading,
  githubError,
  onConnectGitHub,
  onCancelGitHub,
  onDisconnectGitHub
}: SettingsViewProps): React.JSX.Element {
  const meta = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <div
      className="app-drag-region relative flex min-h-0 flex-1 flex-col"
      data-testid="settings-view"
    >
      <div className="app-no-drag flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <h1 className="text-xl font-semibold tracking-tight">{meta.label}</h1>
          {section === 'general' ? (
            loading || !settings ? (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            ) : (
              <GeneralSettings
                settings={settings}
                error={error}
                onUpdate={onUpdate}
                onPickDirectory={onPickDirectory}
              />
            )
          ) : section === 'provider' ? (
            loading || !settings ? (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            ) : (
              <ProviderSettings settings={settings} onUpdate={onUpdate} />
            )
          ) : section === 'terminal' ? (
            loading || !settings ? (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            ) : (
              <TerminalSettings settings={settings} error={error} onUpdate={onUpdate} />
            )
          ) : section === 'cli' ? (
            <CliSettings />
          ) : section === 'keyboard' ? (
            loading || !settings ? (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            ) : (
              <KeyboardSettings settings={settings} error={error} onUpdate={onUpdate} />
            )
          ) : (
            <IntegrationsSettings
              status={githubStatus}
              loading={githubLoading}
              error={githubError}
              onConnect={onConnectGitHub}
              onCancel={onCancelGitHub}
              onDisconnect={onDisconnectGitHub}
            />
          )}
        </div>
      </div>
    </div>
  )
}

type GeneralSettingsProps = {
  settings: AppSettings
  error: string | null
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
  onPickDirectory: () => Promise<string | null>
}

const AGENT_BACKGROUND_ITEMS = [
  { value: 'glow', label: 'Glow' },
  { value: 'stars', label: 'Stars' },
  { value: 'off', label: 'Off' }
]

const COMPOSER_VIM_ITEMS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const COMPOSER_VIM_MODE_ITEMS = [
  { value: 'insert', label: 'Insert' },
  { value: 'normal', label: 'Normal' }
]

function GeneralSettings({
  settings,
  error,
  onUpdate,
  onPickDirectory
}: GeneralSettingsProps): React.JSX.Element {
  const [cloneDir, setCloneDir] = useState(settings.defaultCloneDir)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const [previousCloneDir, setPreviousCloneDir] = useState(settings.defaultCloneDir)
  if (previousCloneDir !== settings.defaultCloneDir) {
    setPreviousCloneDir(settings.defaultCloneDir)
    setCloneDir(settings.defaultCloneDir)
  }

  const persistCloneDir = async (path: string): Promise<void> => {
    const trimmed = path.trim()
    if (!trimmed || trimmed === settings.defaultCloneDir) return
    setSaving(true)
    setLocalError(null)
    try {
      await onUpdate({ defaultCloneDir: trimmed })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save clone location.')
      setCloneDir(settings.defaultCloneDir)
    } finally {
      setSaving(false)
    }
  }

  const handleChooseFolder = async (): Promise<void> => {
    setLocalError(null)
    try {
      const picked = await onPickDirectory()
      if (!picked) return
      setCloneDir(picked)
      await persistCloneDir(picked)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to choose folder.')
    }
  }

  const savingBackground = useRef(false)
  const persistAgentBackground = async (value: AgentBackground): Promise<void> => {
    if (savingBackground.current || value === settings.agentBackground) return
    savingBackground.current = true
    setLocalError(null)
    try {
      await onUpdate({ agentBackground: value })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save agent background.')
    } finally {
      savingBackground.current = false
    }
  }

  const savingVim = useRef(false)
  const persistComposerVim = async (patch: {
    composerVim?: boolean
    composerVimMode?: ComposerVimMode
  }): Promise<void> => {
    if (savingVim.current) return
    savingVim.current = true
    setLocalError(null)
    try {
      await onUpdate(patch)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save vim mode.')
    } finally {
      savingVim.current = false
    }
  }

  return (
    <section className="space-y-6" data-testid="settings-general">
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground">Agent</h2>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="agent-background" className="text-[13px] font-medium">
              Background
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Glow sits behind the composer. Stars fill the empty pane until the first message is
              sent. Off leaves the pane plain.
            </p>
          </div>
          <Select
            items={AGENT_BACKGROUND_ITEMS}
            value={settings.agentBackground}
            onValueChange={(value): void => {
              if (value === 'glow' || value === 'stars' || value === 'off') {
                void persistAgentBackground(value)
              }
            }}
          >
            <SelectTrigger
              id="agent-background"
              className="h-7 w-36"
              data-testid="settings-agent-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_BACKGROUND_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="composer-vim" className="text-[13px] font-medium">
              Vim mode
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Modal editing in the agent composer. Enter sends only in insert mode, and @ tags
              complete only while typing in insert mode.
            </p>
          </div>
          <Select
            items={COMPOSER_VIM_ITEMS}
            value={settings.composerVim ? 'on' : 'off'}
            onValueChange={(value): void => {
              if (value === 'on' || value === 'off') {
                void persistComposerVim({ composerVim: value === 'on' })
              }
            }}
          >
            <SelectTrigger
              id="composer-vim"
              className="h-7 w-36"
              data-testid="settings-composer-vim"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSER_VIM_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="composer-vim-mode" className="text-[13px] font-medium">
              Starting vim mode
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The composer opens in this mode and returns to it after a message is sent.
            </p>
          </div>
          <Select
            items={COMPOSER_VIM_MODE_ITEMS}
            value={settings.composerVimMode}
            onValueChange={(value): void => {
              if (value === 'insert' || value === 'normal') {
                void persistComposerVim({ composerVimMode: value })
              }
            }}
          >
            <SelectTrigger
              id="composer-vim-mode"
              className="h-7 w-36"
              data-testid="settings-composer-vim-mode"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSER_VIM_MODE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground">Projects</h2>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="clone-location" className="text-[13px] font-medium">
              Default clone location
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              New projects are cloned into this folder. Existing checkouts are not moved.
            </p>
          </div>
          <div className="flex w-[min(24rem,48%)] shrink-0 items-center gap-2">
            <Input
              id="clone-location"
              value={cloneDir}
              disabled={saving}
              className="h-7 font-mono text-xs"
              data-testid="settings-clone-dir"
              onChange={(event): void => setCloneDir(event.target.value)}
              onBlur={(): void => {
                void persistCloneDir(cloneDir)
              }}
              onKeyDown={(event): void => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={saving}
              onClick={(): void => {
                void handleChooseFolder()
              }}
            >
              Choose folder
            </Button>
          </div>
        </div>
      </div>
      {localError || error ? (
        <p className="text-xs text-destructive">{localError ?? error}</p>
      ) : null}
    </section>
  )
}

type ProviderSettingsProps = {
  settings: AppSettings
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
}

function ProviderSettings({ settings, onUpdate }: ProviderSettingsProps): React.JSX.Element {
  return (
    <section className="space-y-6" data-testid="settings-provider">
      <AgentModelSettings settings={settings} onUpdate={onUpdate} />
    </section>
  )
}

type TerminalSettingsProps = {
  settings: AppSettings
  error: string | null
  onUpdate: (patch: AppSettingsPatch) => Promise<AppSettings>
}

function TerminalSettings({ settings, error, onUpdate }: TerminalSettingsProps): React.JSX.Element {
  const savingTheme = useRef(false)
  const persistTheme = async (value: TerminalThemeId): Promise<void> => {
    if (savingTheme.current || value === settings.terminalTheme) return
    savingTheme.current = true
    setLocalError(null)
    try {
      await onUpdate({ terminalTheme: value })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save terminal theme.')
    } finally {
      savingTheme.current = false
    }
  }
  const [fontSize, setFontSize] = useState(String(settings.terminalFontSize))
  const [fontOptions, setFontOptions] = useState<TerminalFontOption[]>([
    { value: TERMINAL_FONT_FAMILY_AUTO, label: 'Auto' }
  ])
  const [localError, setLocalError] = useState<string | null>(null)

  const [previousFontSize, setPreviousFontSize] = useState(settings.terminalFontSize)
  if (previousFontSize !== settings.terminalFontSize) {
    setPreviousFontSize(settings.terminalFontSize)
    setFontSize(String(settings.terminalFontSize))
  }

  useEffect(() => {
    let cancelled = false
    void listAvailableTerminalFonts()
      .then((options) => {
        if (!cancelled) setFontOptions(options)
      })
      .catch(() => {
        if (!cancelled) {
          setFontOptions([{ value: TERMINAL_FONT_FAMILY_AUTO, label: 'Auto' }])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persistFontSize = async (raw: string): Promise<void> => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      setFontSize(String(settings.terminalFontSize))
      return
    }
    const rounded = Math.round(parsed)
    if (rounded === settings.terminalFontSize) {
      setFontSize(String(rounded))
      return
    }
    if (rounded < MIN_TERMINAL_FONT_SIZE || rounded > MAX_TERMINAL_FONT_SIZE) {
      setLocalError(
        `Font size must be between ${MIN_TERMINAL_FONT_SIZE} and ${MAX_TERMINAL_FONT_SIZE}.`
      )
      setFontSize(String(settings.terminalFontSize))
      return
    }
    setLocalError(null)
    try {
      await onUpdate({ terminalFontSize: rounded })
      setFontSize(String(rounded))
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save font size.')
      setFontSize(String(settings.terminalFontSize))
    }
  }

  const persistFontFamily = async (value: string): Promise<void> => {
    if (value === settings.terminalFontFamily) return
    setLocalError(null)
    try {
      await onUpdate({ terminalFontFamily: value })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save font family.')
    }
  }

  const familyValue = fontOptions.some((option) => option.value === settings.terminalFontFamily)
    ? settings.terminalFontFamily
    : TERMINAL_FONT_FAMILY_AUTO

  return (
    <section className="space-y-6" data-testid="settings-terminal">
      <div className="space-y-3 max-w-sm">
        <Label htmlFor="terminal-theme" className="text-[13px] font-medium">
          Theme
        </Label>
        <TerminalThemeCombobox
          value={settings.terminalTheme}
          onChange={(value) => {
            void persistTheme(value)
          }}
        />
      </div>
      <div className="space-y-3">
        <Label htmlFor="terminal-font-size" className="text-[13px] font-medium">
          Font size
        </Label>
        <Input
          id="terminal-font-size"
          type="number"
          min={MIN_TERMINAL_FONT_SIZE}
          max={MAX_TERMINAL_FONT_SIZE}
          className="h-7 w-28"
          value={fontSize}
          data-testid="settings-font-size"
          onChange={(event): void => setFontSize(event.target.value)}
          onBlur={(): void => {
            void persistFontSize(fontSize)
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <div className="space-y-3">
        <Label htmlFor="terminal-font-family" className="text-[13px] font-medium">
          Font family
        </Label>
        <Select
          items={fontOptions}
          value={familyValue}
          onValueChange={(value): void => {
            if (value) void persistFontFamily(value)
          }}
        >
          <SelectTrigger
            id="terminal-font-family"
            className="h-7 w-full max-w-sm"
            data-testid="settings-font-family"
          >
            <SelectValue placeholder="Select a font" />
          </SelectTrigger>
          <SelectContent>
            {fontOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {localError || error ? (
        <p className="text-sm text-destructive">{localError ?? error}</p>
      ) : null}
    </section>
  )
}

type IntegrationsSettingsProps = {
  status: GitHubStatus | null
  loading: boolean
  error: string | null
  onConnect: () => Promise<GitHubStatus>
  onCancel: () => Promise<GitHubStatus>
  onDisconnect: () => Promise<GitHubStatus>
}

function formatCountdown(expiresAt: string, nowMs: number): string {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - nowMs)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function IntegrationsSettings({
  status,
  loading,
  error,
  onConnect,
  onCancel,
  onDisconnect
}: IntegrationsSettingsProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (status?.state !== 'pending') return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status?.state])

  const run = async (action: () => Promise<GitHubStatus>): Promise<void> => {
    setBusy(true)
    setLocalError(null)
    setCopied(false)
    try {
      await action()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'GitHub action failed.')
    } finally {
      setBusy(false)
    }
  }

  const copyUserCode = async (userCode: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(userCode)
      setCopied(true)
    } catch {
      setLocalError('Could not copy the code to the clipboard.')
    }
  }

  return (
    <section className="space-y-4" data-testid="settings-integrations">
      <div
        className="space-y-4 rounded-lg border border-border p-4"
        data-testid="github-integration-card"
      >
        <div className="space-y-1">
          <h3 className="text-sm font-medium">GitHub</h3>
          <p className="text-xs text-muted-foreground">
            Authorize Cerebro with a device code, then configure which repositories it can access.
          </p>
        </div>

        {loading || !status ? (
          <p className="text-sm text-muted-foreground">Loading GitHub status…</p>
        ) : status.state === 'unconfigured' ? (
          <div className="space-y-2" data-testid="github-unconfigured">
            <p className="text-sm text-muted-foreground">
              GitHub is not configured in this build. Set{' '}
              <code className="font-mono text-xs">MAIN_VITE_GITHUB_CLIENT_ID</code> in{' '}
              <code className="font-mono text-xs">.env</code> (or{' '}
              <code className="font-mono text-xs">CEREBRO_GITHUB_CLIENT_ID</code> at launch), then
              restart Cerebro.
            </p>
          </div>
        ) : status.state === 'pending' ? (
          <div className="space-y-3" data-testid="github-pending">
            <p className="text-sm text-muted-foreground">
              Enter this code at <span className="font-mono text-xs">{status.verificationUri}</span>
            </p>
            <p className="font-mono text-3xl tracking-widest" data-testid="github-user-code">
              {status.userCode}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="github-expires">
              Expires in {formatCountdown(status.expiresAt, nowMs)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="app-no-drag"
                disabled={busy}
                data-testid="github-copy-code"
                onClick={(): void => {
                  void copyUserCode(status.userCode)
                }}
              >
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="app-no-drag"
                disabled={busy}
                data-testid="github-cancel"
                onClick={(): void => {
                  void run(onCancel)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : status.state === 'connected' ? (
          <div className="space-y-3" data-testid="github-connected">
            <p className="text-xs text-muted-foreground" data-testid="github-repository-access">
              {status.installationCount === 0
                ? 'Install Cerebro on GitHub and choose the repositories to connect.'
                : !status.repositoryAccess
                  ? 'The GitHub App needs read access to Contents and Pull requests. Update its permissions, then approve the installation update.'
                  : 'Repository access is configured. Use Configure to choose public and private repositories.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Cerebro refreshes PR status every minute and when you return to the app. If the App
              cannot access a repository, Cerebro tries your GitHub CLI login, then Git for
              branches. CLI access may include repositories outside the App selection.
            </p>
            <div className="flex items-center gap-3">
              <img
                src={status.account.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-10 rounded-full bg-muted object-cover"
                data-testid="github-avatar"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" data-testid="github-login">
                  {status.account.login}
                </p>
                {status.account.name ? (
                  <p className="truncate text-xs text-muted-foreground">{status.account.name}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="app-no-drag"
                nativeButton={false}
                render={
                  <a
                    href={status.configureUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Manage which repositories Cerebro can access"
                    data-testid="github-configure"
                  />
                }
              >
                Configure
              </Button>
              <Button
                type="button"
                variant="outline"
                className="app-no-drag"
                disabled={busy}
                data-testid="github-disconnect"
                onClick={(): void => {
                  void run(onDisconnect)
                }}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="github-disconnected">
            {status.state === 'error' ? (
              <p className="text-sm text-destructive" data-testid="github-status-error">
                {status.message}
              </p>
            ) : null}
            <Button
              type="button"
              className="app-no-drag"
              disabled={busy}
              data-testid="github-connect"
              onClick={(): void => {
                void run(onConnect)
              }}
            >
              Connect to GitHub
            </Button>
          </div>
        )}

        {localError || error ? (
          <p className="text-sm text-destructive">{localError ?? error}</p>
        ) : null}
      </div>
    </section>
  )
}
