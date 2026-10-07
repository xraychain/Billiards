import { R } from "../../model/physics/constants"
import { TableGeometry } from "../../view/tablegeometry"
import {
  canonicalShot,
  end,
  extendClock,
  fail,
  other,
  stateHash,
  timeFoul,
} from "../common"
import { configure } from "../configure"
import { seededRandom } from "../random"
import { simulateShot } from "../simulate"
import {
  Action,
  ActionResult,
  BallState,
  BilEvent,
  Foul,
  Group,
  MatchSetup,
  MatchState,
  OutcomeEvent,
  PendingChoice,
  PoolState,
  RuleType,
  Seat,
  Shot,
  ShotEvent,
  SimResult,
  Vec2,
} from "../types"

export const CUE = 0
export const EIGHT = 8
export const NINE = 9

export function isPool(ruleType: RuleType): boolean {
  return ruleType === "nineball" || ruleType === "eightball"
}

// ---------------------------------------------------------------- table

/** Foot spot, head spot and the head string, after `configure`. */
function spots() {
  const X = TableGeometry.X
  return { foot: X / 2, head: -X / 2, headString: -X / 2 }
}

function onCloth(p: Vec2): boolean {
  return (
    Math.abs(p.x) <= TableGeometry.tableX &&
    Math.abs(p.y) <= TableGeometry.tableY
  )
}

function clear(balls: BallState[], p: Vec2, except: number, gap = 0): boolean {
  return balls.every(
    (b) =>
      b.id === except ||
      b.pocketed ||
      Math.hypot(b.x - p.x, b.y - p.y) >= 2 * R + gap
  )
}

/**
 * Spot a ball (WPA 1.5): on the long string as close as possible to the
 * foot spot and between it and the foot rail, in contact with whatever
 * blocks it (but a little clear of the cue ball); if that whole stretch is
 * blocked, above the foot spot as close as possible.
 */
export function spotBall(balls: BallState[], id: number): BallState[] {
  const { foot } = spots()
  const step = R / 16
  const free = (x: number) =>
    onCloth({ x, y: 0 }) &&
    balls.every((b) => {
      if (b.id === id || b.pocketed) return true
      const gap = b.id === CUE ? R * 0.05 : 0
      return Math.hypot(b.x - x, b.y) >= 2 * R + gap
    })
  let x = foot
  while (!free(x) && x <= TableGeometry.tableX) x += step
  if (x > TableGeometry.tableX) {
    x = foot
    while (!free(x) && x >= -TableGeometry.tableX) x -= step
  }
  return balls.map((b) => (b.id === id ? { id, x: Math.fround(x), y: 0 } : b))
}

// ---------------------------------------------------------------- racks

/** Rows of a tight rack starting at the apex and growing along +x. */
function rackPositions(counts: number[], apexX: number, rng: () => number) {
  // the same breathing space a hand-racked set has in the reference game;
  // a perfectly tight rack overloads the collision resolver on the break
  const gap = 2 * R * 1.023
  const dx = (gap * Math.sqrt(3)) / 2
  const out: Vec2[] = []
  counts.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * gap
      // well under a millimetre, as a hand-racked set never sits perfectly
      out.push({
        x: apexX + row * dx + (rng() - 0.5) * R * 0.01,
        y: y + (rng() - 0.5) * R * 0.01,
      })
    }
  })
  return out
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 9-ball (WPA 5.2): diamond, 1 at the apex towards the head, 9 in the middle on the foot spot. */
function nineBallRack(rng: () => number): BallState[] {
  const { foot } = spots()
  const dx = (2 * R * 1.023 * Math.sqrt(3)) / 2
  const pos = rackPositions([1, 2, 3, 2, 1], foot - 2 * dx, rng)
  const order = [1, ...shuffled([2, 3, 4, 5, 6, 7, 8], rng)]
  // slot 4 is the middle of the middle row
  const ids = [...order.slice(0, 4), NINE, ...order.slice(4)]
  return ids.map((id, i) => ({
    id,
    x: Math.fround(pos[i].x),
    y: Math.fround(pos[i].y),
  }))
}

