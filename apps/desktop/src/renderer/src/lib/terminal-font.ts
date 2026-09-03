import { TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'

/** Bundled MesloLGS NF — used only by the terminal emulator. */
export const BUNDLED_TERMINAL_FONT = 'Cerebro Mono'

/**
 * Prefer a Nerd Font already on the machine (the user's terminal font), then
 * the bundled MesloLGS NF. xterm measures the first family in this string, so
 * it must be a face that actually loaded.
 */
const PREFERRED_TERMINAL_FONTS = [
  'FiraCode Nerd Font Mono',
  'FiraCode Nerd Font',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono NF',
  'MesloLGS NF',
  'Hack Nerd Font',
  BUNDLED_TERMINAL_FONT
] as const

export type TerminalFontOption = {
  value: string
  label: string
}

function canRenderFamily(family: string): boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const sample = 'mmmmmmmmmmlli'
  ctx.font = '16px monospace'
  const fallbackWidth = ctx.measureText(sample).width
  ctx.font = `16px "${family}", monospace`
  const familyWidth = ctx.measureText(sample).width
  if (familyWidth !== fallbackWidth) return true

  // Distinguishes a loaded Nerd Font from tofu for Powerline/P10k glyphs.
  const nerdSample = '\uE0A0\uE0B0'
  ctx.font = `16px "${family}"`
  const nerdWidth = ctx.measureText(nerdSample).width
  ctx.font = '16px Menlo, Monaco, monospace'
  const menloWidth = ctx.measureText(nerdSample).width
  return nerdWidth > 0 && nerdWidth !== menloWidth
}

async function ensureFontsReady(): Promise<void> {
  await document.fonts.load(`13px "${BUNDLED_TERMINAL_FONT}"`)
  await document.fonts.ready
}

async function isFamilyAvailable(family: string): Promise<boolean> {
  try {
    await document.fonts.load(`13px "${family}"`)
  } catch {
    return false
  }
  return document.fonts.check(`13px "${family}"`) && canRenderFamily(family)
}

export async function resolveTerminalFontFamily(
  preference: string = TERMINAL_FONT_FAMILY_AUTO
): Promise<string> {
  await ensureFontsReady()

  if (preference !== TERMINAL_FONT_FAMILY_AUTO) {
    if (await isFamilyAvailable(preference)) {
      return `"${preference}"`
    }
    // Fall through to auto-detect when the saved family is no longer available.
  }

  for (const family of PREFERRED_TERMINAL_FONTS) {
    if (await isFamilyAvailable(family)) {
      return `"${family}"`
    }
  }

  return `"${BUNDLED_TERMINAL_FONT}"`
}

export async function listAvailableTerminalFonts(): Promise<TerminalFontOption[]> {
  await ensureFontsReady()

  const options: TerminalFontOption[] = [
    { value: TERMINAL_FONT_FAMILY_AUTO, label: 'Auto' },
    { value: BUNDLED_TERMINAL_FONT, label: BUNDLED_TERMINAL_FONT }
  ]

  const seen = new Set<string>([BUNDLED_TERMINAL_FONT])
  for (const family of PREFERRED_TERMINAL_FONTS) {
    if (seen.has(family)) continue
    seen.add(family)
    if (await isFamilyAvailable(family)) {
      options.push({ value: family, label: family })
    }
  }

  return options
}
