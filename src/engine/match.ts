import { maxPower, offCenterLimit } from "../model/physics/constants"
import { hash } from "./random"
import * as threecushion from "./rules/threecushion"
import { simulateShot } from "./simulate"
import {
  Action,
  ActionResult,
  BilEvent,
  EndReason,
  ErrorCode,
  MatchSetup,
  MatchState,
  PositionEvent,
  RuleType,
  Seat,
  Shot,
  ShotEvent,
  ShotLimits,
  Side,
  SimResult,
} from "./types"

export const ENGINE_VERSION = "0.5.0"

export const RULE_TYPES: readonly RuleType[] = ["threecushion"]

export const SHOT_LIMITS: ShotLimits = {
  power: [Math.fround(maxPower * 0.02), Math.fround(maxPower)],
  offsetMax: offCenterLimit,
  elevation: [0, Math.fround((2 * Math.PI) / 5)],
}

function isInt(value: unknown, min: number, max: number): boolean {
  return (
    Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  )
}

/**
 * Time-outs per player by match length, as applied at UMB World Cups:
 * one below 30 points, two from 30, three from 40.
 */
export function extensionsFor(raceTo: number): number {
  if (raceTo >= 40) return 3
  return raceTo >= 30 ? 2 : 1
}

function checkConfig(config: MatchSetup) {
  if (!RULE_TYPES.includes(config.ruleType)) {
    throw new Error(`unknown ruleType: ${config.ruleType}`)
  }
  if (!isInt(config.raceTo, 1, 100)) {
    throw new Error("raceTo must be an integer from 1 to 100")
  }
  if (typeof config.equalizingInning !== "boolean") {
    throw new Error("equalizingInning must be a boolean")
  }
  if (config.tieBreak !== "draw" && config.tieBreak !== "shootout") {
    throw new Error("tieBreak must be draw or shootout")
  }
  if (config.extensions !== undefined && !isInt(config.extensions, 0, 5)) {
    throw new Error("extensions must be an integer from 0 to 5")
  }
  if (!isInt(config.timeoutLimit, 0, 10)) {
    throw new Error("timeoutLimit must be an integer from 0 to 10")
  }
  if (config.firstSeat !== 0 && config.firstSeat !== 1) {
    throw new Error("firstSeat must be 0 or 1")
  }
  if (typeof config.seed !== "string" || config.seed.length === 0) {
    throw new Error("seed must be a non-empty string")
  }
}

export function createMatch(config: MatchSetup): MatchState {
  checkConfig(config)
  const first = config.firstSeat
  const extensions = config.extensions ?? extensionsFor(config.raceTo)
  // art. 23.2: whoever starts plays the white ball, for the whole match
  const cueBallOf: [number, number] = first === 0 ? [0, 1] : [1, 0]
  return {
    v: 2,
    engineVersion: ENGINE_VERSION,
    config: {
      ruleType: config.ruleType,
      raceTo: config.raceTo,
      equalizingInning: config.equalizingInning,
      tieBreak: config.tieBreak,
      extensions,
      timeoutLimit: config.timeoutLimit,
      firstSeat: first,
      seed: config.seed,
    },
    phase: "playing",
    stage: "main",
    balls: threecushion.startingPosition(config.seed, 0, cueBallOf[first]),
    cueBallOf,
    turnSeat: first,
    shotNo: 1,
    opening: true,
    frozen: [],
    scores: [0, 0],
    innings: [0, 0],
    run: 0,
    highRun: [0, 0],
    extensionsLeft: [extensions, extensions],
    extensionsOnShot: 0,
    timeouts: [0, 0],
    rackNo: 1,
    shootout: null,
    result: null,
  }
}

function fail(code: ErrorCode, reason?: string): ActionResult {
  return reason === undefined
    ? { ok: false, code }
    : { ok: false, code, reason }
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0
}

/** Round to float32 and range-check. Returns a reason string when invalid. */
function canonicalShot(input: Shot): Shot | string {
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
      state.balls.map((b) => [b.id, b.x, b.y]),
      state.scores,
      state.turnSeat,
      state.shotNo,
      state.phase,
      state.stage,
      state.shootout,
    ])
  )
}

