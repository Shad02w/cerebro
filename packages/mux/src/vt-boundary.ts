/** Keep incomplete VT sequences outside xterm so snapshots never omit parser continuation. */
export class VtBoundary {
  pending = ''
  take(data: string): string {
    const text = this.pending + data
    let state: 'ground' | 'esc' | 'csi' | 'string' | 'string-esc' = 'ground'
    let boundary = 0
    let osc = false
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x18 || c === 0x1a || c === 0x9c) state = 'ground'
      else if (c === 0x9b) state = 'csi'
      else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(c)) {
        state = 'string'
        osc = c === 0x9d
      } else if (state === 'ground') {
        if (c === 0x1b) state = 'esc'
      } else if (state === 'esc') {
        if (c === 0x5b) state = 'csi'
        else if ([0x5d, 0x50, 0x58, 0x5e, 0x5f].includes(c)) {
          state = 'string'
          osc = c === 0x5d
        } else if (c >= 0x30 && c <= 0x7e) state = 'ground'
      } else if (state === 'csi') {
        if (c >= 0x40 && c <= 0x7e) state = 'ground'
        else if (c === 0x1b) state = 'esc'
      } else if (state === 'string') {
        if (c === 7 && osc) state = 'ground'
        else if (c === 0x1b) state = 'string-esc'
      } else if (state === 'string-esc') state = c === 0x5c ? 'ground' : 'string'
      if (state === 'ground' && !(c >= 0xd800 && c <= 0xdbff)) boundary = i + 1
    }
    this.pending = text.slice(boundary)
    if (this.pending.length > 65536) {
      this.pending = ''
      return text.slice(0, boundary) + '\x18'
    }
    return text.slice(0, boundary)
  }
}