/** 8-ball (WPA 4.2): triangle, apex on the foot spot, 8 below the apex, a ball of each group on the back corners. */
function eightBallRack(rng: () => number): BallState[] {
  const { foot } = spots()
  const pos = rackPositions([1, 2, 3, 4, 5], foot, rng)
  const solids = shuffled([2, 3, 4, 5, 6, 7], rng)
  const stripes = shuffled([9, 10, 11, 12, 13, 14, 15], rng)
  const cornerSolid = solids.pop()!
  const cornerStripe = stripes.pop()!
  const rest = shuffled([...solids, ...stripes], rng)
  // 15 slots: apex, row 2 (2), row 3 (3, middle = 8), row 4 (4), row 5 (5)
  const ids: number[] = [1, rest[0], rest[1], rest[2], EIGHT, rest[3]]
  ids.push(rest[4], rest[5], rest[6], rest[7])
  ids.push(cornerSolid, rest[8], rest[9], rest[10], cornerStripe)
  return ids.map((id, i) => ({
    id,
    x: Math.fround(pos[i].x),
    y: Math.fround(pos[i].y),
  }))
}

function rackFor(
  ruleType: RuleType,
  seed: string,
  rackNo: number
): BallState[] {
  configure(ruleType)
  const rng = seededRandom(`${seed}#rack${rackNo}`)
  const { head } = spots()
  const objects =
    ruleType === "nineball" ? nineBallRack(rng) : eightBallRack(rng)
  // balls are kept in id order: index and id agree everywhere
  objects.sort((a, b) => a.id - b.id)
  return [{ id: CUE, x: Math.fround(head), y: 0 }, ...objects]
}

function freshPool(breaker: Seat): PoolState {
  return {
    breaker,
    breakShot: true,
    ballInHand: "kitchen",
    pushOutAvailable: false,
    fouls: [0, 0],
    pendingChoice: null,
    open: true,
    groups: [null, null],
    call: null,
  }
}

export function newRack(config: MatchSetup, extensions: number): MatchState {
  const first = config.firstSeat
  return {
    v: 2,
    engineVersion: "",
    config: {
      ruleType: config.ruleType,
      raceTo: config.raceTo,
      equalizingInning: false,
      tieBreak: "draw",
      extensions,
      timeoutLimit: config.timeoutLimit,
      firstSeat: first,
      seed: config.seed,
    },
    phase: "playing",
    stage: "main",
    balls: rackFor(config.ruleType, config.seed, 0),
    cueBallOf: [CUE, CUE],
    turnSeat: first,
    shotNo: 1,
    opening: false,
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
    pool: freshPool(first),
  }
}

// ---------------------------------------------------------------- reading a shot

interface Reading {
  firstHit: number | null
  firstHitAt: number
  /** balls driven to a rail after the first contact, cue ball included */
  railsAfterContact: number
  /** object balls driven to a rail at any time (break requirement) */
  objectBallsToRail: number
  pocketed: number[]
  pots: OutcomeEvent[]
  scratch: boolean
}

function read(events: OutcomeEvent[]): Reading {
  const r: Reading = {
    firstHit: null,
    firstHitAt: Infinity,
    railsAfterContact: 0,
    objectBallsToRail: 0,
    pocketed: [],
    pots: [],
    scratch: false,
  }
  const railed = new Set<number>()
  const railedAfter = new Set<number>()
  const toRail = (id: number, t: number) => {
    railed.add(id)
    if (t > r.firstHitAt) railedAfter.add(id)
  }
  for (const e of events) {
    if (e.type === "collision") {
      if (r.firstHit === null && (e.a === CUE || e.b === CUE)) {
        r.firstHit = e.a === CUE ? e.b! : e.a
        r.firstHitAt = e.t
      }
    } else if (e.type === "cushion") {
      toRail(e.a, e.t)
    } else {
      r.pocketed.push(e.a)
      r.pots.push(e)
      // a pocketed ball counts as driven to a rail (WPA 2.7)
      toRail(e.a, e.t)
    }
  }
  railed.delete(CUE)
  r.railsAfterContact = railedAfter.size
  r.objectBallsToRail = railed.size
  r.scratch = r.pocketed.includes(CUE)
  return r
}

function onTable(state: MatchState): number[] {
  return state.balls.filter((b) => !b.pocketed && b.id !== CUE).map((b) => b.id)
}

