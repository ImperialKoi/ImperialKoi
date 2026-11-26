#!/usr/bin/env node
/**
 * Renders the profile banner with the ascii-sharks ocean.
 *
 *   npm run banner
 *
 * Pipeline
 *   1. esbuild bundles ascii-animated-sharks/ascii-sharks/src — the real
 *      engine (boids, hunting sharks, 9 species, glyph rendering).
 *   2. @napi-rs/canvas stands in for the browser canvas, so the same
 *      World + AsciiRenderer that draws /light draws these frames.
 *   3. Each frame: the engine's own paper stage -> the demo's clear "pool"
 *      ellipse -> the profile text -> GIF via gifenc.
 *
 * Output: assets/ocean-light.gif, assets/ocean-dark.gif and a .png poster of
 * each, so the README has a still fallback.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ENGINE = resolve(ROOT, 'ascii-animated-sharks/ascii-sharks/src/index.ts')

/* ───────────────────────────── content ───────────────────────────── */

const PROFILE = {
  name: 'IMPERIALKOI',
  tagline: 'builds tools that stay out of the way',
  meta: 'YOUR ROLE  ·  YOUR LOCATION',
  stack: 'TypeScript · Python · React · Node · Postgres · Docker',
  prompt: '~ whoami',
}

/** The cast, biggest first. Any of the engine's species work here. */
const SHARKS = [
  { kind: 'whale', size: 1.15 },
  { kind: 'greathammer', size: 1.0 },
  { kind: 'thresher', size: 0.9 },
  { kind: 'hammerhead', size: 0.85 },
]

/* ───────────────────────────── config ────────────────────────────── */

const W = 900
const H = 560
/** Render at 2x and downsample: finer grid, antialiased glyphs, like /light at full size. */
const SS = 3
const FPS = 10
const FRAMES = 30 // 3 s loop
const WARMUP = 300 // sim steps before the first frame
const SEED = 20261126

const SCHEMES = {
  light: {
    theme: 'light',
    ink: '#232323', // the engine's INK
    muted: '#6f6b66',
    hair: 'rgba(35,35,35,0.22)',
    pool: 'rgba(247,246,243',
  },
  dark: {
    theme: 'dark',
    ink: '#e8eef7',
    muted: '#8d9bb0',
    hair: 'rgba(232,238,247,0.22)',
    pool: 'rgba(0,0,0',
  },
}

/* ───────────────────────── deterministic world ───────────────────── */

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
Math.random = mulberry32(SEED)

/* ─────────────────────────── engine bundle ───────────────────────── */

const { build } = await import('esbuild')
const cacheDir = resolve(ROOT, '.cache')
mkdirSync(cacheDir, { recursive: true })
const bundlePath = resolve(cacheDir, 'ascii-sharks.mjs')

