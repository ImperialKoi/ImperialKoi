/** Contract shared with ascii.rest pieces: metadata plus a frame function. */

export interface Meta {
  name: string
  category: string
  note: string
  cols: number
  rows: number
  cell: number
  fps: number
  /** Page colour behind the dots. */
  ground: string
  palette: string[]
}

/**
 * One frame: `t` is seconds since load. Pass `color` to receive a palette
 * index per cell, filled in as the frame is written.
 */
export type Frame = (t: number, options?: { color?: Uint8Array }) => string
