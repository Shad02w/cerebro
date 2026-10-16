/**
 * An ASCII texture blown across a pane by a slow wind. Clicks on empty space send out a
 * ripple that pushes the air, lights the characters it passes and tints them; a moving
 * mouse warms a short trail. Pure math only: `ascii-field-renderer.ts` draws it.
 */

export type AsciiLook = 'mixed' | 'lettered' | 'figured'

export const ASCII_LOOKS: Record<AsciiLook, string> = {
  mixed: 'a0bc1dEf2gh3iJk4lmN5op6qR7st8uV9wxYz',
  lettered: 'abcdefgRhijkTlmnoApqrsEtuvwKxyzSaeiou',
  figured: '0a1b2c3D4e5f6G7h8i9J0k1L2m3n4P5q6R7s8t9U'
}

export const FIELD = {
  cellCss: 6.5,
  glyphCss: 9,
  minColumns: 24,
  minRows: 8,
  flick: 1.2,
  morph: 3,
  lull: 0.5,
  streak: 0.4,
  detail: 0.6,
  edge: 0.75,
  curl: 0.65,
  tail: 0.35,
  sweep: 0.3,
  revealS: 4,
  rippleS: 3.6,
  wakeS: 2.4
} as const

export type Calm = { centerX: number; centerY: number; radiusX: number; radiusY: number }

export const DEFAULT_CALM: Calm = { centerX: 0.5, centerY: 0.5, radiusX: 240, radiusY: 140 }

export type FieldLayout = {
  columns: number
  rows: number
  /** Device pixels per cell, snapped so glyphs land on whole pixels. */
  cellWidthPx: number
  cellHeightPx: number
  leftPx: number
  topPx: number
  scale: number
  cssWidth: number
  cssHeight: number
}

export function layoutField(
  cssWidth: number,
  cssHeight: number,
  scale: number
): FieldLayout | null {
  if (!(cssWidth > 0 && cssHeight > 0 && scale > 0)) return null
  const cellWidthPx = Math.max(5, Math.round(FIELD.cellCss * scale))
  const cellHeightPx = cellWidthPx * 2
  const widthPx = Math.round(cssWidth * scale)
  const heightPx = Math.round(cssHeight * scale)
  const columns = Math.floor(widthPx / cellWidthPx)
  const rows = Math.floor(heightPx / cellHeightPx)
  if (columns < FIELD.minColumns || rows < FIELD.minRows) return null
  return {
    columns,
    rows,
    cellWidthPx,
    cellHeightPx,
    leftPx: Math.floor((widthPx - columns * cellWidthPx) / 2),
    topPx: Math.floor((heightPx - rows * cellHeightPx) / 2),
    scale,
    cssWidth,
    cssHeight
  }
}

export function hash32(value: number): number {
  let v = value >>> 0
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d)
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b)
  return (v ^ (v >>> 16)) >>> 0
}

function unit(h: number): number {
  return h / 4294967296
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    return unit(hash32(state))
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lattice(xy: number, z: number): number {
  let v = (xy ^ z) >>> 0
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d)
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b)
  return ((v ^ (v >>> 16)) >>> 0) * (2 / 4294967296) - 1
}

/** Smooth value noise from -1 to 1 on an integer lattice, salted per use. */
export function noise3(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const fz = fade(z - iz)
  const x0 = Math.imul(ix, 0x8da6b343)
  const x1 = Math.imul(ix + 1, 0x8da6b343)
  const y0 = Math.imul(iy, 0xd8163841)
  const y1 = Math.imul(iy + 1, 0xd8163841)
  const z0 = Math.imul(iz, 0xcb1ab31f) ^ salt
  const z1 = Math.imul(iz + 1, 0xcb1ab31f) ^ salt
  const a = lattice(x0 ^ y0, z0)
  const b = lattice(x1 ^ y0, z0)
  const c = lattice(x0 ^ y1, z0)
  const d = lattice(x1 ^ y1, z0)
  const e = lattice(x0 ^ y0, z1)
  const f = lattice(x1 ^ y0, z1)
  const g = lattice(x0 ^ y1, z1)
  const h = lattice(x1 ^ y1, z1)
  const near = a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy
  const far = e + (f - e) * fx + (g + (h - g) * fx - (e + (f - e) * fx)) * fy
  return near + (far - near) * fz
}

export type Wind = {
  seed: number
  look: AsciiLook
  /** Radians; shallow, so the wind always blows mostly sideways. */
  heading: number
  speed: number
  gustLength: number
  gustWidth: number
  bend: number
  bendScale: number
}

