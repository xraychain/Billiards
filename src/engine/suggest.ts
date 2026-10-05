import * as threecushion from "./rules/threecushion"
import { SHOT_LIMITS } from "./match"
import { simulateShot } from "./simulate"
import { BallState, MatchState, Seat, Shot } from "./types"

export interface SuggestOptions {
  /** candidate shots to simulate before settling for a legal miss */
  tries?: number
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
 * scores, else the first that is not a foul. Pure given `rng`, which must
 * return numbers in [0, 1). Meant for test clients, load tests and practice
 * opponents; strength grows with `tries`.
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
      return shot
    }
    legal ??= shot
  }
  return legal ?? first!
}