function lowest(state: MatchState): number {
  return Math.min(...onTable(state))
}

function groupOf(id: number): Group {
  return id <= 7 ? "solids" : "stripes"
}

function groupBalls(group: Group): number[] {
  return group === "solids"
    ? [1, 2, 3, 4, 5, 6, 7]
    : [9, 10, 11, 12, 13, 14, 15]
}

/** 8-ball: the balls `seat` may hit first and pocket. */
function legalBalls(state: MatchState, seat: Seat): number[] {
  const pool = state.pool!
  const table = onTable(state)
  if (pool.open) {
    return table.filter((id) => id !== EIGHT)
  }
  const mine = groupBalls(pool.groups[seat]!).filter((id) => table.includes(id))
  return mine.length > 0 ? mine : [EIGHT]
}

// ---------------------------------------------------------------- turns

function announce(state: MatchState, events: BilEvent[]) {
  const pool = state.pool!
  events.push({
    type: "turn",
    seat: state.turnSeat,
    shotNo: state.shotNo,
    stage: "main",
    opening: false,
    frozen: [],
    ballInHand: pool.ballInHand,
    breakShot: pool.breakShot,
    pushOutAvailable: pool.pushOutAvailable,
    pendingChoice: pool.pendingChoice,
    mustCall:
      state.config.ruleType === "eightball" &&
      !pool.breakShot &&
      pool.pendingChoice === null &&
      pool.call === null,
  })
}

function passTurn(
  state: MatchState,
  events: BilEvent[],
  ballInHand: PoolState["ballInHand"]
) {
  const pool = state.pool!
  state.innings[state.turnSeat]++
  state.run = 0
  state.turnSeat = other(state.turnSeat)
  pool.ballInHand = ballInHand
  pool.call = null
  announce(state, events)
}

function keepTurn(state: MatchState, events: BilEvent[]) {
  const pool = state.pool!
  pool.ballInHand = "none"
  pool.call = null
  announce(state, events)
}

function startRack(state: MatchState, breaker: Seat, events: BilEvent[]) {
  state.balls = rackFor(
    state.config.ruleType,
    state.config.seed,
    state.rackNo++
  )
  state.pool = freshPool(breaker)
  state.turnSeat = breaker
  state.run = 0
  events.push({ type: "position", reason: "rack", balls: state.balls })
  announce(state, events)
}

/** A rack is over; the match may be too. Breaks alternate (WPA 1.3). */
function rackWon(state: MatchState, winner: Seat, events: BilEvent[]) {
  state.scores[winner]++
  state.innings[state.turnSeat]++
  events.push({
    type: "rackEnd",
    winnerSeat: winner,
    racks: [state.scores[0], state.scores[1]],
  })
  if (state.scores[winner] >= state.config.raceTo) {
    end(state, winner, "score", events)
    return
  }
  startRack(state, other(state.pool!.breaker), events)
}

function ask(state: MatchState, choice: PendingChoice, events: BilEvent[]) {
  const pool = state.pool!
  pool.pendingChoice = choice
  pool.call = null
  state.turnSeat = choice.seat
  announce(state, events)
}

// ---------------------------------------------------------------- judging

interface Verdict {
  foul: Foul | null
  /** the shooter stays at the table */
  continues: boolean
  /** rack decided on this shot */
  rack?: Seat
  /** object balls to put back on the spot */
  spot: number[]
  /** who decides what next, if anyone */
  choice?: PendingChoice
  ballInHand: PoolState["ballInHand"]
}

function nineBall(
  state: MatchState,
  seat: Seat,
  r: Reading,
  pushOut: boolean
): Verdict {
  const pool = state.pool!
  const none = NONE
  const target = pool.breakShot ? 1 : lowest(state)
  let foul: Foul | null = null
  if (r.scratch) {
    foul = "scratch"
  } else if (!pushOut) {
    // WPA 5.4: a push-out suspends wrong-ball-first and no-rail
    foul = standardFoul(r, [target], pool.breakShot)
  }

  const nineDown = r.pocketed.includes(NINE)
  if (foul) {
    pool.fouls[seat]++
    if (pool.fouls[seat] >= 3) {
      return { ...none, foul: "threeFouls", rack: other(seat), spot: [] }
    }
    return {
      ...none,
      foul,
      spot: nineDown ? [NINE] : [],
      ballInHand: "anywhere",
    }
  }
  pool.fouls[seat] = 0
  if (pushOut) {
    return {
      ...none,
      spot: nineDown ? [NINE] : [],
      choice: {
        seat: other(seat),
        kind: "pushOut",
        options: ["shoot", "pass"],
      },
    }
  }
  if (nineDown) {
    return { ...none, rack: seat }
  }
  const potted = r.pocketed.length > 0
  return { ...none, continues: potted }
}