const LOOKS = Object.keys(ASCII_LOOKS) as AsciiLook[]

export function createWind(seed: number, look?: AsciiLook): Wind {
  const random = seededRandom(seed)
  const between = (low: number, high: number): number => low + (high - low) * random()
  const pick = random()
  const shallow = Math.PI / 10 + (Math.PI / 4.3 - Math.PI / 10) * ((pick * 2) % 1)
  return {
    seed: seed >>> 0,
    look: look ?? LOOKS[Math.floor(random() * LOOKS.length)] ?? 'mixed',
    heading: pick < 0.5 ? shallow : Math.PI - shallow,
    speed: between(42, 64),
    gustLength: between(380, 560),
    gustWidth: between(120, 190),
    bend: between(60, 110),
    bendScale: between(300, 440)
  }
}

type Tap = { x: number; y: number; at: number; force: number }
type Wake = {
  x: number
  y: number
  at: number
  force: number
  dx: number
  dy: number
  half: number
}

/** What the hand does to the air at a point. */
export type TouchSample = {
  pushX: number
  pushY: number
  raise: number
  roused: number
  glow: number
  afterglow: number
  warmth: number
}

const HEART_STEPS = 128
const heartRadii = (() => {
  // Heart curve (x² + y² − 1)³ = x²y³ with y up, solved for the radius in each direction.
  const radii = new Float32Array(HEART_STEPS)
  for (let i = 0; i < HEART_STEPS; i++) {
    const angle = (i / HEART_STEPS) * Math.PI * 2
    const ux = Math.cos(angle)
    const uy = -Math.sin(angle)
    let low = 0.2
    let high = 1.8
    for (let step = 0; step < 24; step++) {
      const r = (low + high) / 2
      const value = (r * r - 1) ** 3 - r ** 5 * ux * ux * uy * uy * uy
      if (value < 0) low = r
      else high = r
    }
    radii[i] = (low + high) / 2
  }
  return radii
})()

/** Outline radius of a heart in screen direction (dx, dy), against a circle's 1. */
export function heartRadius(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx)
  const index = Math.round(
    ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * HEART_STEPS
  )
  return heartRadii[index % HEART_STEPS] ?? 1
}

export class Touches {
  private taps: Tap[] = []
  private wakes: Wake[] = []
  private tapCount = 0
  private last: { x: number; y: number; at: number } | null = null
  private anchor: { x: number; y: number; at: number } | null = null
  private speed = 0

  /** Every third click is a heart. */
  tap(x: number, y: number, now: number): void {
    this.tapCount += 1
    const force = this.tapCount % 3 === 0 ? -1.15 : 1
    this.taps = [...this.taps.slice(-5), { x, y, at: now, force }]
  }

  move(x: number, y: number, now: number): boolean {
    const last = this.last
    if (!last || !this.anchor || now - last.at > 0.25) {
      this.last = { x, y, at: now }
      this.anchor = this.last
      this.speed = 0
      return false
    }
    const dt = Math.max(now - last.at, 1 / 240)
    this.speed += (Math.hypot(x - last.x, y - last.y) / dt - this.speed) * Math.min(1, dt / 0.08)
    this.last = { x, y, at: now }
    const from = this.anchor
    const length = Math.hypot(x - from.x, y - from.y)
    if (length < 18 || now - from.at < 0.035) return false
    this.anchor = this.last
    const stir = smoothstep(60, 800, this.speed)
    if (stir < 0.04) return false
    const half = length / 2
    this.wakes = [
      ...this.wakes.slice(-47),
      {
        x: (x + from.x) / 2,
        y: (y + from.y) / 2,
        at: now,
        force: (stir * length) / (length + 90),
        dx: (x - from.x) / length,
        dy: (y - from.y) / length,
        half
      }
    ]
    return true
  }

  leave(): void {
    this.last = null
  }

  prune(now: number): void {
    this.taps = this.taps.filter((tap) => now - tap.at < FIELD.rippleS)
    this.wakes = this.wakes.filter((wake) => now - wake.at < FIELD.wakeS)
  }

  rippling(now: number): boolean {
    return this.taps.some((tap) => now - tap.at < FIELD.rippleS)
  }

  busy(now: number): boolean {
    return this.rippling(now) || this.wakes.some((wake) => now - wake.at < FIELD.wakeS)
  }

  active(): boolean {
    return this.taps.length > 0 || this.wakes.length > 0
  }