await build({
  stdin: {
    contents: `export { World } from './world'\nexport { AsciiRenderer } from './renderer'\n`,
    resolveDir: dirname(ENGINE),
    loader: 'ts',
    sourcefile: 'banner-entry.ts',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
})

const canvasLib = await import('@napi-rs/canvas')
const { createCanvas } = canvasLib

// The renderer keeps its dot layer on a second, offscreen canvas.
globalThis.document = { createElement: () => createCanvas(1, 1) }

const { World, AsciiRenderer } = await import(bundlePath)
const gifenc = (await import('gifenc')).default ?? (await import('gifenc'))
const { GIFEncoder, quantize, applyPalette } = gifenc

/* ───────────────────────────── drawing ───────────────────────────── */

function drawOverlay(ctx, scheme) {
  const cx = W / 2
  const cy = 258

  // The demo's "pool": a calm ellipse in the middle so a headline reads over
  // the water, as on /light. Held flat long enough to cover the whole block.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, 0.45)
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 330)
  pool.addColorStop(0, `${scheme.pool},0.9)`)
  pool.addColorStop(0.55, `${scheme.pool},0.85)`)
  pool.addColorStop(1, `${scheme.pool},0)`)
  ctx.fillStyle = pool
  ctx.fillRect(-W, -H * 2, W * 2, H * 4)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // prompt
  ctx.fillStyle = scheme.muted
  ctx.font = '600 12px Menlo, monospace'
  ctx.fillText(PROFILE.prompt, cx, 156)

  // name
  ctx.fillStyle = scheme.ink
  ctx.font = '600 50px Menlo, monospace'
  ctx.fillText(PROFILE.name, cx, 222)

  // hairline
  ctx.strokeStyle = scheme.hair
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - 190, 256)
  ctx.lineTo(cx + 190, 256)
  ctx.stroke()

  // tagline
  ctx.fillStyle = scheme.ink
  ctx.font = '400 19px Menlo, monospace'
  ctx.fillText(PROFILE.tagline, cx, 292)

  // meta + stack
  ctx.fillStyle = scheme.muted
  ctx.font = '400 13px Menlo, monospace'
  ctx.fillText(PROFILE.meta, cx, 332)
  ctx.fillText(PROFILE.stack, cx, 356)

  // corner ticks
  const pad = 20
  const tick = 9
  ctx.strokeStyle = scheme.hair
  ctx.beginPath()
  for (const [x, y, dx, dy] of [
    [pad, pad, 1, 1],
    [W - pad, pad, -1, 1],
    [pad, H - pad, 1, -1],
    [W - pad, H - pad, -1, -1],
  ]) {
    ctx.moveTo(x, y + dy * tick)
    ctx.lineTo(x, y)
    ctx.lineTo(x + dx * tick, y)
  }
  ctx.stroke()
}

async function renderScheme(key, scheme) {
  const canvas = createCanvas(W * SS, H * SS)
  const ctx = canvas.getContext('2d')

  const renderer = new AsciiRenderer(canvas)
  renderer.setFontFamily('Menlo, monospace')
  renderer.setTheme(scheme.theme)
  renderer.resize(W * SS, H * SS, 1)

  const world = new World(SHARKS, undefined, true, true) // clear centre, stay in frame
  world.resize(W * SS, H * SS, renderer.cellWidth, renderer.cellHeight)
  for (let i = 0; i < WARMUP; i++) world.step(1 / 60)

  const out = createCanvas(W, H)
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'

  const frames = []
  for (let f = 0; f < FRAMES; f++) {
    for (let s = 0; s < 5; s++) world.step(1 / 60)
    renderer.render(world, 1 / FPS)

    octx.drawImage(canvas, 0, 0, W, H)
    drawOverlay(octx, scheme)

    const { data } = octx.getImageData(0, 0, W, H)
    frames.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  }

  const sample = Buffer.concat(frames.filter((_, i) => i % 9 === 0))
  const palette = quantize(new Uint8Array(sample), 64, { format: 'rgb444' })

  const gif = GIFEncoder()
  frames.forEach((rgba, i) => {
    const index = applyPalette(new Uint8Array(rgba), palette, 'rgb444')
    gif.writeFrame(index, W, H, {
      palette,
      delay: Math.round(1000 / FPS),
      ...(i === 0 ? { repeat: 0 } : {}),
    })
  })
  gif.finish()

  mkdirSync(resolve(ROOT, 'assets'), { recursive: true })
  writeFileSync(resolve(ROOT, `assets/ocean-${key}.gif`), gif.bytes())

  const poster = createCanvas(W, H)
  poster
    .getContext('2d')
    .putImageData(new canvasLib.ImageData(new Uint8ClampedArray(frames[0]), W, H), 0, 0)
  writeFileSync(resolve(ROOT, `assets/ocean-${key}.png`), poster.toBuffer('image/png'))

  const kb = (n) => (n / 1024).toFixed(0) + ' KB'
  console.log(
    `${key}: ${frames.length} frames · cell ${renderer.cellWidth}px · gif ${kb(
      gif.bytes().length,
    )} · png ${kb(poster.toBuffer('image/png').length)}`,
  )
}

for (const [key, scheme] of Object.entries(SCHEMES)) {
  await renderScheme(key, scheme)
}
