import { TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'

/** Bundled MesloLGS NF — used only by the terminal emulator. */
export const BUNDLED_TERMINAL_FONT = 'Cerebro Mono'

/**
 * Monospace Nerd Fonts whose icons fit one cell. Names that are not installed
 * must not be selected: xterm measures the first family, and a missing name
 * falls through to the app's proportional UI font.
 * `MesloLGS NF` is the Powerlevel10k face; its icons are already cell-sized.
 */
export const NERD_TERMINAL_FONTS = [
  'MesloLGS NF',
  'MesloLGS Nerd Font Mono',
  'JetBrainsMono Nerd Font Mono',
  'FiraCode Nerd Font Mono',
  'Hack Nerd Font Mono',
  'CaskaydiaCove Nerd Font Mono',
  'SauceCodePro Nerd Font Mono',
  'CascadiaMono Nerd Font Mono',
  'DejaVuSansM Nerd Font Mono'
] as const

/** Installed system monospace faces. Offered explicitly; Auto keeps a Nerd Font. */
export const SYSTEM_TERMINAL_FONTS = [
  'SF Mono',
  'Menlo',
  'Monaco',
  'JetBrains Mono',
  'Cascadia Mono'
] as const

const FONT_CANDIDATES = [...NERD_TERMINAL_FONTS, ...SYSTEM_TERMINAL_FONTS] as const

const PROBE_SIZE = '72px'
const ASCII_SAMPLE = 'MWIl10'

export type TerminalFontOption = {
  value: string
  label: string
}

export type FontWidthProbe = {
  /** Width of an ASCII sample drawn as `"family", monospace`. */
  monoStack: number
  /** Width of the same sample drawn as `"family", sans-serif`. */
  sansStack: number
  mono: number
  sans: number
}

export type ResolvedTerminalFont = {
  /** Face xterm measures. A loaded family, or the bundled face. */
  family: string
  /** CSS font-family. The bundled face supplies glyphs the primary face lacks. */
  css: string
}

/**
 * True when both generic stacks resolve to the same face and that face is not
 * merely the fallback. `document.fonts.check()` cannot do this: it returns
 * true whenever any fallback can paint the sample.
 */
export function fontProbeShowsFace(probe: FontWidthProbe): boolean {
  const stacksAgree = probe.monoStack === probe.sansStack
  const differsFromGeneric = probe.monoStack !== probe.mono || probe.sansStack !== probe.sans
  return stacksAgree && differsFromGeneric
}

export function chooseTerminalFont(preference: string, available: ReadonlySet<string>): string {
  if (
    preference !== TERMINAL_FONT_FAMILY_AUTO &&
    (available.has(preference) || preference === BUNDLED_TERMINAL_FONT)
  ) {
    return preference
  }
  for (const family of NERD_TERMINAL_FONTS) {
    if (available.has(family)) return family
  }
  return BUNDLED_TERMINAL_FONT
}

export function terminalFontCss(family: string): string {
  if (family === BUNDLED_TERMINAL_FONT) return `"${BUNDLED_TERMINAL_FONT}"`
  return `"${family}", "${BUNDLED_TERMINAL_FONT}"`
}

function measure(font: string, sample: string): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return Number.NaN
  ctx.font = font
  return ctx.measureText(sample).width
}

async function loadFamily(family: string): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`16px "${family}"`),
      document.fonts.load(`bold 16px "${family}"`)
    ])
  } catch {
    // A missing face rejects on some engines; the width probe treats it as absent.
  }
}

function familyIsInstalled(family: string, generic: { mono: number; sans: number }): boolean {
  return fontProbeShowsFace({
    monoStack: measure(`${PROBE_SIZE} "${family}", monospace`, ASCII_SAMPLE),
    sansStack: measure(`${PROBE_SIZE} "${family}", sans-serif`, ASCII_SAMPLE),
    mono: generic.mono,
    sans: generic.sans
  })
}

let availableFontsCache: Promise<ReadonlySet<string>> | null = null

async function probeAvailableFonts(): Promise<ReadonlySet<string>> {
  await loadFamily(BUNDLED_TERMINAL_FONT)
  await document.fonts.ready
  const generic = {
    mono: measure(`${PROBE_SIZE} monospace`, ASCII_SAMPLE),
    sans: measure(`${PROBE_SIZE} sans-serif`, ASCII_SAMPLE)
  }
  const found = new Set<string>()
  await Promise.all(
    FONT_CANDIDATES.map(async (family) => {
      await loadFamily(family)
      if (familyIsInstalled(family, generic)) found.add(family)
    })
  )
  if (familyIsInstalled(BUNDLED_TERMINAL_FONT, generic)) found.add(BUNDLED_TERMINAL_FONT)
  return found
}

function availableFonts(): Promise<ReadonlySet<string>> {
  availableFontsCache ??= probeAvailableFonts()
  return availableFontsCache
}

export async function resolveTerminalFont(
  preference: string = TERMINAL_FONT_FAMILY_AUTO
): Promise<ResolvedTerminalFont> {
  const available = await availableFonts()
  const family = chooseTerminalFont(preference, available)
  await loadFamily(family)
  await loadFamily(BUNDLED_TERMINAL_FONT)
  await document.fonts.ready
  return { family, css: terminalFontCss(family) }
}

export async function listAvailableTerminalFonts(): Promise<TerminalFontOption[]> {
  const available = await availableFonts()
  const options: TerminalFontOption[] = [
    { value: TERMINAL_FONT_FAMILY_AUTO, label: 'Auto' },
    { value: BUNDLED_TERMINAL_FONT, label: BUNDLED_TERMINAL_FONT }
  ]
  for (const family of FONT_CANDIDATES) {
    if (!available.has(family)) continue
    options.push({ value: family, label: family })
  }
  return options
}
