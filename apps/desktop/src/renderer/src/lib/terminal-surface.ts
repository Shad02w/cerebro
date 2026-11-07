import { useMemo } from 'react'
import type { TerminalThemeId } from '@shared/terminal-themes'
import { useAppearance, type ColorMode, type UiStyleId } from '@/lib/appearance'
import { TERMINAL_PALETTES } from '@/lib/terminal-themes'

type Palette = Record<string, string>

// Light terminals need darker ANSI colors than xterm's defaults to stay readable on white.
const LIGHT_ANSI: Palette = {
  red: '#c4262e',
  green: '#1f7a3a',
  yellow: '#8a6100',
  blue: '#1f5fbf',
  magenta: '#8e3fb0',
  cyan: '#147a85',
  brightRed: '#d9363e',
  brightGreen: '#2b8a47',
  brightYellow: '#9c7000',
  brightBlue: '#1f9488',
  brightMagenta: '#a04cc2',
  brightCyan: '#1b8c98'
}

function surface(
  background: string,
  foreground: string,
  mode: ColorMode,
  extra: Palette = {}
): Palette {
  const light = mode === 'light'
  return {
    ...(light ? LIGHT_ANSI : {}),
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: light ? '#00000026' : '#ffffff40',
    black: light ? foreground : background,
    brightBlack: light ? '#6b6b6b' : '#7a7a7a',
    white: light ? '#bdbdbd' : foreground,
    brightWhite: light ? '#8a8a8a' : '#ffffff',
    ...extra
  }
}

// `Cerebro Default` follows the UI style so the terminal reads as part of the content area.
const SURFACES: Record<Exclude<UiStyleId, 'classic'>, Record<ColorMode, Palette>> = {
  graphite: {
    light: surface('#ffffff', '#1c1c1c', 'light'),
    dark: surface('#0f0f0f', '#f2f2f2', 'dark')
  },
  editor: {
    light: surface('#fcfcfc', '#2b2b2b', 'light', { cursor: '#1f9488' }),
    dark: surface('#181818', '#d6d6d6', 'dark', { cursor: '#4fd1c0' })
  },
  paper: {
    light: surface('#fbf9f6', '#2f2a25', 'light', { cursor: '#2a8f84' }),
    dark: surface('#1f1c19', '#ece7e0', 'dark', { cursor: '#5cc9b8' })
  },
  swiss: {
    light: surface('#ffffff', '#0b0b0b', 'light', { cursor: '#178a7d' }),
    dark: surface('#080808', '#fafafa', 'dark', { cursor: '#5fe0cc' })
  },
  slate: {
    light: surface('#fbfcfd', '#1f2833', 'light', { cursor: '#1f9488' }),
    dark: surface('#121820', '#e6edf2', 'dark', { cursor: '#4fd1c0' })
  }
}

const CLASSIC_LIGHT = surface('#ffffff', '#171717', 'light')

export function terminalPalette(
  themeId: TerminalThemeId,
  style: UiStyleId,
  mode: ColorMode
): Palette {
  if (themeId !== 'cerebro-default') return TERMINAL_PALETTES[themeId]
  if (style === 'classic') return mode === 'dark' ? TERMINAL_PALETTES[themeId] : CLASSIC_LIGHT
  return SURFACES[style][mode]
}

export function useTerminalPalette(themeId: TerminalThemeId): Palette {
  const { style, resolved } = useAppearance()
  return useMemo(() => terminalPalette(themeId, style, resolved), [themeId, style, resolved])
}