/** WPA 3.2, 3.3 and the break requirement: the usual fouls, in order of seriousness. */
function standardFoul(
  r: Reading,
  legalFirst: number[],
  breakShot: boolean
): Foul | null {
  if (r.firstHit === null) return "noBall"
  if (!legalFirst.includes(r.firstHit)) return "wrongBallFirst"
  if (breakShot && r.pocketed.length === 0 && r.objectBallsToRail < 4) {
    return "badBreak"
  }
  if (!breakShot && r.pocketed.length === 0 && r.railsAfterContact === 0) {
    return "noRail"
  }
  return null
}

const NONE: Verdict = {
  foul: null,
  continues: false,
  spot: [],
  ballInHand: "none",
}

/** WPA 4.3: nothing is called on the break; fouls and weak breaks hand options over. */
function eightBallBreak(seat: Seat, r: Reading): Verdict {
  const eightDown = r.pocketed.includes(EIGHT)
  const objectPots = r.pocketed.filter((id) => id !== CUE)
  const opponent = other(seat)
  if (r.scratch || r.firstHit === null) {
    const foul: Foul = r.scratch ? "scratch" : "noBall"
    if (eightDown) {
      return {
        ...NONE,
        foul,
        spot: [EIGHT],
        choice: {
          seat: opponent,
          kind: "eightOnFoulBreak",
          options: ["spotEight", "rebreak"],
        },
      }
    }
    return {
      ...NONE,
      foul,
      choice: {
        seat: opponent,
        kind: "breakFoul",
        options: ["accept", "inHandKitchen"],
      },
    }
  }
  if (objectPots.length === 0 && r.objectBallsToRail < 4) {
    return {
      ...NONE,
      foul: "badBreak",
      choice: {
        seat: opponent,
        kind: "illegalBreak",
        options: ["accept", "rerackBreak", "rerackOffenderBreaks"],
      },
    }
  }
  if (eightDown) {
    return {
      ...NONE,
      spot: [EIGHT],
      choice: { seat, kind: "eightOnBreak", options: ["spotEight", "rebreak"] },
    }
  }
  return { ...NONE, continues: objectPots.length > 0 }
}

/** WPA 4.8: the 8 ends the rack one way or the other. */
function eightBallDecided(
  state: MatchState,
  seat: Seat,
  r: Reading,
  foul: Foul | null,
  legal: number[]
): Verdict {
  const call = state.pool!.call
  const onEight = legal.length === 1 && legal[0] === EIGHT
  const pot = r.pots.find((p) => p.a === EIGHT)
  const inCalledPocket =
    call !== null &&
    call !== "safety" &&
    call.ball === EIGHT &&
    pot?.pocket === call.pocket
  const win = onEight && !foul && inCalledPocket
  return {
    ...NONE,
    foul: win ? null : (foul ?? "eightBall"),
    rack: win ? seat : other(seat),
  }
}

function eightBall(state: MatchState, seat: Seat, r: Reading): Verdict {
  const pool = state.pool!
  if (pool.breakShot) {
    return eightBallBreak(seat, r)
  }
  const legal = legalBalls(state, seat)
  const foul = r.scratch ? "scratch" : standardFoul(r, legal, false)
  if (r.pocketed.includes(EIGHT)) {
    return eightBallDecided(state, seat, r, foul, legal)
  }
  if (foul) {
    return { ...NONE, foul, ballInHand: "anywhere" }
  }
  const call = pool.call
  if (call === "safety" || call === null) {
    return NONE
  }
  const pot = r.pots.find((p) => p.a === call.ball)
  const made =
    pot !== undefined && pot.pocket === call.pocket && legal.includes(call.ball)
  if (made && pool.open) {
    const mine = groupOf(call.ball)
    pool.open = false
    pool.groups[seat] = mine
    pool.groups[other(seat)] = mine === "solids" ? "stripes" : "solids"
  }
  return { ...NONE, continues: made }
}

