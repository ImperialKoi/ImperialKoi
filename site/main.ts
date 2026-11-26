/**
 * Draws a piece as a halftone dot grid, and scrolls between two of them.
 *
 * The pieces are ascii.rest scenes: a 200x100 grid of ` ·•●` cells plus a
 * palette index per cell. Dot size carries brightness, so the grid is painted
 * as squares in the palette colour rather than as text — at a couple of
 * hundred columns the glyphs are sub-pixel anyway.
 */

import oceanSunset, { meta as sunsetMeta } from './pieces/ocean-sunset'
import deepReef, { meta as reefMeta } from './pieces/deep-reef'
import type { Frame, Meta } from './types'

const DOT_SIZE = [0, 0.36, 0.64, 0.94] // fraction of a cell, per halftone step

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

const canvas = document.querySelector<HTMLCanvasElement>('#ocean')!
const ctx = canvas.getContext('2d', { alpha: false })!

const sunset = makeScene(sunsetMeta, oceanSunset())
const reef = makeScene(reefMeta, deepReef())

const P = 0.5 // the piece's own cell aspect is square; dots stay square

/**
 * Paint one scene, clipped to the rows between `y0` and `y1` (viewport px).
 * The grid is scaled to cover the viewport and centred, so the horizon and the
 * reef crests never letterbox.
 */
function paint(scene: Scene, t: number, size: number, ox: number, oy: number, y0: number, y1: number) {
  const { meta, steps, colors, buckets } = scene
  parse(scene, t)

  for (const b of buckets) b.length = 0
  const cell = size / meta.cols
  const r0 = Math.max(0, Math.floor((y0 - oy) / cell))
  const r1 = Math.min(meta.rows - 1, Math.ceil((y1 - oy) / cell))
  const c0 = Math.max(0, Math.floor((0 - ox) / cell))
  const c1 = Math.min(meta.cols - 1, Math.ceil((canvas.clientWidth - ox) / cell))

  for (let r = r0; r <= r1; r++) {
    const row = r * meta.cols
    for (let c = c0; c <= c1; c++) {
      const k = row + c
      if (steps[k] === 0) continue
      buckets[colors[k]].push(k)
    }
  }

  const dot = (cell * P) / 1
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i]
    if (!bucket.length) continue
    ctx.fillStyle = meta.palette[i]
    for (let j = 0; j < bucket.length; j++) {
      const k = bucket[j]
      const r = (k / meta.cols) | 0
      const c = k - r * meta.cols
      const s = cell * DOT_SIZE[steps[k]]
      ctx.fillRect(ox + c * cell + (dot - s) / 2, oy + r * cell + (dot - s) / 2, s, s)
    }
  }
}

let vw = 0
let vh = 0
let size = 0 // grid width in px
let ox = 0
let oy = 0

/** Size the backing store from the canvas's own box, so it always fills it. */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  vw = Math.max(1, Math.round(rect.width))
  vh = Math.max(1, Math.round(rect.height))
  canvas.width = Math.floor(vw * dpr)
  canvas.height = Math.floor(vh * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function layout() {
  resize()
  // cover: the 200x100 grid fills the canvas, cropped evenly
  size = Math.max(vw, vh * 2)
  ox = (vw - size) / 2
  oy = (vh - size / 2) / 2
}

/**
 * The water line: at the top of the page the sunset holds the view; scrolling
 * lifts the surface out of frame and the reef fills the rest.
 */
function waterLine(scrollY: number) {
  const p = Math.min(1, Math.max(0, scrollY / (vh * 1.15)))
  const eased = p * p * (3 - 2 * p)
  // a sliver of water shows under the hero; the surface climbs past the top
  // of the frame as the first screen scrolls away
  return vh * (0.78 - 0.9 * eased)
}

function draw(t: number) {
  // the preview panel can resize without a window resize event reaching us
  const rect = canvas.getBoundingClientRect()
  if (Math.round(rect.width) !== vw || Math.round(rect.height) !== vh) layout()
  const line = waterLine(window.scrollY)

  // sunset above the line, reef below it
  ctx.fillStyle = sunsetMeta.ground
  ctx.fillRect(0, 0, vw, vh)

  if (line > 0) paint(sunset, t, size, ox, oy, 0, line)
  if (line < vh) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, Math.max(0, line), vw, vh - Math.max(0, line))
    ctx.clip()
    if (line > 0) {
      ctx.fillStyle = reefMeta.ground
      ctx.fillRect(0, line, vw, vh - line)
    }
    // the reef's own surface row sits exactly on the water line, so scrolling
    // down is descending into it rather than sliding a fixed image
    paint(reef, t, size, ox, line, line, vh)
    ctx.restore()
  }

  // the surface itself: a lit rule with a little broken foam along it
  if (line > -2 && line < vh + 2) {
    const g = ctx.createLinearGradient(0, line - 14, 0, line + 14)
    g.addColorStop(0, 'rgba(255, 214, 170, 0)')
    g.addColorStop(0.5, 'rgba(255, 214, 170, 0.16)')
    g.addColorStop(1, 'rgba(120, 230, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, line - 14, vw, 28)

    ctx.strokeStyle = 'rgba(255, 236, 205, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= vw; x += 6) {
      const y = line + Math.sin(x * 0.035 + t * 1.1) * 1.6 + Math.sin(x * 0.011 - t * 0.6) * 2.2
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
let raf = 0
let last = 0

function loop(now: number) {
  const t = now / 1000
  // the pieces are authored at 15fps; there is nothing to gain above that
  if (t - last >= 1 / 15) {
    last = t
    draw(t)
  }
  raf = requestAnimationFrame(loop)
}

function start() {
  cancelAnimationFrame(raf)
  if (reduce.matches) {
    draw(12) // a settled frame
    return
  }
  raf = requestAnimationFrame(loop)
}

window.addEventListener('resize', () => {
  layout()
  if (reduce.matches) draw(12)
})
// re-evaluate the water line every frame anyway, but also on scroll for the
// reduced-motion case
window.addEventListener('scroll', () => {
  if (reduce.matches) draw(12)
}, { passive: true })
reduce.addEventListener('change', start)

layout()
// one frame synchronously, so the page is never blank while rAF is suspended
// (a background tab, or a browser that throttles it)
draw(12)
start()

// reveal the copy. Set directly rather than from rAF: a tab that is not on
// screen never runs rAF callbacks, and the content must not stay hidden.
document.documentElement.classList.add('ready')
