import { TERMINAL_FONT_FAMILY_AUTO } from '@shared/types'

/** Bundled MesloLGS NF — used only by the terminal emulator. */
export const BUNDLED_TERMINAL_FONT = 'Cerebro Mono'

const PROBE_SIZE = '72px'
const WIDE_SAMPLE = 'WWWW'
const NARROW_SAMPLE = 'iiii'
const NERD_FONT_NAME = /nerd font|meslo/i

export type TerminalFontOption = {
  value: string
  label: string
}

export type ResolvedTerminalFont = {
  /** Face xterm measures. A loaded family, or the bundled face. */
  family: string
  /** CSS font-family. The bundled face supplies glyphs the primary face lacks. */
  css: string
}

type LocalFontFace = {
  family: string
}

/** True when wide and narrow samples share one advance, the monospace check. */
export function widthsAreMonospace(wide: number, narrow: number): boolean {
  return wide > 0 && wide === narrow
}

/** Installed Nerd Font / Meslo faces. Auto prefers one of these over a plain mono. */
export function isNerdTerminalFamily(family: string): boolean {
  return NERD_FONT_NAME.test(family)
}

export function chooseTerminalFont(preference: string, available: Iterable<string>): string {
  const installed = new Set(available)
  if (
    preference !== TERMINAL_FONT_FAMILY_AUTO &&
    (installed.has(preference) || preference === BUNDLED_TERMINAL_FONT)
  ) {
    return preference
  }
  const nerd = [...installed].filter(isNerdTerminalFamily).sort((a, b) => a.localeCompare(b))
  return nerd[0] ?? BUNDLED_TERMINAL_FONT
}

export function terminalFontCss(family: string): string {
  if (family === BUNDLED_TERMINAL_FONT) return `"${BUNDLED_TERMINAL_FONT}"`
  return `"${family}", "${BUNDLED_TERMINAL_FONT}"`
}

/** Menu entries: Auto, the bundled face, then the monospace families passed in. */
export function terminalFontOptions(families: readonly string[]): TerminalFontOption[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const family of families) {
    const name = family.trim()
    if (!name || name === BUNDLED_TERMINAL_FONT || name === TERMINAL_FONT_FAMILY_AUTO) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  names.sort((a, b) => a.localeCompare(b))
  return [
    { value: TERMINAL_FONT_FAMILY_AUTO, label: 'Auto' },
    { value: BUNDLED_TERMINAL_FONT, label: BUNDLED_TERMINAL_FONT },
    ...names.map((family) => ({ value: family, label: family }))
  ]
}

/**
 * xterm's WebGL renderer sets the device cell to
 * `floor(charWidth * devicePixelRatio) + round(letterSpacing)`.
 * The floor drops any fractional device pixel, so a 15.65px glyph is drawn
 * into a 15px cell and the right edge is clipped. `letterSpacing` is added
 * in device pixels, not CSS pixels. Returning 1 asks for the nearest whole
 * device pixel when that is wider than the floor; returning 0 leaves an
 * already-aligned or nearer-to-floor advance alone.
 */
export function terminalLetterSpacing(charWidth: number, devicePixelRatio: number): number {
  if (!(charWidth > 0) || !(devicePixelRatio > 0)) return 0
  const device = charWidth * devicePixelRatio
  const padding = Math.round(device) - Math.floor(device + 1e-6)
  return padding > 0 ? 1 : 0
}

/** Advance of "W", matching the string xterm measures (`${fontSize}px ${family}`). */
export function measureTerminalCharWidth(fontFamilyCss: string, fontSize: number): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = `${fontSize}px ${fontFamilyCss}`
  const width = ctx.measureText('W').width
  return Number.isFinite(width) ? width : 0
}

function measure(font: string, sample: string): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return Number.NaN
  ctx.font = font
  return ctx.measureText(sample).width
}

function familyIsMonospace(family: string): boolean {
  return widthsAreMonospace(
    measure(`${PROBE_SIZE} "${family}"`, WIDE_SAMPLE),
    measure(`${PROBE_SIZE} "${family}"`, NARROW_SAMPLE)
  )
}

async function loadFamily(family: string): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`16px "${family}"`),
      document.fonts.load(`bold 16px "${family}"`)
    ])
  } catch {
    // A missing face rejects on some engines; drawing still falls back.
  }
}

function queryLocalFontFaces(): Promise<LocalFontFace[]> | null {
  const fonts = window as Window & {
    queryLocalFonts?: () => Promise<LocalFontFace[]>
  }
  if (typeof fonts.queryLocalFonts !== 'function') return null
  return fonts.queryLocalFonts()
}

let installedFontsCache: Promise<readonly string[]> | null = null

async function probeInstalledMonospaceFamilies(): Promise<readonly string[]> {
  const query = queryLocalFontFaces()
  if (!query) return []
  let faces: LocalFontFace[]
  try {
    faces = await query
  } catch {
    return []
  }
  const seen = new Set<string>()
  const families: string[] = []
  for (const face of faces) {
    const name = face.family.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (!familyIsMonospace(name)) continue
    families.push(name)
  }
  families.sort((a, b) => a.localeCompare(b))
  return families
}

function installedMonospaceFamilies(): Promise<readonly string[]> {
  installedFontsCache ??= probeInstalledMonospaceFamilies()
  return installedFontsCache
}

export async function resolveTerminalFont(
  preference: string = TERMINAL_FONT_FAMILY_AUTO
): Promise<ResolvedTerminalFont> {
  const available = await installedMonospaceFamilies()
  const family = chooseTerminalFont(preference, available)
  await loadFamily(family)
  await loadFamily(BUNDLED_TERMINAL_FONT)
  await document.fonts.ready
  return { family, css: terminalFontCss(family) }
}

export async function listAvailableTerminalFonts(): Promise<TerminalFontOption[]> {
  return terminalFontOptions(await installedMonospaceFamilies())
}