// ---------------------------------------------------------------- actions

function placeBall(state: MatchState, pos: Vec2): ActionResult {
  const pool = state.pool!
  if (pool.ballInHand === "none" || pool.pendingChoice) {
    return fail("ILLEGAL_ACTION", "placeBall")
  }
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    return fail("VALIDATION_FAILED", "pos")
  }
  configure(state.config.ruleType)
  const p = { x: Math.fround(pos.x), y: Math.fround(pos.y) }
  if (!onCloth(p)) {
    return fail("ILLEGAL_PLACEMENT", "offTable")
  }
  if (pool.ballInHand === "kitchen" && p.x >= spots().headString) {
    return fail("ILLEGAL_PLACEMENT", "kitchen")
  }
  if (!clear(state.balls, p, CUE)) {
    return fail("ILLEGAL_PLACEMENT", "overlap")
  }
  state.balls = state.balls.map((b) =>
    b.id === CUE ? { id: CUE, x: p.x, y: p.y } : b
  )
  const events: BilEvent[] = [{ type: "placed", ball: CUE, pos: p }]
  return { ok: true, state, events }
}

function call(
  state: MatchState,
  seat: Seat,
  action: Extract<Action, { type: "call" }>
): ActionResult {
  const pool = state.pool!
  if (
    state.config.ruleType !== "eightball" ||
    pool.breakShot ||
    pool.pendingChoice
  ) {
    return fail("ILLEGAL_ACTION", "call")
  }
  if (action.safety) {
    pool.call = "safety"
    return { ok: true, state, events: [] }
  }
  const ball = action.ball
  const pocket = action.pocket
  if (
    !Number.isInteger(ball) ||
    !Number.isInteger(pocket) ||
    pocket! < 0 ||
    pocket! > 5
  ) {
    return fail("VALIDATION_FAILED", "call")
  }
  if (!legalBalls(state, seat).includes(ball!)) {
    return fail("ILLEGAL_ACTION", "call")
  }
  pool.call = { ball: ball!, pocket: pocket! }
  return { ok: true, state, events: [] }
}

/** What each answer to a pending choice does. */
const CHOICES: Record<
  string,
  (
    state: MatchState,
    seat: Seat,
    kind: PendingChoice["kind"],
    events: BilEvent[]
  ) => void
> = {
  shoot: (state, _seat, _kind, events) => keepTurn(state, events),
  pass: (state, seat, _kind, events) => {
    state.turnSeat = other(seat)
    keepTurn(state, events)
  },
  accept: (state, _seat, _kind, events) => {
    state.pool!.ballInHand = "none"
    announce(state, events)
  },
  inHandKitchen: (state, _seat, _kind, events) => {
    state.pool!.ballInHand = "kitchen"
    announce(state, events)
  },
  rerackBreak: (state, seat, _kind, events) => startRack(state, seat, events),
  rerackOffenderBreaks: (state, _seat, _kind, events) =>
    startRack(state, state.pool!.breaker, events),
  rebreak: (state, _seat, _kind, events) =>
    startRack(state, state.pool!.breaker, events),
  spotEight: (state, _seat, kind, events) => {
    state.balls = spotBall(state.balls, EIGHT)
    events.push({ type: "position", reason: "spot", balls: state.balls })
    state.pool!.ballInHand = kind === "eightOnFoulBreak" ? "kitchen" : "none"
    announce(state, events)
  },
}

function choice(state: MatchState, seat: Seat, option: string): ActionResult {
  const pool = state.pool!
  const pending = pool.pendingChoice
  if (!pending || pending.seat !== seat) {
    return fail("ILLEGAL_ACTION", "choice")
  }
  if (!pending.options.includes(option)) {
    return fail("VALIDATION_FAILED", "option")
  }
  const events: BilEvent[] = []
  pool.pendingChoice = null
  state.shotNo++
  CHOICES[option](state, seat, pending.kind, events)
  return { ok: true, state, events }
}

