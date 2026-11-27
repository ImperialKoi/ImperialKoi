/**
 * Drives the background: one fixed canvas, the sunset as its base and the reef
 * dissolved in from the water line down. Both pieces animate continuously, and
 * the scroll lifts the sunset while the reef's water line rises with it.
 */

import { composeBackground, renderBackground } from './scene'

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
 * The whole transition is one scroll: the sunset rises up the frame and the
 * reef's surface rises with it, so the water you are looking at changes from
 * the sun's sea to the reef rather than the reef wiping a fixed picture. The
 * fade band stays long, so the two waters overlap instead of meeting at a line.
 */
function waterLine(scrollY: number) {
  const p = Math.min(1, Math.max(0, scrollY / (vh * 1.15)))
  const eased = p * p * (3 - 2 * p)
  return {
    line: vh * (0.66 - 0.48 * eased),
    band: vh * 0.46,
    // the sunset travels almost with the reef line, so its horizon and the
    // reef's surface rise together through the crossing
    shift: vh * 0.42 * eased,
  }
}

function draw(t: number) {
  // the preview panel can resize without a window resize event reaching us
  const rect = canvas.getBoundingClientRect()
  if (Math.round(rect.width) !== vw || Math.round(rect.height) !== vh) resize()

  const { line, band, shift } = waterLine(window.scrollY)
  renderBackground(t, vw, vh, dpr)
  composeBackground(ctx, vw, vh, line, band, shift)
}

/** Re-blit the cached scenes for the current scroll, without repainting them. */
function compose() {
  const { line, band, shift } = waterLine(window.scrollY)
  composeBackground(ctx, vw, vh, line, band, shift)
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
let raf = 0
let last = 0
let lastScroll = 0

function loop(now: number) {
  const t = now / 1000
  // while the page is moving, leave the art alone: the cached composite
  // follows the scroll at frame rate, and the scene resumes when it settles
  const scrolling = now - lastScroll < 160
  // the pieces are authored at 15fps; there is nothing to gain above that
  if (!scrolling && t - last >= 1 / 15) {
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

// the scene paints at 15fps, but the scroll gets a fresh composite every frame
let pending = 0
window.addEventListener(
  'scroll',
  () => {
    lastScroll = performance.now()
    if (pending || reduce.matches) return
    pending = requestAnimationFrame(() => {
      pending = 0
      compose()
    })
  },
  { passive: true },
)

resize()
// one frame synchronously, so the page is never blank while rAF is suspended
// (a background tab, or a browser that throttles it)
draw(9)
start()

// reveal the copy. Set directly rather than from rAF: a tab that is not on
// screen never runs rAF callbacks, and the content must not stay hidden.
document.documentElement.classList.add('ready')
