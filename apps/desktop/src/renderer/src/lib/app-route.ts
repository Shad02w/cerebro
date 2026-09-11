export const SETTINGS_SECTION_IDS = [
  'general',
  'terminal',
  'cli',
  'keyboard',
  'integrations'
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export type AppRoute = { name: 'projects' } | { name: 'settings'; section: SettingsSectionId }

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
}

export function parseAppPath(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/settings' || path.startsWith('/settings/')) {
    const rest = path === '/settings' ? 'general' : path.slice('/settings/'.length)
    return { name: 'settings', section: isSettingsSectionId(rest) ? rest : 'general' }
  }
  return { name: 'projects' }
}

export function pathFromHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function projectsPath(): string {
  return '#/'
}

/** @deprecated Use projectsPath */
export function workspacesPath(): string {
  return projectsPath()
}

export function settingsPath(section: SettingsSectionId = 'general'): string {
  return `#/settings/${section}`
}

export function navigate(to: string): void {
  const hash = to.startsWith('#') ? to.slice(1) : to
  const normalized = hash.startsWith('/') ? hash : `/${hash}`
  const next = `#${normalized}`
  if (window.location.hash !== next) {
    window.location.hash = normalized
  }
}
