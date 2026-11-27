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

let layerCanvas: HTMLCanvasElement | null = null

function layer(dpr: number, vw: number, vh: number) {
  layerCanvas ??= document.createElement('canvas')
  const c = layerCanvas
  const w = Math.floor(vw * dpr)
  const h = Math.floor(vh * dpr)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const lc = c.getContext('2d')!
  lc.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { canvas: c, ctx: lc }
}

/**
 * The background: sunset underneath, reef dissolved in from `line` down over
 * `band` pixels. `shift` lifts the sunset up the frame with the scroll, so the
 * water line climbs through a moving picture rather than a pinned one. Both
 * layers are animated on their own as well.
 */
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
  const top = line - band * 0.45
  if (top >= vh) {
    paintSunset(ctx, t, vw, vh)
    return // the reef has not reached the frame yet
  }

  // below this the reef is fully opaque, so nothing painted under it shows
  const covered = Math.min(vh, line + band * 0.55)
  ctx.fillStyle = sunsetMeta.ground
  ctx.fillRect(0, 0, vw, covered)
  // draw the sunset already lifted: row `shift` of the scene is what sits at
  // the top of the frame, and the seabed it uncovers is under the reef below
  ctx.save()
  ctx.translate(0, -shift)
  paint(ctx, sunset, t, cover(vw, vh), vw, shift, vh)
  ctx.restore()

  const l = layer(dpr, vw, vh)
  const lc = l.ctx
  lc.clearRect(0, 0, vw, vh)
  // its own ground, so a fully-faded reef replaces the sunset rather than
  // leaving its sea showing between the dots
  lc.fillStyle = reefMeta.ground
  lc.fillRect(0, 0, vw, vh)
  // the reef's own surface row sits on the line: scrolling is descending into
  // it, not sliding a fixed picture
  paint(lc, reef, t, cover(vw, vh), vw, line, vh)

  const g = lc.createLinearGradient(0, top, 0, line + band * 0.55)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(0.18, 'rgba(0,0,0,0.05)')
  g.addColorStop(0.4, 'rgba(0,0,0,0.22)')
  g.addColorStop(0.62, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.82, 'rgba(0,0,0,0.86)')
  g.addColorStop(1, 'rgba(0,0,0,1)')
  lc.globalCompositeOperation = 'destination-in'
  lc.fillStyle = g
  lc.fillRect(0, 0, vw, vh)
  lc.globalCompositeOperation = 'source-over'

  ctx.drawImage(l.canvas, 0, 0, vw, vh)
}
