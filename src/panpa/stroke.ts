import { g, muS, tipReach } from "../model/physics/constants"
import { strikeSpeed } from "../model/physics/physics"

/**
 * How the cue ball meets the first thing in its path:
 * - normal: wherever the player put the tip on the pad
 * - follow (sürme): rolling, so it keeps its follow after the collision
 * - stop: sliding with no follow or draw left, so it parts at a right
 *   angle to the object ball and dies on a full hit
 *
 * The tip only touches the ball for a moment; what a follow-through or a
 * held stroke changes is how much the ball is turning when it arrives. That
 * is set here by moving the strike point up or down, so the shot that goes
 * to the server is an ordinary one and the engine needs nothing new. The pad
 * keeps showing the player's own point: the stroke is how they play, not
 * where they hit.
 */
export type Stroke = "normal" | "follow" | "stop"

export const STROKES: Stroke[] = ["normal", "follow", "stop"]

/** a tip 2R/5 above centre sets the ball rolling straight away */
const ROLL = 0.4

/** the pad's height for a real strike height */
const toPad = (real: number) => real / tipReach

/**
 * The vertical strike point (fraction of R, +y up) for `stroke`, or null for
 * a normal stroke. `distance` is how far the cue ball centre travels to its
 * first contact, `power` the cue speed and `x` the side the player chose;
 * the result stays inside `offsetMax` together with that side.
 */
export function strokeOffsetY(
  stroke: Stroke,
  distance: number,
  power: number,
  x: number,
  offsetMax: number
): number | null {
  if (stroke === "normal") {
    return null
  }
  const room = Math.sqrt(Math.max(0, offsetMax * offsetMax - x * x))
  if (stroke === "follow") {
    return Math.min(toPad(ROLL), room)
  }
  // stop: draw that friction has just worn away at the contact. While the
  // ball slides, v falls by a·t and backspin ω by 5a·t/2R, and the strike
  // gives ω0 = 5·v0·b / 2R for a real height b, so ω reaches 0 after t when
  // b = -a·t / v0.
  const a = muS * g
  let y = 0
  for (let i = 0; i < 4; i++) {
    const v0 = strikeSpeed(power, x, y)
    if (v0 <= 0) {
      return 0
    }
    const disc = v0 * v0 - 2 * a * distance
    // too far to arrive sliding: the most draw it can take
    const t = disc <= 0 ? v0 / a : (v0 - Math.sqrt(disc)) / a
    y = Math.max(toPad((-a * t) / v0), -room)
  }
  return y
}

/**
 * The strike height actually played: the pad's `padY` shaped by the stroke.
 * A follow rolls the ball at least, keeping any extra follow and leaving a
 * draw shot alone (draw is played with a follow-through); a stop takes the
 * follow away, keeping a draw deeper than the stop itself.
 */
export function strokeY(
  stroke: Stroke,
  padY: number,
  distance: number,
  power: number,
  x: number,
  offsetMax: number
): number {
  const target = strokeOffsetY(stroke, distance, power, x, offsetMax)
  if (target === null) {
    return padY
  }
  if (stroke === "follow") {
    return padY < 0 ? padY : Math.max(padY, target)
  }
  return Math.min(padY, target)
}

/**
 * Distance from `from` along the unit direction `dir` until a ball centre
 * meets the cushion line `halfLength` × `halfWidth`.
 */
export function cushionDistance(
  from: { x: number; y: number },
  dir: { x: number; y: number },
  halfLength: number,
  halfWidth: number
): number {
  const along = (p: number, d: number, half: number) => {
    if (d > 1e-9) {
      return (half - p) / d
    }
    if (d < -1e-9) {
      return (-half - p) / d
    }
    return Infinity
  }
  const t = Math.min(
    along(from.x, dir.x, halfLength),
    along(from.y, dir.y, halfWidth)
  )
  return Math.max(0, t)
}
