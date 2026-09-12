import type { Terminal } from '@xterm/headless'
import { TERMINAL_PALETTES } from '@cerebro/core'

type Theme = keyof typeof TERMINAL_PALETTES
type RGB = [number, number, number]
type ColorEvent = { type: 0 | 1 | 2; index?: number; color?: RGB }
export type SavedColors = { theme: Theme; overrides: Array<[number, RGB]> }

// Match xterm 6.0's ThemeService defaults. The first 16 slots are themeable;
// the remaining slots are its standard color cube and grayscale ramp.
const names = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
]
const ansi = [
  '2e3436',
  'cc0000',
  '4e9a06',
  'c4a000',
  '3465a4',
  '75507b',
  '06989a',
  'd3d7cf',
  '555753',
  'ef2929',
  '8ae234',
  'fce94f',
  '729fcf',
  'ad7fa8',
  '34e2e2',
  'eeeeec'
]
function rgb(hex: string): RGB {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as RGB
}
function sequence(index: number, color: RGB): string {
  const id = index < 256 ? `4;${index}` : String(index - 246)
  return `\x1b]${id};rgb:${color.map((c) => c.toString(16).padStart(2, '0').repeat(2)).join('/')}\x1b\\`
}

/** Supplies the color service omitted by headless xterm. Parsing and validation
 * remain in xterm, so visible and headless terminals accept the same OSC syntax.
 * The internal onColor event is pinned to xterm 6.0, like terminal continuation. */
export class TerminalColors {
  private theme: Theme = 'cerebro-default'
  private overrides = new Map<number, RGB>()
  constructor(
    term: Terminal,
    private getTheme: () => Promise<Theme>,
    reply: (data: string) => void,
    saved?: SavedColors
  ) {
    if (saved) {
      this.theme = saved.theme
      this.overrides = new Map(saved.overrides)
    }
    const core = (
      term as unknown as {
        _core: { _inputHandler: { onColor(listener: (events: ColorEvent[]) => void): unknown } }
      }
    )._core
    core._inputHandler.onColor((events) => {
      for (const event of events) {
        if (event.type === 0 && event.index !== undefined) {
          reply(sequence(event.index, this.color(event.index)))
        } else if (event.type === 1 && event.index !== undefined && event.color) {
          this.overrides.set(event.index, event.color)
        } else if (event.type === 2) {
          if (event.index !== undefined) this.overrides.delete(event.index)
          else
            for (const index of this.overrides.keys()) if (index < 256) this.overrides.delete(index)
        }
      }
    })
    for (const code of [4, 10, 11, 12, 104, 110, 111, 112]) {
      // The 6.0 public headless declaration omits promises; its shared parser
      // supports them (and pauses the write queue until the handler resolves).
      const parser = term.parser as unknown as {
        registerOscHandler(code: number, handler: () => Promise<boolean>): void
      }
      parser.registerOscHandler(code, async () => {
        await this.syncTheme()
        // Let xterm's built-in handler validate and emit the color event.
        return false
      })
    }
  }
  async syncTheme(): Promise<void> {
    const theme = await this.getTheme()
    if (theme !== this.theme) {
      this.theme = theme
      // Setting a theme also resets application overrides in the renderer.
      this.overrides.clear()
    }
  }
  private color(index: number): RGB {
    const override = this.overrides.get(index)
    if (override) return override
    const theme = TERMINAL_PALETTES[this.theme]
    if (index < 16) return rgb(theme[names[index]] ?? ansi[index])
    if (index < 232) {
      const value = index - 16
      const cube = [0, 95, 135, 175, 215, 255]
      return [cube[Math.floor(value / 36)], cube[Math.floor(value / 6) % 6], cube[value % 6]]
    }
    if (index < 256) {
      const gray = 8 + (index - 232) * 10
      return [gray, gray, gray]
    }
    return rgb(
      theme[['foreground', 'background', 'cursor'][index - 256]] ??
        (index === 257 ? '#000000' : '#ffffff')
    )
  }
  save(): SavedColors {
    return { theme: this.theme, overrides: [...this.overrides] }
  }
  serialize(): string {
    // Reset stale colors on an existing renderer, then restore only overrides.
    return (
      '\x1b]104\x1b\\\x1b]110\x1b\\\x1b]111\x1b\\\x1b]112\x1b\\' +
      [...this.overrides].map(([index, color]) => sequence(index, color)).join('')
    )
  }
}
