/**
 * Drives the background: one fixed canvas, the sunset as its base and the reef
 * dissolved in from the water line down. Both pieces animate continuously; the
 * scroll only moves the dissolve up the frame.
 */

import { paintBlend } from './scene'

const canvas = document.querySelector<HTMLCanvasElement>('#ocean')!
const ctx = canvas.getContext('2d', { alpha: false })!

let vw = 0
let vh = 0
let dpr = 1

/** Size the backing store from the canvas's own box, so it always fills it. */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  vw = Math.max(1, Math.round(rect.width))
  vh = Math.max(1, Math.round(rect.height))
  canvas.width = Math.floor(vw * dpr)
  canvas.height = Math.floor(vh * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/**
 * Where the reef's surface sits, and how long the fade into it runs. At rest it
 * is on the sunset's horizon, so the sun's sea is the first water you meet; by
 * the time the first screen has scrolled away the reef has risen most of the
 * way up the frame and you are inside it.
 */
function waterLine(scrollY: number) {
  const p = Math.min(1, Math.max(0, scrollY / (vh * 1.15)))
  const eased = p * p * (3 - 2 * p)
  return { line: vh * (0.66 - 0.48 * eased), band: vh * 0.46 }
}

function draw(t: number) {
  // the preview panel can resize without a window resize event reaching us
  const rect = canvas.getBoundingClientRect()
  if (Math.round(rect.width) !== vw || Math.round(rect.height) !== vh) resize()

  const { line, band } = waterLine(window.scrollY)
  paintBlend(ctx, t, vw, vh, line, band, dpr)
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
    draw(9)
    return
  }
  raf = requestAnimationFrame(loop)
}

window.addEventListener('resize', () => {
  resize()
  draw(reduce.matches ? 9 : performance.now() / 1000)
})

reduce.addEventListener('change', start)

resize()
// one frame synchronously, so the page is never blank while rAF is suspended
// (a background tab, or a browser that throttles it)
draw(9)
start()

// reveal the copy. Set directly rather than from rAF: a tab that is not on
// screen never runs rAF callbacks, and the content must not stay hidden.
document.documentElement.classList.add('ready')
