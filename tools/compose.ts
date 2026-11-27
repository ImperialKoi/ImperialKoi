/**
 * Dev harness for looking at the pieces on their own and blended: one still
 * frame each, at /tools/compose.html?shot=sunset|reef|both.
 */

import { composeBackground, paintBlend, paintReef, paintSunset } from '../site/scene'

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const ctx = canvas.getContext('2d', { alpha: false })!
const q = new URLSearchParams(location.search)
const shot = q.get('shot') ?? 'both'
const LINE = Number(q.get('line') ?? 0.82)
const BAND = Number(q.get('band') ?? 0.34)
const SHIFT = Number(q.get('shift') ?? 0) // fraction of the frame the sunset has risen
const T = Number(q.get('t') ?? 14.2) // a settled moment, not frame zero

function draw(t = T) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const vw = Math.round(canvas.getBoundingClientRect().width)
  const vh = Math.round(canvas.getBoundingClientRect().height)
  canvas.width = Math.floor(vw * dpr)
  canvas.height = Math.floor(vh * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (shot === 'sunset') paintSunset(ctx, t, vw, vh)
  else if (shot === 'reef') paintReef(ctx, t, vw, vh)
  else paintBlend(ctx, t, vw, vh, vh * LINE, vh * BAND, dpr, vh * SHIFT)
}

/** Fingerprint of the pixels in a band, for checking that something moves. */
function digest(y0: number, y1: number) {
  const { height } = canvas
  const top = Math.floor(y0 * height)
  const h = Math.floor((y1 - y0) * height)
  const d = ctx.getImageData(0, top, canvas.width, h).data
  let n = 2166136261
  for (let i = 0; i < d.length; i += 16) {
    n ^= d[i]
    n = Math.imul(n, 16777619)
  }
  return n >>> 0
}

draw()
window.addEventListener('resize', () => draw())

// dev-only: render any moment and compare, e.g. window.__shot(15.6)
;(window as unknown as { __shot: (t?: number) => unknown }).__shot = (t?: number) => {
  draw(t ?? T)
  return { top: digest(0, 0.35), bottom: digest(0.75, 1), full: digest(0, 1) }
}

// dev-only: time the scroll composite on the cached layers, in ms a frame
;(window as unknown as { __compose: (n?: number) => number }).__compose = (n = 10) => {
  const css = canvas.getBoundingClientRect()
  const a = performance.now()
  for (let i = 0; i < n; i++) {
    composeBackground(ctx, css.width, css.height, css.height * LINE, css.height * BAND, css.height * SHIFT)
  }
  return +((performance.now() - a) / n).toFixed(2)
}
document.documentElement.dataset.ready = '1'
