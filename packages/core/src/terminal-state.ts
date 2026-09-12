/** Version-pinned xterm 6.0 continuation omitted by addon-serialize.
 * Screen cells travel as VT; these fields preserve subsequent interpretation.
 * Changing xterm requires running the continuation/replay tests. */
type Attributes = { fg: number; bg: number; extended: Record<string, number> }
type BufferState = {
  savedX: number
  savedY: number
  savedCharset: Record<string, string> | null
  savedCurAttrData: Attributes
  scrollTop: number
  scrollBottom: number
  tabs: Record<string, boolean>
}
export type TerminalContinuation = {
  version: 1 | 2
  charset: {
    glevel: number
    charset?: Record<string, string> | null
    _charsets: Array<Record<string, string> | null>
  }
  normal: BufferState
  alternate: BufferState
  modes: Record<string, boolean>
  privateModes: PrivateModes
  attributes: Attributes
  cursorOptions?: { cursorBlink: boolean; cursorStyle: 'block' | 'underline' | 'bar' }
  cursorHidden: boolean
  mouseProtocol: string
  mouseEncoding: string
}
type PrivateModes = {
  applicationCursorKeys?: boolean
  applicationKeypad?: boolean
  bracketedPasteMode?: boolean
  origin?: boolean
  reverseWraparound?: boolean
  sendFocus?: boolean
  wraparound?: boolean
  cursorBlink?: boolean
  cursorStyle?: 'block' | 'underline' | 'bar'
}
function persistentPrivateModes(modes: PrivateModes): PrivateModes {
  return {
    applicationCursorKeys: modes.applicationCursorKeys ?? false,
    applicationKeypad: modes.applicationKeypad ?? false,
    bracketedPasteMode: modes.bracketedPasteMode ?? false,
    origin: modes.origin ?? false,
    reverseWraparound: modes.reverseWraparound ?? false,
    sendFocus: modes.sendFocus ?? false,
    wraparound: modes.wraparound ?? true,
    cursorBlink: modes.cursorBlink,
    cursorStyle: modes.cursorStyle
  }
}
type Core = {
  _charsetService: TerminalContinuation['charset']
  _bufferService: { buffers: { normal: BufferState; alt: BufferState } }
  coreService: {
    modes: Record<string, boolean>
    decPrivateModes: PrivateModes & { synchronizedOutput: boolean }
    isCursorHidden: boolean
  }
  coreMouseService: { activeProtocol: string; activeEncoding: string }
  _inputHandler: { _curAttrData: Attributes }
}
function core(terminal: unknown): Core {
  return (terminal as { _core: Core })._core
}
function attributes(value: Attributes): Attributes {
  return { fg: value.fg, bg: value.bg, extended: { ...value.extended } }
}
function buffer(value: BufferState): BufferState {
  return {
    savedX: value.savedX,
    savedY: value.savedY,
    savedCharset: value.savedCharset,
    savedCurAttrData: attributes(value.savedCurAttrData),
    scrollTop: value.scrollTop,
    scrollBottom: value.scrollBottom,
    tabs: { ...value.tabs }
  }
}
export function captureTerminalContinuation(terminal: unknown): TerminalContinuation {
  const c = core(terminal)
  return structuredClone({
    version: 2 as const,
    charset: {
      glevel: c._charsetService.glevel,
      charset: c._charsetService.charset,
      _charsets: c._charsetService._charsets
    },
    normal: buffer(c._bufferService.buffers.normal),
    alternate: buffer(c._bufferService.buffers.alt),
    modes: { ...c.coreService.modes },
    privateModes: persistentPrivateModes(c.coreService.decPrivateModes),
    attributes: attributes(c._inputHandler._curAttrData),
    cursorOptions: {
      cursorBlink: (terminal as { options: { cursorBlink: boolean } }).options.cursorBlink,
      cursorStyle: (terminal as { options: { cursorStyle: 'block' | 'underline' | 'bar' } }).options
        .cursorStyle
    },
    cursorHidden: c.coreService.isCursorHidden,
    mouseProtocol: c.coreMouseService.activeProtocol,
    mouseEncoding: c.coreMouseService.activeEncoding
  })
}
export function restoreTerminalContinuation(terminal: unknown, state: TerminalContinuation): void {
  if (state.version !== 1 && state.version !== 2)
    throw new Error('Unsupported terminal continuation version.')
  const c = core(terminal)
  if (state.version === 2 && state.cursorOptions) {
    Object.assign(
      (terminal as { options: NonNullable<TerminalContinuation['cursorOptions']> }).options,
      state.cursorOptions
    )
  }
  const restoreAttributes = (target: Attributes, source: Attributes): void => {
    target.fg = source.fg
    target.bg = source.bg
    Object.assign(target.extended, source.extended)
  }
  const restoreBuffer = (target: BufferState, source: BufferState): void => {
    const { savedCurAttrData, ...rest } = source
    Object.assign(target, rest)
    restoreAttributes(target.savedCurAttrData, savedCurAttrData)
  }
  Object.assign(c._charsetService, structuredClone(state.charset))
  restoreBuffer(c._bufferService.buffers.normal, state.normal)
  restoreBuffer(c._bufferService.buffers.alt, state.alternate)
  Object.assign(c.coreService.modes, state.modes)
  Object.assign(c.coreService.decPrivateModes, persistentPrivateModes(state.privateModes))
  // A snapshot is a completed screen, not a live render transaction.
  c.coreService.decPrivateModes.synchronizedOutput = false
  restoreAttributes(c._inputHandler._curAttrData, state.attributes)
  c.coreService.isCursorHidden = state.cursorHidden
  c.coreMouseService.activeProtocol = state.mouseProtocol
  c.coreMouseService.activeEncoding = state.mouseEncoding
}
