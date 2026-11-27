/**
 * Paints the two ascii.rest pieces, and dissolves one into the other.
 *
 * Each piece is a 200x100 grid of ` ·•●` cells with a palette index per cell.
 * Dot size carries brightness, so a cell is painted as a square in its palette
 * colour: at a couple of hundred columns the glyphs are sub-pixel anyway, and
 * squares sort into one fillStyle per palette entry.
 *
 * The composite: the sunset is the base layer, full frame, always moving, and
 * the scroll lifts it up the frame. The reef is drawn on its own layer with
 * its own ground and masked by a long vertical gradient, so the bottom of the
 * sunset's sea slowly becomes reef instead of meeting it at a line.
 */

import oceanSunset, { meta as sunsetMeta } from './pieces/ocean-sunset'
import deepReef, { meta as reefMeta } from './pieces/deep-reef'
import type { Frame, Meta } from './types'

const DOT_SIZE = [0, 0.36, 0.64, 0.94] // fraction of a cell, per halftone step

type Grid = { size: number; ox: number; oy: number }

/** Cover the frame: the 200x100 grid is scaled up and cropped evenly. */
function cover(vw: number, vh: number): Grid {
  const size = Math.max(vw, vh * 2)
  return { size, ox: (vw - size) / 2, oy: (vh - size / 2) / 2 }
}

type Scene = {
  meta: Meta
  frame: Frame
  /** palette index per cell, filled by the frame call */
  colors: Uint8Array
  /** halftone step per cell, parsed from the returned string */
  steps: Uint8Array
  /** cells bucketed by palette index, so each colour is one fillStyle */
  buckets: number[][]
}

function makeScene(meta: Meta, frame: Frame): Scene {
  const n = meta.cols * meta.rows
  return {
    meta,
    frame,
    colors: new Uint8Array(n),
    steps: new Uint8Array(n),
    buckets: meta.palette.map(() => []),
  }
}

function parse(scene: Scene, t: number) {
  const { meta, colors, steps, frame } = scene
  colors.fill(0)
  const text = frame(t, { color: colors })
  const stride = meta.cols + 1 // rows are joined with "\n"
  for (let r = 0; r < meta.rows; r++) {
    const row = r * stride
    for (let c = 0; c < meta.cols; c++) {
      const ch = text.charCodeAt(row + c)
      // ' ' 0, '·' 1, '•' 2, '●' 3 — by codepoint so there is no split() per frame
      steps[r * meta.cols + c] = ch === 32 ? 0 : ch === 183 ? 1 : ch === 8226 ? 2 : 3
    }
  }
}

/** Dot centres sit in the middle of their cell; sizes stay square. */
const CENTRE = 0.5

function paint(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  t: number,
  g: Grid,
  vw: number,
  y0: number,
  y1: number,
) {
  const { meta, steps, colors, buckets } = scene
  parse(scene, t)

  for (const b of buckets) b.length = 0
  const cell = g.size / meta.cols
  const r0 = Math.max(0, Math.floor((y0 - g.oy) / cell))
  const r1 = Math.min(meta.rows - 1, Math.ceil((y1 - g.oy) / cell))
  const c0 = Math.max(0, Math.floor((0 - g.ox) / cell))
  const c1 = Math.min(meta.cols - 1, Math.ceil((vw - g.ox) / cell))

  for (let r = r0; r <= r1; r++) {
    const row = r * meta.cols
    for (let c = c0; c <= c1; c++) {
      const k = row + c
      if (steps[k] === 0) continue
      buckets[colors[k]].push(k)
    }
  }

  const dot = cell * CENTRE
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i]
    if (!bucket.length) continue
    ctx.fillStyle = meta.palette[i]
    for (let j = 0; j < bucket.length; j++) {
      const k = bucket[j]
      const r = (k / meta.cols) | 0
      const c = k - r * meta.cols
      const s = cell * DOT_SIZE[steps[k]]
      ctx.fillRect(g.ox + c * cell + (dot - s) / 2, g.oy + r * cell + (dot - s) / 2, s, s)
    }
  }
}

const sunset = makeScene(sunsetMeta, oceanSunset())
const reef = makeScene(reefMeta, deepReef())

/** The sunset alone, full frame. */
export function paintSunset(ctx: CanvasRenderingContext2D, t: number, vw: number, vh: number) {
  ctx.fillStyle = sunsetMeta.ground
  ctx.fillRect(0, 0, vw, vh)
  paint(ctx, sunset, t, cover(vw, vh), vw, 0, vh)
}

/** The reef alone, full frame, its own surface at the top. */
export function paintReef(ctx: CanvasRenderingContext2D, t: number, vw: number, vh: number) {
  ctx.fillStyle = reefMeta.ground
  ctx.fillRect(0, 0, vw, vh)
  paint(ctx, reef, t, cover(vw, vh), vw, 0, vh)
}

type Layers = {
  dpr: number
  w: number
  h: number
  sunset: HTMLCanvasElement
  reef: HTMLCanvasElement
  sunsetCtx: CanvasRenderingContext2D
  reefCtx: CanvasRenderingContext2D
}

let layers: Layers | null = null

