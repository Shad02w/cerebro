import {
  ASCII_LOOKS,
  AsciiFieldFrame,
  DEFAULT_CALM,
  FIELD,
  Touches,
  createWind,
  layoutField,
  type Calm,
  type FieldLayout
} from '@/lib/ascii-field'

/** Clicks on these start their own action, not a ripple. */
const INTERACTIVE = [
  'a,button,input,textarea,select,label,summary',
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
  ...'button link textbox combobox listbox option menu menuitem tab switch checkbox radio slider dialog'
    .split(' ')
    .map((role) => `[role='${role}']`)
].join(',')

/** The app's selection accent (teal), which follows light/dark; used if the variable is unset. */
const ACCENT_VAR = '--sidebar-selected'
const ACCENT_FALLBACK = { dark: 'oklch(0.85 0.13 181)', light: 'oklch(0.70 0.12 182)' }
const INK_ALPHA = 0.3
const GLOW_ALPHA = 0.85
const FRAME_MS = 40
const RIPPLE_FRAME_MS = 16
const BUDGET_S = 180
const SETTLE_S = 8

type Atlas = { ink: HTMLCanvasElement; glow: HTMLCanvasElement; key: string }

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

function drawAtlas(
  doc: Document,
  layout: FieldLayout,
  glyphs: string,
  font: string,
  color: string
): HTMLCanvasElement {
  const canvas = doc.createElement('canvas')
  canvas.width = layout.cellWidthPx * glyphs.length
  canvas.height = layout.cellHeightPx
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  ;[...glyphs].forEach((glyph, index) => {
    context.fillText(glyph, (index + 0.5) * layout.cellWidthPx, Math.round(layout.cellHeightPx / 2))
  })
  return canvas
}

/**
 * Draws the ASCII field into `layer` and drives it from pointer input on the layer's parent.
 * Returns a cleanup function.
 */
