/**
 * Public types of the headless match engine.
 * Everything here is plain JSON: no classes, no three.js types.
 */

export type Seat = 0 | 1

export type RuleType = "threecushion" | "sagu"

export interface Vec2 {
  x: number
  y: number
}

export interface BallState {
  id: number
  x: number
  y: number
}

export interface Shot {
  /** radians, direction of travel in table coordinates */
  angle: number
  /** strike point as a fraction of R from centre, |offset| <= SHOT_LIMITS.offsetMax */
  offset: Vec2
  /** cue speed in engine units, see SHOT_LIMITS.power */
  power: number
  /** cue elevation in radians, see SHOT_LIMITS.elevation */
  elevation: number
}

export interface MatchConfig {
  ruleType: RuleType
  /** points needed to win, 1..100 */
  raceTo: number
  /** handicap: a different target per seat (sagu); raceTo for both when absent */
  targets?: [number, number]
  /**
   * UMB art. 29.4: when the starting player reaches the target, the opponent
   * plays one more inning from the starting position to level the innings.
   */
  equalizingInning: boolean
  /** what happens when the equalizing inning also reaches the target */
  tieBreak: "draw" | "shootout"
  /**
   * time-outs per player for the match, 0..5. Each one extends the shot
   * clock automatically when it runs out; all of them may go on one shot.
   */
  extensions: number
  /**
   * consecutive time fouls by one seat that forfeit the match, 0 = never.
   * Not a UMB rule: it stops an absent player from stalling a table.
   */
  timeoutLimit: number
  firstSeat: Seat
  /** any string; fixes the sub-millimetre placement jitter on the spots */
  seed: string
}

/** createMatch input: `extensions` defaults to the UMB allowance for raceTo. */
export type MatchSetup = Omit<MatchConfig, "extensions"> & {
  extensions?: number
}

export type Stage = "main" | "equalizing" | "shootout"

export type EndReason = "score" | "shootout" | "draw" | "concede" | "timeout"

/** looking from the starting line towards the red ball */
export type Side = "left" | "right"

export interface MatchState {
  v: 2
  engineVersion: string
  config: MatchConfig
  phase: "playing" | "ended"
  stage: Stage
  /** all balls at rest; ids: 0 white, 1 yellow, 2 red */
  balls: BallState[]
  /** ball id each seat plays as cue ball for the whole match */
  cueBallOf: [number, number]
  turnSeat: Seat
  /** number the next action of the player in turn must carry; starts at 1 */
  shotNo: number
  /**
   * the balls are on the starting position: the shot must go directly to
   * the red ball and the player may pick the side of the cue ball
   */
  opening: boolean
  /** object balls touching the cue ball of the player in turn */
  frozen: number[]
  scores: [number, number]
  /** completed innings per seat */
  innings: [number, number]
  /** points in the current inning of turnSeat */
  run: number
  highRun: [number, number]
  extensionsLeft: [number, number]
  /** time-outs already spent on the pending shot */
  extensionsOnShot: number
  /** consecutive time fouls per seat */
  timeouts: [number, number]
  /** how many times the starting position has been set up */
  rackNo: number
  /** penalty shoot-out: completed run per seat in the current round */
  shootout: { round: number; runs: [number | null, number | null] } | null
  /** winnerSeat is null for a draw */
  result: { winnerSeat: Seat | null; reason: EndReason } | null
}

export type Action =
  | { type: "shoot"; shotNo: number; shot: Shot; side?: Side }
  | { type: "respot"; shotNo: number }
  /** the shot clock ran out: uses a time-out if one is left, else a time foul */
  | { type: "timeout" }
  | { type: "concede" }

export interface OutcomeEvent {
  type: "collision" | "cushion"
  /** milliseconds from the strike */
  t: number
  /** ball id */
  a: number
  /** second ball id, collisions only */
  b?: number
  cushion?: string
}

/**
 * redFirst: a shot from the starting position did not go directly to the red
 * ballInContact: played straight into a ball the cue ball was touching
 * cushionInContact: played straight into a cushion the cue ball was touching
 * opponentBall: the cue ball touched the opponent's cue ball (sagu)
 * noBall: the cue ball touched no ball at all (sagu)
 */
export type Foul =
  "redFirst" | "ballInContact" | "cushionInContact" | "opponentBall" | "noBall"

export interface ShotEvent {
  type: "shot"
  shotNo: number
  seat: Seat
  stage: Stage
  cueBall: number
  /** canonical (float32) shot; clients must simulate this one, not their own input */
  shot: Shot
  start: BallState[]
  final: BallState[]
  durationMs: number
  /** `penalty`: points taken off the shooter's score for the foul */
  outcome: {
    events: OutcomeEvent[]
    points: number
    foul: Foul | null
    penalty: number
  }
  scores: [number, number]
  stateHash: string
}

/** The referee placed balls on spots. */
export interface PositionEvent {
  type: "position"
  reason: "respot" | "timeout" | "equalizing" | "shootout"
  balls: BallState[]
}

export interface TurnEvent {
  type: "turn"
  seat: Seat
  shotNo: number
  stage: Stage
  opening: boolean
  frozen: number[]
}

export interface TimeoutEvent {
  type: "timeout"
  seat: Seat
  count: number
}

export interface ExtensionEvent {
  type: "extension"
  seat: Seat
  left: number
}

export interface ShootoutEvent {
  type: "shootout"
  round: number
  runs: [number | null, number | null]
}

export interface MatchEndEvent {
  type: "matchEnd"
  winnerSeat: Seat | null
  scores: [number, number]
  reason: EndReason
}

export type BilEvent =
  | ShotEvent
  | PositionEvent
  | TurnEvent
  | TimeoutEvent
  | ExtensionEvent
  | ShootoutEvent
  | MatchEndEvent

export type ErrorCode =
  | "ROUND_NOT_ACTIVE"
  | "NOT_YOUR_TURN"
  | "STALE_SHOT_NO"
  | "SHOT_OUT_OF_RANGE"
  | "ILLEGAL_ACTION"
  | "VALIDATION_FAILED"
  | "SIM_FAILED"

export type ActionResult =
  | { ok: true; state: MatchState; events: BilEvent[] }
  | { ok: false; code: ErrorCode; reason?: string }

export interface ShotLimits {
  power: [number, number]
  offsetMax: number
  elevation: [number, number]
}

export interface Frame {
  /** milliseconds from the strike */
  t: number
  /** x0, y0, x1, y1, ... in ball id order */
  p: number[]
}

export interface SimResult {
  final: BallState[]
  durationMs: number
  events: OutcomeEvent[]
  /** present when requested */
  frames?: Frame[]
  steps: number
}
