import * as threecushion from "./rules/threecushion"
import { SHOT_LIMITS } from "./match"
import { simulateShot } from "./simulate"
import { BallState, MatchState, Seat, Shot } from "./types"

export interface SuggestOptions {
  /** candidate shots to simulate before settling for a legal miss */
  tries?: number
  /**
   * How unsteady the hand is that plays the chosen shot: standard deviation
   * of the aiming error in radians. Power and strike point wobble in
   * proportion. 0 (the default) plays the shot exactly as found.
   */
  aimError?: number
}

/** Normally distributed number from two uniform ones. */
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** The shot as an imperfect player would deliver it. */
function unsteady(shot: Shot, aimError: number, rng: () => number): Shot {
  const [pMin, pMax] = SHOT_LIMITS.power
  // one degree of aim goes with about 6% of power and 0.035 of strike point
  const scale = aimError / (Math.PI / 180)
  const power = shot.power * (1 + gauss(rng) * 0.06 * scale)
  let x = shot.offset.x + gauss(rng) * 0.035 * scale
  let y = shot.offset.y + gauss(rng) * 0.035 * scale
  const length = Math.hypot(x, y)
  const limit = SHOT_LIMITS.offsetMax * 0.98
  if (length > limit) {
    x *= limit / length
    y *= limit / length
  }
  return {
    angle: Math.fround(shot.angle + gauss(rng) * aimError),
    power: Math.fround(Math.min(pMax, Math.max(pMin, power))),
    elevation: shot.elevation,
    offset: { x: Math.fround(x), y: Math.fround(y) },
  }
}

/** A candidate aimed near an object ball, or anywhere one time in five. */
function candidate(
  balls: BallState[],
  cueBall: number,
  targets: number[],
  rng: () => number
): Shot {
  const [pMin, pMax] = SHOT_LIMITS.power
  const c = balls[cueBall]
  let angle = (rng() * 2 - 1) * Math.PI
  if (rng() < 0.8) {
    const t = balls[targets[Math.floor(rng() * targets.length)]]
    const centre = Math.atan2(t.y - c.y, t.x - c.x)
    const dist = Math.hypot(t.x - c.x, t.y - c.y)
    // widest angle off the line of centres that still touches the ball
    const { ballRadius } = threecushion.tableInfo()
    const cone = Math.asin(Math.min(1, (2 * ballRadius) / dist))
    angle = centre + (rng() * 2 - 1) * cone * 0.95
  }
  const spin = rng() * SHOT_LIMITS.offsetMax * 0.9
  const spinAngle = rng() * 2 * Math.PI
  return {
    angle: Math.fround(angle),
    power: Math.fround(pMin + (0.3 + 0.65 * rng()) * (pMax - pMin)),
    elevation: 0,
    offset: {
      x: Math.fround(spin * Math.cos(spinAngle)),
      y: Math.fround(spin * Math.sin(spinAngle)),
    },
  }
}

/**
 * A shot for `seat` found by trial: the first of `tries` candidates that
 * scores, else the first that is not a foul; then played with `aimError`.
 * Pure given `rng`, which must return numbers in [0, 1). Meant for test
 * clients, load tests and practice opponents: `tries` is how well the
 * player reads the table, `aimError` how well they deliver the shot.
 */
export function suggestShot(
  state: MatchState,
  seat: Seat,
  rng: () => number,
  options: SuggestOptions = {}
): Shot {
  const tries = Math.max(1, options.tries ?? 150)
  const cueBall = state.cueBallOf[seat]
  const others = state.balls.map((b) => b.id).filter((id) => id !== cueBall)
  // a shot from the starting position must go to the red
  const targets = state.opening ? [threecushion.RED] : others
  let legal: Shot | undefined
  let first: Shot | undefined
  for (let n = 0; n < tries; n++) {
    const shot = candidate(state.balls, cueBall, targets, rng)
    first ??= shot
    let events
    try {
      events = simulateShot(
        state.config.ruleType,
        state.balls,
        cueBall,
        shot
      ).events
    } catch {
      continue
    }
    const foul = threecushion.foul(
      cueBall,
      events,
      state.balls,
      state.opening,
      state.frozen
    )
    if (foul) {
      continue
    }
    if (threecushion.isPoint(cueBall, events)) {
      legal = shot
      break
    }
    legal ??= shot
  }
  const chosen = legal ?? first!
  const aimError = options.aimError ?? 0
  return aimError > 0 ? unsteady(chosen, aimError, rng) : chosen
}