  sample(x: number, y: number, now: number, out: TouchSample): TouchSample {
    out.pushX = 0
    out.pushY = 0
    out.raise = 0
    out.roused = 0
    out.glow = 0
    out.afterglow = 0
    out.warmth = 0
    for (const tap of this.taps) {
      const age = now - tap.at
      if (age < 0) continue
      const awayX = x - tap.x
      const awayY = y - tap.y
      const distance = Math.hypot(awayX, awayY)
      const reach = tap.force < 0 ? distance / heartRadius(awayX, awayY) : distance
      // A front runs out fast and slows, widening as it goes.
      const behind = 620 * (1 - Math.exp(-age / 1.3)) - reach
      const width = 85 + 60 * age
      const front = smoothstep(-16, 10, behind) * Math.exp(-(behind * behind) / (width * width))
      const strength = Math.abs(tap.force)
      const swell = strength * Math.exp(-age / 1.5) * front
      const inverse = 1 / Math.max(distance, 1)
      out.pushX += awayX * inverse * 44 * swell
      out.pushY += awayY * inverse * 44 * swell
      out.raise += 1.9 * swell * (0.25 + 0.75 * Math.cos((behind * Math.PI * 2) / 130))
      out.roused += swell
      const trail = smoothstep(0, 70, behind) * Math.exp(-Math.max(behind, 0) / 260)
      out.glow += strength * (Math.exp(-age) * front + 0.7 * Math.exp(-age / 1.3) * trail)
      out.afterglow += strength * (1 - Math.exp(-age / 0.2)) * Math.exp(-age / 1.2) * trail
    }
    let warm = 0
    for (const wake of this.wakes) {
      const age = Math.max(0, now - wake.at)
      const strength = wake.force * (1 - Math.exp(-age / 0.05)) * Math.exp(-age / 0.65)
      if (strength < 0.002) continue
      const radius = 50 + 40 * age
      let awayX = x - wake.x
      let awayY = y - wake.y
      const along = Math.min(wake.half, Math.max(-wake.half, awayX * wake.dx + awayY * wake.dy))
      awayX -= wake.dx * along
      awayY -= wake.dy * along
      warm += strength * Math.exp(-(awayX * awayX + awayY * awayY) / (radius * radius))
    }
    out.warmth = 1 - Math.exp(-1.5 * warm)
    out.raise += 0.25 * out.warmth
    out.roused += 0.05 * out.warmth
    return out
  }
}

const COARSE = 4

/**
 * Per-cell light, tint and glyph for one moment. The wind is sampled once per pair of
 * cells (a square), and its slow bends once per 4×4 squares, then each cell varies a little.
 */
export class AsciiFieldFrame {
  /** How lit each cell is, 0 to 1. */
  readonly light: Float32Array
  /** How far a lit cell takes the glow colour instead of the ink, 0 to 1. */
  readonly tint: Float32Array
  /** Faint glow left inside a ripple, shown even where the wind is not. */
  readonly afterglow: Float32Array
  readonly glyph: Uint8Array
  readonly columns: number
  readonly rows: number
  private readonly pairs: number
  private readonly cellJitter: Float32Array
  private readonly cellPace: Float32Array
  private readonly cellPhase: Float32Array
  private readonly cellOffset: Uint32Array
  private readonly coarseColumns: number
  private readonly coarseRows: number
  private readonly bendX: Float32Array
  private readonly bendY: Float32Array
  private readonly curlX: Float32Array
  private readonly curlY: Float32Array
  private readonly sample: TouchSample = {
    pushX: 0,
    pushY: 0,
    raise: 0,
    roused: 0,
    glow: 0,
    afterglow: 0,
    warmth: 0
  }

