/** xterm 6 synchronizes painting, but still emits intermediate cursor events
 * that move the IME textarea and restart WebGL cursor blinking. Coalesce marked
 * frames so these callbacks see the restored input cursor. Native-only v6 fails
 * the split-frame Electron cursor regression; keep this bounded compatibility layer. */
export class TerminalOutput {
  private pending = ''
  private callbacks: Array<() => void> = []
  private synchronized = false
  private state: 'ground' | 'esc' | 'csi' | 'string' | 'string-esc' = 'ground'
  private parameters = ''
  private osc = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private write: (data: string, callback: () => void) => void,
    private timeout = 1000,
    private limit = 1024 * 1024
  ) {}

  push(data: string, callback: () => void): void {
    this.pending += data
    this.callbacks.push(callback)
    for (const char of data) {
      const c = char.charCodeAt(0)
      if (c === 0x18 || c === 0x1a || c === 0x9c) this.state = 'ground'
      else if (c === 0x9b) {
        this.state = 'csi'
        this.parameters = ''
      } else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(c)) {
        this.state = 'string'
        this.osc = c === 0x9d
      } else if (this.state === 'ground') {
        if (c === 0x1b) this.state = 'esc'
      } else if (this.state === 'esc') {
        if (char === '[') {
          this.state = 'csi'
          this.parameters = ''
        } else if (']PX^_'.includes(char)) {
          this.state = 'string'
          this.osc = char === ']'
        } else if (c >= 0x30 && c <= 0x7e) this.state = 'ground'
      } else if (this.state === 'csi') {
        if (c >= 0x40 && c <= 0x7e) {
          if (this.parameters === '?2026' && (char === 'h' || char === 'l'))
            this.synchronized = char === 'h'
          this.state = 'ground'
        } else if (c === 0x1b) this.state = 'esc'
        else if (this.parameters.length < 64) this.parameters += char
      } else if (this.state === 'string') {
        if (c === 7 && this.osc) this.state = 'ground'
        else if (c === 0x1b) this.state = 'string-esc'
      } else if (this.state === 'string-esc') this.state = char === '\\' ? 'ground' : 'string'
    }
    if (!this.synchronized || this.pending.length >= this.limit) this.flush()
    else if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), this.timeout)
  }

  private flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.synchronized = false
    const data = this.pending
    const callbacks = this.callbacks
    this.pending = ''
    this.callbacks = []
    if (data) this.write(data, () => callbacks.forEach((callback) => callback()))
    else callbacks.forEach((callback) => callback())
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.pending = ''
    this.callbacks = []
  }
}
