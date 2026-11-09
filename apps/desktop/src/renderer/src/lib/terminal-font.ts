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

/**
 * Families to try for a preference, best first, before the bundled face.
 * An explicit family comes first; Auto (and a saved family that turns out to
 * be missing) falls back to installed Nerd Font / Meslo families by name.
 * Names alone are not trusted: the caller keeps the first one that measures
 * as monospace, so a missing or proportional face is never handed to xterm.
 */
export function terminalFontCandidates(
  preference: string,
  localFamilies: Iterable<string>
): string[] {
  const nerd = [...new Set(localFamilies)]
    .filter(isNerdTerminalFamily)
    .sort((a, b) => a.localeCompare(b))
  if (preference === TERMINAL_FONT_FAMILY_AUTO) return nerd
  return [preference, ...nerd.filter((family) => family !== preference)]
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

let probeContext: CanvasRenderingContext2D | null | undefined

function measure(font: string, sample: string): number {
  probeContext ??= document.createElement('canvas').getContext('2d')
  if (!probeContext) return Number.NaN
  probeContext.font = font
  return probeContext.measureText(sample).width
}

/**
 * True when the face is installed and monospace. A missing family measures the
 * proportional default face instead, so this also rejects names that are not
 * installed (`document.fonts.check()` reports those as available).
 */
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

let localFamiliesCache: Promise<readonly string[]> | null = null

/** Installed family names, unmeasured. Cheap: one metadata query, no font loads. */
function localFamilies(): Promise<readonly string[]> {
  localFamiliesCache ??= (async () => {
    const query = queryLocalFontFaces()
    if (!query) return []
    try {
      const faces = await query
      return [
        ...new Set(
          faces.flatMap((face) => {
            const name = face.family.trim()
            return name ? [name] : []
          })
        )
      ]
    } catch {
      return []
    }
  })()
  return localFamiliesCache
}

/** Families measured per task before yielding, so the menu probe never freezes the UI. */
const PROBE_BATCH = 16

let installedFontsCache: Promise<readonly string[]> | null = null

/**
 * Every installed monospace family. Measuring makes Chromium load each face,
 * which costs about 2 ms per family, so only the settings font menu runs it.
 */
async function probeInstalledMonospaceFamilies(): Promise<readonly string[]> {
  const names = await localFamilies()
  const families: string[] = []
  for (let index = 0; index < names.length; index++) {
    if (index > 0 && index % PROBE_BATCH === 0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    if (familyIsMonospace(names[index])) families.push(names[index])
  }
  families.sort((a, b) => a.localeCompare(b))
  return families
}

function installedMonospaceFamilies(): Promise<readonly string[]> {
  installedFontsCache ??= probeInstalledMonospaceFamilies()
  return installedFontsCache
}

async function chooseFamily(preference: string): Promise<string> {
  if (preference === BUNDLED_TERMINAL_FONT) return BUNDLED_TERMINAL_FONT
  // An explicit family is checked on its own; installed names are read only
  // for Auto, or when the saved family is no longer installed.
  if (preference !== TERMINAL_FONT_FAMILY_AUTO && familyIsMonospace(preference)) return preference
  for (const family of terminalFontCandidates(preference, await localFamilies()))
    if (family !== preference && familyIsMonospace(family)) return family
  return BUNDLED_TERMINAL_FONT
}

async function resolveUncached(preference: string): Promise<ResolvedTerminalFont> {
  const family = await chooseFamily(preference)
  await loadFamily(family)
  if (family !== BUNDLED_TERMINAL_FONT) await loadFamily(BUNDLED_TERMINAL_FONT)
  await document.fonts.ready
  return { family, css: terminalFontCss(family) }
}

const resolvedCache = new Map<string, Promise<ResolvedTerminalFont>>()

/**
 * The face a terminal draws with. Checks only the preferred family (and, for
 * Auto, Nerd Font names), never every installed font, so the first terminal
 * opens as fast as later ones. Cached per preference.
 */
export function resolveTerminalFont(
  preference: string = TERMINAL_FONT_FAMILY_AUTO
): Promise<ResolvedTerminalFont> {
  let resolved = resolvedCache.get(preference)
  if (!resolved) {
    resolved = resolveUncached(preference)
    resolvedCache.set(preference, resolved)
    resolved.catch(() => resolvedCache.delete(preference))
  }
  return resolved
}

/** Resolve and load the terminal face while the app is idle, before a pane needs it. */
export function warmTerminalFont(preference: string = TERMINAL_FONT_FAMILY_AUTO): () => void {
  const idle = window.requestIdleCallback
  if (typeof idle !== 'function') {
    const timer = window.setTimeout(() => void resolveTerminalFont(preference).catch(() => {}))
    return () => window.clearTimeout(timer)
  }
  const handle = idle(() => void resolveTerminalFont(preference).catch(() => {}), {
    timeout: 2000
  })
  return () => window.cancelIdleCallback(handle)
}

export async function listAvailableTerminalFonts(): Promise<TerminalFontOption[]> {
  return terminalFontOptions(await installedMonospaceFamilies())
}
