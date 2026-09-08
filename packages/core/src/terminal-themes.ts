export const TERMINAL_THEMES = [
  {
    id: 'cerebro-default',
    label: 'Cerebro Default'
  },
  {
    id: 'xterm-default',
    label: 'Xterm Default'
  },
  {
    id: 'dracula',
    label: 'Dracula'
  },
  {
    id: 'nord',
    label: 'Nord'
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha'
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte'
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark'
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light'
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark'
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light'
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night'
  },
  {
    id: 'one-dark',
    label: 'One Dark'
  },

  {
    id: 'kanagawa-wave',
    label: 'Kanagawa Wave'
  },
  {
    id: 'kanagawa-dragon',
    label: 'Kanagawa Dragon'
  },
  {
    id: 'kanagawa-lotus',
    label: 'Kanagawa Lotus'
  },
  {
    id: 'kanagawabones',
    label: 'Kanagawabones'
  },
  {
    id: 'vercel',
    label: 'Vercel'
  }
] as const

export type TerminalThemeId = (typeof TERMINAL_THEMES)[number]['id']
export const DEFAULT_TERMINAL_THEME: TerminalThemeId = 'cerebro-default'

export function isTerminalThemeId(value: unknown): value is TerminalThemeId {
  return TERMINAL_THEMES.some((theme) => theme.id === value)
}