export function mountAsciiField(layer: HTMLElement, calm: Calm = DEFAULT_CALM): () => void {
  const doc = layer.ownerDocument
  const win = doc.defaultView
  if (!win) return () => {}
  const canvas = doc.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  canvas.className = 'absolute top-0 left-0 block'
  layer.append(canvas)

  const still = win.matchMedia('(prefers-reduced-motion: reduce)').matches
  const seed = win.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1
  const wind = createWind(seed)
  const glyphs = ASCII_LOOKS[wind.look]
  const touches = new Touches()
  const clock = (): number => win.performance.now() / 1000

  let frame: AsciiFieldFrame | null = null
  let atlas: Atlas | null = null
  let windTime = (seed / 4294967296) * 64
  let elapsed = 0
  let budgetEnd = BUDGET_S
  let lastTick = clock()
  let timer: number | undefined
  let animation: number | undefined
  let destroyed = false

  const ensureAtlas = (): Atlas | null => {
    if (!frame) return null
    const style = win.getComputedStyle(layer)
    const scheme = style.colorScheme.includes('light') ? 'light' : 'dark'
    const { layout } = frame
    const glyphPx = Math.min(
      Math.round(FIELD.glyphCss * layout.scale),
      Math.floor((layout.cellWidthPx - 1) / 0.6)
    )
    const weight = layout.scale >= 1.5 ? 300 : 400
    const font = `${weight} ${glyphPx}px ${style.fontFamily}`
    const accent = style.getPropertyValue(ACCENT_VAR).trim() || ACCENT_FALLBACK[scheme]
    const key = `${font}|${style.color}|${accent}|${layout.cellWidthPx}`
    if (atlas?.key === key) return atlas
    atlas = {
      key,
      ink: drawAtlas(doc, layout, glyphs, font, style.color),
      glow: drawAtlas(doc, layout, glyphs, font, accent)
    }
    return atlas
  }

  const draw = (reveal: number): void => {
    const sprites = ensureAtlas()
    if (!frame || !sprites) return
    const now = clock()
    touches.prune(now)
    frame.render(windTime, now, touches, reveal)
    const { columns, rows, cellWidthPx: w, cellHeightPx: h, leftPx, topPx } = frame.layout
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (let row = 0; row < rows; row++) {
      const y = topPx + row * h
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column
        const light = frame.light[index] ?? 0
        const tint = frame.tint[index] ?? 0
        const afterglow = frame.afterglow[index] ?? 0
        const source = (frame.glyph[index] ?? 0) * w
        const x = leftPx + column * w
        const ink = light * (1 - tint) * INK_ALPHA
        if (ink > 0.004) {
          context.globalAlpha = ink
          context.drawImage(sprites.ink, source, 0, w, h, x, y, w, h)
        }
        const glow = Math.min(1, light * tint * GLOW_ALPHA + afterglow * 0.35)
        if (glow > 0.004) {
          context.globalAlpha = glow
          context.drawImage(sprites.glow, source, 0, w, h, x, y, w, h)
        }
      }
    }
    context.globalAlpha = 1
  }

  const running = (): boolean => !destroyed && !still && !doc.hidden && doc.hasFocus()

  const stop = (): void => {
    win.clearTimeout(timer)
    if (animation !== undefined) win.cancelAnimationFrame(animation)
    timer = undefined
    animation = undefined
  }

  const tick = (): void => {
    animation = undefined
    const now = clock()
    const dt = Math.min(0.25, Math.max(0, now - lastTick))
    lastTick = now
    elapsed += dt
    const energy = 1 - smoothstep((elapsed - budgetEnd) / SETTLE_S)
    windTime += dt * energy
    draw(smoothstep(elapsed / FIELD.revealS))
    if (energy === 0 && !touches.busy(now)) return
    schedule()
  }

  const schedule = (): void => {
    if (!running() || timer !== undefined || animation !== undefined) return
    timer = win.setTimeout(
      () => {
        timer = undefined
        animation = win.requestAnimationFrame(tick)
      },
      touches.rippling(clock()) ? RIPPLE_FRAME_MS : FRAME_MS
    )
  }

  const wake = (): void => {
    budgetEnd = Math.max(budgetEnd, elapsed + BUDGET_S)
    if (running() && timer === undefined && animation === undefined) {
      lastTick = clock()
      schedule()
    }
  }

  const refresh = (): void => {
    if (running()) wake()
    else stop()
  }

  const resize = (width: number, height: number): void => {
    const layout = layoutField(width, height, win.devicePixelRatio || 1)
    canvas.style.visibility = layout ? '' : 'hidden'
    if (!layout) {
      frame = null
      return
    }
    canvas.width = Math.round(width * layout.scale)
    canvas.height = Math.round(height * layout.scale)
    canvas.style.width = `${canvas.width / layout.scale}px`
    canvas.style.height = `${canvas.height / layout.scale}px`
    frame = new AsciiFieldFrame(layout, wind, calm)
    if (!running()) elapsed = Math.max(elapsed, FIELD.revealS)
    draw(smoothstep(elapsed / FIELD.revealS))
    refresh()
  }

  const resizeObserver = new win.ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) resize(box.width, box.height)
  })
  resizeObserver.observe(layer)

  const themeObserver = new win.MutationObserver(() => {
    if (!frame) return
    const before = atlas?.key
    if (ensureAtlas()?.key !== before && !running()) draw(1)
  })
  themeObserver.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })

  const host = layer.parentElement
  const point = (event: PointerEvent): [number, number] | null => {
    if (still || !frame) return null
    const box = layer.getBoundingClientRect()
    return [event.clientX - box.left, event.clientY - box.top]
  }
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return
    const at = point(event)
    if (at && touches.move(at[0], at[1], clock())) wake()
  }
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const at = point(event)
    if (!at) return
    const target = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null
    if (!target || target === host || !host?.contains(target)) touches.tap(at[0], at[1], clock())
    wake()
  }
  const onLeave = (): void => touches.leave()
  host?.addEventListener('pointermove', onMove, { passive: true })
  host?.addEventListener('pointerdown', onDown, { passive: true })
  host?.addEventListener('pointerleave', onLeave, { passive: true })
  doc.addEventListener('visibilitychange', refresh)
  win.addEventListener('focus', refresh)
  win.addEventListener('blur', refresh)

  return () => {
    destroyed = true
    stop()
    resizeObserver.disconnect()
    themeObserver.disconnect()
    host?.removeEventListener('pointermove', onMove)
    host?.removeEventListener('pointerdown', onDown)
    host?.removeEventListener('pointerleave', onLeave)
    doc.removeEventListener('visibilitychange', refresh)
    win.removeEventListener('focus', refresh)
    win.removeEventListener('blur', refresh)
    canvas.remove()
  }
}