/** Everything that can refuse a shot before it is played. */
function refuseShot(
  state: MatchState,
  input: Shot,
  pushOut: boolean
): ActionResult | Shot {
  const pool = state.pool!
  const ruleType = state.config.ruleType
  if (pool.pendingChoice) {
    return fail("ILLEGAL_ACTION", "choice")
  }
  if (ruleType === "eightball" && !pool.breakShot && pool.call === null) {
    return fail("ILLEGAL_ACTION", "call")
  }
  if (pushOut && !pool.pushOutAvailable) {
    return fail("ILLEGAL_ACTION", "pushOut")
  }
  const shot = canonicalShot(input)
  if (typeof shot === "string") {
    return fail("SHOT_OUT_OF_RANGE", shot)
  }
  configure(ruleType)
  const cue = state.balls[CUE]
  if (pool.ballInHand === "kitchen" && cue.x >= spots().headString) {
    return fail("ILLEGAL_PLACEMENT", "kitchen")
  }
  if (pool.ballInHand !== "none" && !clear(state.balls, cue, CUE)) {
    return fail("ILLEGAL_PLACEMENT", "overlap")
  }
  return shot
}

/** Where play goes after the shot has been judged. */
function settle(
  state: MatchState,
  seat: Seat,
  verdict: Verdict,
  reading: Reading,
  wasBreak: boolean,
  events: BilEvent[]
) {
  const pool = state.pool!
  const nineBallRack = state.config.ruleType === "nineball"
  if (verdict.rack !== undefined) {
    rackWon(state, verdict.rack, events)
    return
  }
  if (verdict.choice) {
    if (verdict.choice.seat !== seat) {
      state.innings[seat]++
      state.run = 0
    }
    ask(state, verdict.choice, events)
    return
  }
  if (verdict.continues) {
    state.run += reading.pocketed.filter((id) => id !== CUE).length
    // WPA 5.4: the push-out is on offer right after a legal break
    pool.pushOutAvailable = wasBreak && nineBallRack
    keepTurn(state, events)
    return
  }
  if (wasBreak && nineBallRack && !verdict.foul) {
    // a dry legal break: the incoming player may push out
    state.innings[seat]++
    state.run = 0
    state.turnSeat = other(seat)
    pool.ballInHand = "none"
    pool.pushOutAvailable = true
    pool.call = null
    announce(state, events)
    return
  }
  passTurn(state, events, verdict.ballInHand)
}

function shoot(
  state: MatchState,
  seat: Seat,
  input: Shot,
  pushOut: boolean
): ActionResult {
  const pool = state.pool!
  const ruleType = state.config.ruleType
  const shot = refuseShot(state, input, pushOut)
  if ("ok" in shot) {
    return shot
  }
  const start = state.balls
  let sim: SimResult
  try {
    sim = simulateShot(ruleType, start, CUE, shot)
  } catch (e) {
    return fail("SIM_FAILED", e instanceof Error ? e.message : String(e))
  }
  const reading = read(sim.events)
  const wasBreak = pool.breakShot
  const verdict =
    ruleType === "nineball"
      ? nineBall(state, seat, reading, pushOut)
      : eightBall(state, seat, reading)

  state.balls = sim.final
  for (const id of verdict.spot) {
    state.balls = spotBall(state.balls, id)
  }
  if (reading.scratch) {
    // the cue ball comes back in hand; parked on the head spot until placed
    const { head } = spots()
    state.balls = state.balls.map((b) =>
      b.id === CUE ? { id: CUE, x: Math.fround(head), y: 0 } : b
    )
  }
  state.timeouts[seat] = 0
  state.extensionsOnShot = 0
  state.shotNo++
  pool.breakShot = false
  pool.pushOutAvailable = false

  const shotEvent: ShotEvent = {
    type: "shot",
    shotNo: state.shotNo - 1,
    seat,
    stage: "main",
    cueBall: CUE,
    shot,
    start,
    final: sim.final,
    durationMs: sim.durationMs,
    outcome: {
      events: sim.events,
      points: verdict.continues
        ? reading.pocketed.filter((id) => id !== CUE).length
        : 0,
      foul: verdict.foul,
      penalty: 0,
      pocketed: reading.pocketed,
    },
    scores: [state.scores[0], state.scores[1]],
    stateHash: "",
  }
  const events: BilEvent[] = [shotEvent]
  if (verdict.spot.length > 0) {
    events.push({ type: "position", reason: "spot", balls: state.balls })
  }
  if (verdict.rack !== undefined) {
    shotEvent.outcome.rack = verdict.rack === seat
  }
  settle(state, seat, verdict, reading, wasBreak, events)
  shotEvent.scores = [state.scores[0], state.scores[1]]
  shotEvent.stateHash = stateHash(state)
  return { ok: true, state, events }
}