/** The two scenes live on their own full-frame canvases, rebuilt on resize. */
function ensureLayers(dpr: number, vw: number, vh: number): Layers {
  const w = Math.floor(vw * dpr)
  const h = Math.floor(vh * dpr)
  if (layers && layers.dpr === dpr && layers.w === w && layers.h === h) return layers
  const make = () => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const sunsetCanvas = make()
  const reefCanvas = make()
  layers = {
    dpr,
    w,
    h,
    sunset: sunsetCanvas,
    reef: reefCanvas,
    sunsetCtx: sunsetCanvas.getContext('2d')!,
    reefCtx: reefCanvas.getContext('2d')!,
  }
  return layers
}

/** Paint both scenes for the current moment, ready to be composited. */
export function renderBackground(t: number, vw: number, vh: number, dpr: number) {
  const L = ensureLayers(dpr, vw, vh)

  const sc = L.sunsetCtx
  sc.setTransform(dpr, 0, 0, dpr, 0, 0)
  sc.fillStyle = sunsetMeta.ground
  sc.fillRect(0, 0, vw, vh)
  paint(sc, sunset, t, cover(vw, vh), vw, 0, vh)

  const rc = L.reefCtx
  rc.setTransform(dpr, 0, 0, dpr, 0, 0)
  rc.fillStyle = reefMeta.ground
  rc.fillRect(0, 0, vw, vh)
  // the whole reef is kept, so the scroll can crop into it at any depth
  // without repainting the scene
  paint(rc, reef, t, cover(vw, vh), vw, 0, vh)
  // shade the deep water down, so the sunset above it stays the brightest thing
  rc.globalCompositeOperation = 'source-atop'
  rc.fillStyle = 'rgba(0, 0, 0, 0.34)'
  rc.fillRect(0, 0, vw, vh)
  rc.globalCompositeOperation = 'source-over'
}

// the reef's ground, shaded by the same amount as its scene
const DEEP = (() => {
  const h = reefMeta.ground
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.66))
  return `rgb(${r}, ${g}, ${b})`
})()

// the six stops of the reef's dissolve, clear at the top to opaque at the foot
const MASK: readonly (readonly [number, number])[] = [
  [0, 0], [0.18, 0.05], [0.4, 0.22], [0.62, 0.55], [0.82, 0.86], [1, 1],
]

function maskAt(u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  let i = 1
  while (i < MASK.length - 1 && u > MASK[i][0]) i++
  const [u0, a0] = MASK[i - 1]
  const [u1, a1] = MASK[i]
  return a0 + ((a1 - a0) * (u - u0)) / (u1 - u0)
}

/**
 * Blit the cached scenes for this scroll: the sunset lifted by `shift`, the
 * reef dissolved in over `band` from `line`. A couple of image draws rather
 * than a re-render, so it keeps up with the scroll at frame rate.
 */
export function composeBackground(
  ctx: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  line: number,
  band: number,
  shift: number,
) {
  const L = layers
  if (!L) return

  // in device pixels: the layers are already at backing-store resolution, and
  // whole-pixel strips tile without seams
  const shiftPx = Math.round(shift * L.dpr)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = sunsetMeta.ground
  ctx.fillRect(0, 0, L.w, L.h)
  ctx.drawImage(L.sunset, 0, -shiftPx)

  const a0 = line - band * 0.45
  const a1 = line + band * 0.55
  const linePx = Math.max(0, Math.round(line * L.dpr))

  // above the line the fade has the reef's ground but none of its detail, so
  // the sunset is dimmed into deep water before the reef itself appears
  const gTop = Math.max(0, Math.round(a0 * L.dpr))
  if (linePx > gTop) {
    ctx.fillStyle = DEEP
    const N = 24
    const span = linePx - gTop
    for (let i = 0; i < N; i++) {
      const sy = gTop + Math.round((span * i) / N)
      const ey = gTop + Math.round((span * (i + 1)) / N)
      if (ey <= sy) continue
      const mid = (sy + (ey - sy) / 2) / L.dpr
      const a = maskAt((mid - a0) / band)
      if (a <= 0.002) continue
      ctx.globalAlpha = a
      ctx.fillRect(0, sy, L.w, ey - sy)
    }
    ctx.globalAlpha = 1
  }

  const fadeEnd = Math.min(L.h, Math.round(a1 * L.dpr))
  if (fadeEnd > linePx) {
    // the reef itself, from the water line down: whole-pixel strips at the
    // alpha the smooth mask would have at their middle
    const N = 48
    const span = fadeEnd - linePx
    for (let i = 0; i < N; i++) {
      const sy = linePx + Math.round((span * i) / N)
      const ey = linePx + Math.round((span * (i + 1)) / N)
      if (ey <= sy) continue
      const mid = (sy + (ey - sy) / 2) / L.dpr
      const a = maskAt((mid - a0) / band)
      if (a <= 0.002) continue
      ctx.globalAlpha = a
      ctx.drawImage(L.reef, 0, sy, L.w, ey - sy, 0, sy, L.w, ey - sy)
    }
    ctx.globalAlpha = 1
  }
  // fully opaque below the fade: one draw for the rest of the screen
  if (fadeEnd < L.h) {
    ctx.drawImage(L.reef, 0, fadeEnd, L.w, L.h - fadeEnd, 0, fadeEnd, L.w, L.h - fadeEnd)
  }
  ctx.restore()
}

/** One-shot blend, for the reference harness. */
export function paintBlend(
  ctx: CanvasRenderingContext2D,
  t: number,
  vw: number,
  vh: number,
  line: number,
  band: number,
  dpr: number,
  shift = 0,
) {
  renderBackground(t, vw, vh, dpr)
  composeBackground(ctx, vw, vh, line, band, shift)
}