  constructor(
    readonly layout: FieldLayout,
    readonly wind: Wind,
    readonly calm: Calm = DEFAULT_CALM
  ) {
    const { columns, rows } = layout
    this.columns = columns
    this.rows = rows
    const cells = columns * rows
    this.light = new Float32Array(cells)
    this.tint = new Float32Array(cells)
    this.afterglow = new Float32Array(cells)
    this.glyph = new Uint8Array(cells)
    this.cellJitter = new Float32Array(cells)
    this.cellPace = new Float32Array(cells)
    this.cellPhase = new Float32Array(cells)
    this.cellOffset = new Uint32Array(cells)
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column
        const h = hash32(Math.imul(column, 0x9e3779b9) ^ hash32(row ^ wind.seed))
        const pace = hash32(h)
        this.cellJitter[index] = unit(hash32(pace ^ 0x51))
        this.cellPace[index] = 0.6 + 0.8 * unit(pace)
        this.cellPhase[index] = unit(hash32(pace ^ 0x33))
        this.cellOffset[index] = h >>> 8
      }
    }
    this.pairs = Math.ceil(columns / 2)
    this.coarseColumns = Math.ceil(this.pairs / COARSE) + 2
    this.coarseRows = Math.ceil(rows / COARSE) + 2
    const coarse = this.coarseColumns * this.coarseRows
    this.bendX = new Float32Array(coarse)
    this.bendY = new Float32Array(coarse)
    this.curlX = new Float32Array(coarse)
    this.curlY = new Float32Array(coarse)
  }

  /** Centre of a cell in CSS pixels of the pane. */
  cellCenter(column: number, row: number): [number, number] {
    const { leftPx, topPx, cellWidthPx, cellHeightPx, scale } = this.layout
    return [
      (leftPx + (column + 0.5) * cellWidthPx) / scale,
      (topPx + (row + 0.5) * cellHeightPx) / scale
    ]
  }

  /**
   * Fills `light`, `tint` and `glyph`. `time` is the wind's own clock (it slows when settling);
   * `now` is wall seconds, which ripples keep. Returns how many cells are lit.
   */
  render(time: number, now: number, touches: Touches, reveal: number): number {
    const { layout, wind, calm } = this
    const { columns, rows, cellWidthPx, cellHeightPx, leftPx, topPx, scale } = layout
    const squareCss = (cellWidthPx * 2) / scale
    const rowCss = cellHeightPx / scale
    const originX = leftPx / scale
    const originY = topPx / scale
    const headingX = Math.cos(wind.heading)
    const headingY = Math.sin(wind.heading)
    const carried = wind.speed * (time + noise3(time * 0.09, 3.7, 0, 0x58))
    const span =
      0.58 * (Math.abs(headingX) * layout.cssWidth + Math.abs(headingY) * layout.cssHeight)
    const eddySize = 1.15 * wind.gustWidth

    for (let cy = 0; cy < this.coarseRows; cy++) {
      for (let cx = 0; cx < this.coarseColumns; cx++) {
        const index = cy * this.coarseColumns + cx
        const x = originX + (cx - 0.5) * COARSE * squareCss
        const y = originY + (cy - 0.5) * COARSE * rowCss
        this.bendX[index] = noise3(x / wind.bendScale, y / wind.bendScale, time * 0.04, 0x51)
        this.bendY[index] = noise3(
          x / wind.bendScale + 17.3,
          y / wind.bendScale,
          time * 0.04 + 5,
          0x52
        )
        const qx = x * headingX + y * headingY - 0.85 * carried
        const qy = -x * headingY + y * headingX
        this.curlX[index] = noise3(qx / eddySize, qy / eddySize, FIELD.morph * time * 0.04, 0x59)
        this.curlY[index] = noise3(
          qx / eddySize + 31.7,
          qy / eddySize,
          FIELD.morph * time * 0.04 + 3,
          0x5a
        )
      }
    }

    const level = 0.02 + (0.82 - 0.02) * FIELD.lull
    const band = 0.26 + (0.03 - 0.26) * FIELD.edge
    const floor = level - band - 0.55 * FIELD.tail
    const touching = touches.active()
    const calmX = calm.centerX * layout.cssWidth
    const calmY = calm.centerY * layout.cssHeight
    const look = ASCII_LOOKS[wind.look]
    const sample = this.sample
    let lit = 0

    for (let row = 0; row < rows; row++) {
      const y = originY + (row + 0.5) * rowCss
      for (let pair = 0; pair < this.pairs; pair++) {
        const x = originX + (pair + 0.5) * squareCss
        let warmth = 0
        let roused = 0
        let glow = 0
        let afterglow = 0
        let raise = 0
        let fromX = x
        let fromY = y
        if (touching) {
          const nearX = x + 24 * noise3(x / 95, y / 95, now * 0.12, 0x71)
          const nearY = y + 24 * noise3(x / 95 + 9.1, y / 95, now * 0.12 + 4, 0x72)
          touches.sample(nearX, nearY, now, sample)
          warmth = sample.warmth
          roused = sample.roused
          glow = sample.glow
          afterglow = sample.afterglow
          raise = sample.raise
          fromX -= sample.pushX
          fromY -= sample.pushY
        }

        const gx = Math.min(
          this.coarseColumns - 1.001,
          Math.max(0, (fromX - originX) / (COARSE * squareCss) + 0.5)
        )
        const gy = Math.min(
          this.coarseRows - 1.001,
          Math.max(0, (fromY - originY) / (COARSE * rowCss) + 0.5)
        )
        const bendX = this.bilinear(this.bendX, gx, gy)
        const bendY = this.bilinear(this.bendY, gx, gy)
        const curlX = this.bilinear(this.curlX, gx, gy)
        const curlY = this.bilinear(this.curlY, gx, gy)

        const bentX = fromX + wind.bend * bendX
        const bentY = fromY + wind.bend * bendY
        const qx = bentX * headingX + bentY * headingY + FIELD.curl * 0.9 * wind.gustWidth * curlX
        const qy = -bentX * headingY + bentY * headingX + FIELD.curl * 0.9 * wind.gustWidth * curlY

        let gust = 0
        let weight = 1
        let power = 0
        let sizeX = 0.85 * wind.gustLength
        let sizeY = 0.75 * wind.gustWidth
        const gain = 0.38 + (0.62 - 0.38) * FIELD.detail
        for (let octave = 0; octave < 3; octave++) {
          gust +=
            weight *
            noise3(
              (qx - carried * (1 + 0.1 * octave)) / sizeX,
              qy / sizeY,
              FIELD.morph * time * (0.03 + 0.018 * octave) + 11 * octave,
              0x60 + octave
            )
          power += weight * weight
          weight *= gain
          sizeX *= 0.5
          sizeY *= 0.58
        }
        const drift = 0.5 * span * noise3(time * 0.045, qy / (2.5 * wind.gustWidth), 7, 0x67)
        const swell = Math.cos(((qx - carried + drift) * Math.PI * 2) / span)
        const field = (1.6 * gust) / Math.sqrt(power) + FIELD.sweep * swell + raise

        let strength = 0
        let streaks = 0
        if (field > floor || warmth > 0) {
          const thread = noise3((qx - carried * 1.6) / 140, qy / 30, time * 0.16, 0x57)
          streaks = 1 - smoothstep(0, 0.5, Math.abs(thread))
        }
        if (field > floor) {
          const shown = smoothstep(floor, level + band, field)
          const broad =
            shown * shown * (0.45 + 0.55 * Math.min(1, Math.max(0, (field - level) / 0.45)))
          strength = broad * (1 + (0.25 + 0.95 * streaks - 1) * FIELD.streak)
        }

        const calmDx = (x - calmX) / calm.radiusX
        const calmDy = (y - calmY) / calm.radiusY
        const quiet = 1 - 0.7 * Math.exp(-0.9 * (calmDx * calmDx + calmDy * calmDy))
        const visible = Math.max(reveal, Math.min(1, 2 * roused + warmth))

        for (let side = 0; side < 2; side++) {
          const column = pair * 2 + side
          if (column >= columns) break
          const index = row * columns + column
          const jitter = this.cellJitter[index] ?? 0
          let cellStrength = strength * (0.82 + 0.18 * jitter)
          if (warmth > 0) {
            const grain = 0.6 * (jitter - 0.5) + 0.5 * (streaks - 0.4)
            cellStrength =
              1 - (1 - cellStrength) * (1 - 0.85 * warmth * smoothstep(-0.5, 0.25, grain))
          }
          const light = Math.min(1, cellStrength * quiet * visible)
          this.light[index] = light
          this.tint[index] = smoothstep(0.04, 0.3, glow * (0.65 + 0.35 * jitter))
          this.afterglow[index] = Math.min(1, 0.3 * afterglow * quiet)
          const steps =
            Math.floor(
              time * FIELD.flick * (this.cellPace[index] ?? 1) + (this.cellPhase[index] ?? 0)
            ) + Math.floor(6 * roused + jitter)
          this.glyph[index] = ((this.cellOffset[index] ?? 0) + steps) % look.length
          if (light > 0.01 || (this.afterglow[index] ?? 0) > 0.01) lit += 1
        }
      }
    }
    return lit
  }

  private bilinear(values: Float32Array, gx: number, gy: number): number {
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = gx - x0
    const ty = gy - y0
    const width = this.coarseColumns
    const a = values[y0 * width + x0] ?? 0
    const b = values[y0 * width + x0 + 1] ?? 0
    const c = values[(y0 + 1) * width + x0] ?? 0
    const d = values[(y0 + 1) * width + x0 + 1] ?? 0
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
  }
}
