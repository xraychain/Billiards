import { Vec2 } from "../engine/types"
import { Rect } from "./protocol"

export interface PreviewScene {
  /** page pixels: cue ball, ghost ball at first contact, object ball */
  cue: Vec2
  ghost: Vec2
  object: Vec2
  /** unit vector of the aim in page space (y down) */
  dir: Vec2
  /** ball radius in page pixels */
  radius: number
  /** side of the square preview in page pixels */
  size: number
  /** where the table is on the page */
  area: Rect
}

/** Keep a box of side `size` centred on `c` inside `area`. */
function clamp(c: Vec2, size: number, area: Rect): Vec2 {
  const h = size / 2 + 4
  return {
    x: Math.min(area.x + area.w - h, Math.max(area.x + h, c.x)),
    y: Math.min(area.y + area.h - h, Math.max(area.y + h, c.y)),
  }
}

function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/** Does the box around `c` (grown by `pad`) contain `p`? */
function covers(c: Vec2, size: number, pad: number, p: Vec2): boolean {
  const h = size / 2 + pad
  return Math.abs(p.x - c.x) <= h && Math.abs(p.y - c.y) <= h
}

/** Does the box cover any point of the segment from `a` to `b`? */
function coversSegment(c: Vec2, size: number, pad: number, a: Vec2, b: Vec2) {
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (covers(c, size, pad, p)) return true
  }
  return false
}

/**
 * Where the cut preview goes: a little past the object ball along the line
 * of aim, so it never sits on the shot. If that spot is pushed back onto the
 * balls or the line of aim by the edge of the table, the diagonals and then
 * the sides of the object ball are tried. Returns the centre in page pixels.
 */
export function previewSpot(scene: PreviewScene): Vec2 {
  const { cue, ghost, object, dir, radius, size, area } = scene
  const reach = radius + size * 0.75 + 6
  const tries = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]
  let first: Vec2 | null = null
  for (const a of tries) {
    const d = rotate(dir, a)
    const c = clamp(
      { x: object.x + d.x * reach, y: object.y + d.y * reach },
      size,
      area
    )
    first ??= c
    const blocked =
      covers(c, size, radius, object) ||
      covers(c, size, radius, cue) ||
      coversSegment(c, size, radius * 0.5, cue, ghost)
    if (!blocked) {
      return c
    }
  }
  return first!
}
