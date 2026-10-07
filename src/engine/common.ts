import { maxPower, offCenterLimit } from "../model/physics/constants"
import { hash } from "./random"
import {
  ActionResult,
  BilEvent,
  EndReason,
  ErrorCode,
  MatchState,
  Seat,
  Shot,
  ShotLimits,
} from "./types"

export const SHOT_LIMITS: ShotLimits = {
  power: [Math.fround(maxPower * 0.02), Math.fround(maxPower)],
  offsetMax: offCenterLimit,
  elevation: [0, Math.fround((2 * Math.PI) / 5)],
}

export function isInt(value: unknown, min: number, max: number): boolean {
  return (
    Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  )
}

export function fail(code: ErrorCode, reason?: string): ActionResult {
  return reason === undefined
    ? { ok: false, code }
    : { ok: false, code, reason }
}

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0
}

/** Round to float32 and range-check. Returns a reason string when invalid. */
export function canonicalShot(input: Shot): Shot | string {
  const raw = [
    input?.angle,
    input?.power,
    input?.elevation,
    input?.offset?.x,
    input?.offset?.y,
  ]
  if (!raw.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return "shot fields must be finite numbers"
  }
  const shot: Shot = {
    angle: Math.fround(input.angle),
    power: Math.fround(input.power),
    elevation: Math.fround(input.elevation),
    offset: { x: Math.fround(input.offset.x), y: Math.fround(input.offset.y) },
  }
  if (Math.abs(shot.angle) > 2 * Math.PI) {
    return "angle"
  }
  if (shot.power < SHOT_LIMITS.power[0] || shot.power > SHOT_LIMITS.power[1]) {
    return "power"
  }
  if (
    shot.elevation < SHOT_LIMITS.elevation[0] ||
    shot.elevation > SHOT_LIMITS.elevation[1]
  ) {
    return "elevation"
  }
  // small allowance: the limit is applied in float64 by the aiming UI
  if (Math.hypot(shot.offset.x, shot.offset.y) > SHOT_LIMITS.offsetMax + 1e-6) {
    return "offset"
  }
  return shot
}

export function stateHash(state: MatchState): string {
  return hash(
    JSON.stringify([
      state.balls.map((b) => [b.id, b.x, b.y, b.pocketed ? 1 : 0]),
      state.scores,
      state.turnSeat,
      state.shotNo,
      state.phase,
      state.stage,
      state.shootout,
      state.pool ?? null,
    ])
  )
}

export function end(
  state: MatchState,
  winnerSeat: Seat | null,
  reason: EndReason,
  events: BilEvent[]
) {
  state.phase = "ended"
  state.frozen = []
  state.opening = false
  state.result = { winnerSeat, reason }
  events.push({
    type: "matchEnd",
    winnerSeat,
    scores: [state.scores[0], state.scores[1]],
    reason,
  })
}

/**
 * The shot clock ran out: spend a time-out if one is left. Returns true
 * when the clock was extended (and the event was pushed).
 */
export function extendClock(
  state: MatchState,
  seat: Seat,
  events: BilEvent[]
): boolean {
  if (state.extensionsLeft[seat] > 0) {
    state.extensionsLeft[seat]--
    state.extensionsOnShot++
    events.push({ type: "extension", seat, left: state.extensionsLeft[seat] })
    return true
  }
  return false
}

/** Record a time foul; true when it forfeits the match. */
export function timeFoul(
  state: MatchState,
  seat: Seat,
  events: BilEvent[]
): boolean {
  state.extensionsOnShot = 0
  state.timeouts[seat]++
  state.shotNo++
  events.push({ type: "timeout", seat, count: state.timeouts[seat] })
  const limit = state.config.timeoutLimit
  if (limit > 0 && state.timeouts[seat] >= limit) {
    state.innings[seat]++
    end(state, other(seat), "timeout", events)
    return true
  }
  return false
}