function timeout(state: MatchState, seat: Seat): ActionResult {
  const events: BilEvent[] = []
  if (extendClock(state, seat, events)) {
    return { ok: true, state, events }
  }
  if (timeFoul(state, seat, events)) {
    return { ok: true, state, events }
  }
  const pool = state.pool!
  if (pool.pendingChoice) {
    // no answer: the first option stands
    const option = pool.pendingChoice.options[0]
    state.shotNo--
    return choice(state, seat, option)
  }
  if (pool.breakShot) {
    // the break was never played: the opponent breaks a fresh rack
    state.innings[seat]++
    startRack(state, other(seat), events)
    return { ok: true, state, events }
  }
  pool.fouls[seat]++
  if (state.config.ruleType === "nineball" && pool.fouls[seat] >= 3) {
    rackWon(state, other(seat), events)
    return { ok: true, state, events }
  }
  passTurn(state, events, "anywhere")
  return { ok: true, state, events }
}

/** Actions of the pool disciplines; `state` is already a private copy. */
export function applyPool(
  state: MatchState,
  seat: Seat,
  action: Action
): ActionResult {
  if (
    !["shoot", "placeBall", "call", "choice", "timeout"].includes(action?.type)
  ) {
    return fail("VALIDATION_FAILED", "action")
  }
  if (seat !== state.turnSeat) {
    return fail("NOT_YOUR_TURN")
  }
  if (action.type === "timeout") {
    return timeout(state, seat)
  }
  if (
    action.type === "respot" ||
    action.type === "concede" ||
    action.shotNo !== state.shotNo
  ) {
    return fail("STALE_SHOT_NO")
  }
  switch (action.type) {
    case "placeBall":
      return placeBall(state, action.pos)
    case "call":
      return call(state, seat, action)
    case "choice":
      return choice(state, seat, action.option)
    default:
      return shoot(state, seat, action.shot, action.pushOut === true)
  }
}

/** For the suggester: what the shooter should hit first. */
export function poolTargets(state: MatchState, seat: Seat): number[] {
  const pool = state.pool!
  if (state.config.ruleType === "nineball") {
    return [pool.breakShot ? 1 : lowest(state)]
  }
  return pool.breakShot ? [1] : legalBalls(state, seat)
}

/**
 * For the suggester: how the rules would see `events` from this position,
 * without touching the state.
 */
export function previewVerdict(
  state: MatchState,
  seat: Seat,
  events: OutcomeEvent[]
): { foul: Foul | null; continues: boolean; rack?: Seat } {
  const copy: MatchState = JSON.parse(JSON.stringify(state))
  const reading = read(events)
  if (copy.config.ruleType === "eightball" && !copy.pool!.breakShot) {
    // judged as if the player had called what the shot makes
    copy.pool!.call = callFor(state, seat, events) ?? "safety"
  }
  const v =
    copy.config.ruleType === "nineball"
      ? nineBall(copy, seat, reading, false)
      : eightBall(copy, seat, reading)
  return { foul: v.foul, continues: v.continues, rack: v.rack }
}

/** For the suggester: a legal ball and pocket the shot would make, if any. */
export function callFor(
  state: MatchState,
  seat: Seat,
  events: OutcomeEvent[]
): { ball: number; pocket: number } | null {
  const legal = legalBalls(state, seat)
  const r = read(events)
  const pot = r.pots.find((p) => legal.includes(p.a) && p.pocket !== undefined)
  return pot ? { ball: pot.a, pocket: pot.pocket! } : null
}