function end(
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

/** Hand the table to `seat`, either as the balls lie or on the starting position. */
function giveTurn(
  state: MatchState,
  seat: Seat,
  events: BilEvent[],
  position?: PositionEvent["reason"]
) {
  state.turnSeat = seat
  state.run = 0
  if (position) {
    state.balls = threecushion.startingPosition(
      state.config.seed,
      state.rackNo++,
      state.cueBallOf[seat]
    )
    events.push({ type: "position", reason: position, balls: state.balls })
  }
  state.opening = position !== undefined
  announceTurn(state, events)
}

function announceTurn(state: MatchState, events: BilEvent[]) {
  const seat = state.turnSeat
  state.frozen = state.opening
    ? []
    : threecushion.frozenTo(state.balls, state.cueBallOf[seat])
  events.push({
    type: "turn",
    seat,
    shotNo: state.shotNo,
    stage: state.stage,
    opening: state.opening,
    frozen: state.frozen,
  })
}

/** A point in the main stage. Returns true when it finished the stage. */
function reachedTarget(state: MatchState, seat: Seat, events: BilEvent[]) {
  if (state.scores[seat] < state.config.raceTo) {
    return false
  }
  state.innings[seat]++
  const first = state.config.firstSeat
  if (state.config.equalizingInning && seat === first) {
    // art. 29.4: the starter has played one inning more; the opponent
    // levels the innings from the starting position
    state.stage = "equalizing"
    giveTurn(state, other(seat), events, "equalizing")
  } else {
    end(state, seat, "score", events)
  }
  return true
}

function startShootoutRound(
  state: MatchState,
  round: number,
  events: BilEvent[]
) {
  state.stage = "shootout"
  state.shootout = { round, runs: [null, null] }
  events.push({ type: "shootout", round, runs: [null, null] })
  giveTurn(state, state.config.firstSeat, events, "shootout")
}

/** The equalizing inning also reached the target. */
function levelled(state: MatchState, events: BilEvent[]) {
  state.innings[state.turnSeat]++
  if (state.config.tieBreak === "draw") {
    end(state, null, "draw", events)
  } else {
    startShootoutRound(state, 1, events)
  }
}

/** A penalty run ended: next shooter, a result, or another round. */
function shootoutRunOver(state: MatchState, seat: Seat, events: BilEvent[]) {
  const shootout = state.shootout!
  shootout.runs[seat] = state.run
  const first = state.config.firstSeat
  const second = other(first)
  events.push({
    type: "shootout",
    round: shootout.round,
    runs: [shootout.runs[0], shootout.runs[1]],
  })
  if (seat === first) {
    giveTurn(state, second, events, "shootout")
    return
  }
  const a = shootout.runs[first]!
  const b = shootout.runs[second]!
  if (a === b) {
    startShootoutRound(state, shootout.round + 1, events)
  } else {
    end(state, a > b ? first : second, "shootout", events)
  }
}

/**
 * The inning of `seat` is over without a point. `timeFoul` puts the balls on
 * the starting position for the opponent (time regulation, "the balls will
 * be put up for the opponent").
 */
function inningOver(
  state: MatchState,
  seat: Seat,
  events: BilEvent[],
  timeFoul: boolean
) {
  if (state.stage === "equalizing") {
    state.innings[seat]++
    end(state, state.config.firstSeat, "score", events)
  } else if (state.stage === "shootout") {
    shootoutRunOver(state, seat, events)
  } else {
    state.innings[seat]++
    giveTurn(state, other(seat), events, timeFoul ? "timeout" : undefined)
  }
}

function scored(state: MatchState, seat: Seat, events: BilEvent[]) {
  state.run++
  if (state.stage === "shootout") {
    // penalty points count for neither the score nor the high run
    state.opening = false
    announceTurn(state, events)
    return
  }
  state.scores[seat]++
  state.highRun[seat] = Math.max(state.highRun[seat], state.run)
  if (state.stage === "main" && reachedTarget(state, seat, events)) {
    return
  }
  if (
    state.stage === "equalizing" &&
    state.scores[seat] >= state.config.raceTo
  ) {
    levelled(state, events)
    return
  }
  state.opening = false
  announceTurn(state, events)
}

function shoot(
  state: MatchState,
  seat: Seat,
  input: Shot,
  side: Side | undefined
): ActionResult {
  const shot = canonicalShot(input)
  if (typeof shot === "string") {
    return fail("SHOT_OUT_OF_RANGE", shot)
  }
  const cueBall = state.cueBallOf[seat]
  if (side !== undefined) {
    if (side !== "left" && side !== "right") {
      return fail("VALIDATION_FAILED", "side")
    }
    if (!state.opening) {
      return fail("ILLEGAL_ACTION", "side")
    }
    state.balls = threecushion.chooseSide(state.balls, cueBall, side)
  }
  const start = state.balls
  let sim: SimResult
  try {
    sim = simulateShot(state.config.ruleType, start, cueBall, shot)
  } catch (e) {
    return fail("SIM_FAILED", e instanceof Error ? e.message : String(e))
  }

  const foul = threecushion.foul(
    cueBall,
    sim.events,
    start,
    state.opening,
    state.frozen
  )
  const points = !foul && threecushion.isPoint(cueBall, sim.events) ? 1 : 0
  const shotEvent: ShotEvent = {
    type: "shot",
    shotNo: state.shotNo,
    seat,
    stage: state.stage,
    cueBall,
    shot,
    start,
    final: sim.final,
    durationMs: sim.durationMs,
    outcome: { events: sim.events, points, foul },
    scores: [0, 0],
    stateHash: "",
  }
  const events: BilEvent[] = [shotEvent]
  state.balls = sim.final
  state.timeouts[seat] = 0
  state.extensionsOnShot = 0
  state.shotNo++
  if (points > 0) {
    scored(state, seat, events)
  } else {
    inningOver(state, seat, events, false)
  }
  shotEvent.scores = [state.scores[0], state.scores[1]]
  shotEvent.stateHash = stateHash(state)
  return { ok: true, state, events }
}

function respot(state: MatchState, seat: Seat): ActionResult {
  if (state.frozen.length === 0) {
    return fail("ILLEGAL_ACTION", "respot")
  }
  const events: BilEvent[] = []
  state.balls = threecushion.respot(
    state.balls,
    state.cueBallOf[seat],
    state.frozen
  )
  state.shotNo++
  events.push({ type: "position", reason: "respot", balls: state.balls })
  announceTurn(state, events)
  return { ok: true, state, events }
}

/**
 * The shot clock ran out. A remaining time-out extends it without the
 * player asking, as many times as there are time-outs left; then it is a
 * time foul and the balls are put up for the opponent.
 */
function timeout(state: MatchState, seat: Seat): ActionResult {
  const events: BilEvent[] = []
  if (state.extensionsLeft[seat] > 0) {
    state.extensionsLeft[seat]--
    state.extensionsOnShot++
    events.push({ type: "extension", seat, left: state.extensionsLeft[seat] })
    return { ok: true, state, events }
  }
  state.extensionsOnShot = 0
  state.timeouts[seat]++
  state.shotNo++
  events.push({ type: "timeout", seat, count: state.timeouts[seat] })
  const limit = state.config.timeoutLimit
  if (limit > 0 && state.timeouts[seat] >= limit) {
    state.innings[seat]++
    end(state, other(seat), "timeout", events)
  } else {
    inningOver(state, seat, events, true)
  }
  return { ok: true, state, events }
}

/**
 * Apply one action. Pure: the given state is not modified; the returned
 * state is a new object. `seat` is who the server authenticated, never a
 * value taken from the client.
 */
export function applyAction(
  current: MatchState,
  seat: Seat,
  action: Action
): ActionResult {
  if (seat !== 0 && seat !== 1) {
    return fail("VALIDATION_FAILED", "seat")
  }
  if (current.phase !== "playing") {
    return fail("ROUND_NOT_ACTIVE")
  }
  const state: MatchState = JSON.parse(JSON.stringify(current))
  if (action?.type === "concede") {
    const events: BilEvent[] = []
    end(state, other(seat), "concede", events)
    return { ok: true, state, events }
  }
  if (!["shoot", "respot", "timeout"].includes(action?.type)) {
    return fail("VALIDATION_FAILED", "action")
  }
  if (seat !== state.turnSeat) {
    return fail("NOT_YOUR_TURN")
  }
  switch (action.type) {
    case "timeout":
      return timeout(state, seat)
    case "respot":
      return action.shotNo === state.shotNo
        ? respot(state, seat)
        : fail("STALE_SHOT_NO")
    default:
      return action.shotNo === state.shotNo
        ? shoot(state, seat, action.shot, action.side)
        : fail("STALE_SHOT_NO")
  }
}
