import { expect } from "chai"
import {
  applyAction,
  createMatch,
  ENGINE_VERSION,
  extensionsFor,
  frozenTo,
  SHOT_LIMITS,
  simulateShot,
  stateHash,
  suggestShot,
  tableInfo,
} from "../../src/engine"
import { isPoint } from "../../src/engine/rules/threecushion"
import {
  Action,
  MatchConfig,
  MatchState,
  Seat,
  Shot,
} from "../../src/engine/types"
import { TableConfig } from "../../src/view/tableconfig"
import golden from "../../vectors/threecushion.json"

const config: MatchConfig = {
  ruleType: "threecushion",
  raceTo: 2,
  equalizingInning: true,
  tieBreak: "shootout",
  extensions: 0,
  timeoutLimit: 2,
  firstSeat: 0,
  seed: "spec",
}

/** too soft to reach anything from the starting position: a plain miss */
const softShot: Shot = {
  angle: 1,
  power: SHOT_LIMITS.power[0],
  elevation: 0,
  offset: { x: 0, y: 0 },
}

function shoot(state: MatchState, shot: Shot = softShot): Action {
  return { type: "shoot", shotNo: state.shotNo, shot }
}

function apply(state: MatchState, seat: Seat, action: Action) {
  const result = applyAction(state, seat, action)
  if (!result.ok) throw new Error(`${result.code} ${result.reason ?? ""}`)
  return result
}

function code(state: MatchState, seat, action) {
  const r = applyAction(state, seat, action)
  return r.ok ? "ok" : r.code
}

type Vector = { state: MatchState; seat: Seat; action: Action; expected: any }
const vectors = golden.vectors as unknown as Vector[]

/** A recorded scoring shot in the main stage, by the starter or the other seat. */
function scoringVector(byStarter: boolean): Vector {
  const v = vectors.find(
    (x) =>
      x.expected.ok &&
      x.state.stage === "main" &&
      x.expected.events[0].type === "shot" &&
      x.expected.events[0].outcome.points === 1 &&
      (x.seat === x.state.config.firstSeat) === byStarter
  )
  if (!v) throw new Error("no such vector")
  return JSON.parse(JSON.stringify(v))
}

/** Put the shooter of `v` one point from the target. */
function onePointShort(v: Vector, overrides: Partial<MatchConfig> = {}) {
  const state = v.state
  state.config = { ...state.config, raceTo: 30, ...overrides }
  state.scores[v.seat] = 29
  return state
}

describe("engine match", () => {
  it("sets up the UMB starting position for the first seat", () => {
    const table = tableInfo()
    const state = createMatch({ ...config, firstSeat: 1 })
    expect(state.turnSeat).to.equal(1)
    // the starter plays white
    expect(state.cueBallOf).to.deep.equal([1, 0])
    const [white, yellow, red] = state.balls
    const near = (a: number, b: number) =>
      expect(Math.abs(a - b)).to.be.below(0.002)
    near(red.x, table.spots.top.x)
    near(red.y, 0)
    near(yellow.x, table.spots.start.x)
    near(yellow.y, 0)
    near(white.x, table.spots.start.x)
    near(white.y, -table.spots.side)
    expect(state.opening).to.equal(true)
    expect(state.stage).to.equal("main")
    expect(state.shotNo).to.equal(1)
    expect(state.extensionsLeft).to.deep.equal([0, 0])
    expect(state.engineVersion).to.equal(ENGINE_VERSION)
  })

  it("racks the same position for the same seed only", () => {
    const first = createMatch(config).balls
    const again = createMatch(config).balls
    const other = createMatch({ ...config, seed: "other" }).balls
    expect(again).to.deep.equal(first)
    expect(other).to.not.deep.equal(first)
  })

  it("rejects invalid configuration", () => {
    expect(() => createMatch({ ...config, raceTo: 0 })).to.throw("raceTo")
    expect(() => createMatch({ ...config, raceTo: 101 })).to.throw("raceTo")
    expect(() => createMatch({ ...config, timeoutLimit: -1 })).to.throw(
      "timeoutLimit"
    )
    expect(() => createMatch({ ...config, extensions: 6 })).to.throw(
      "extensions"
    )
    expect(() => createMatch({ ...config, tieBreak: "coin" as any })).to.throw(
      "tieBreak"
    )
    expect(() =>
      createMatch({ ...config, equalizingInning: undefined as any })
    ).to.throw("equalizingInning")
    expect(() => createMatch({ ...config, seed: "" })).to.throw("seed")
    expect(() => createMatch({ ...config, ruleType: "pool" as any })).to.throw(
      "ruleType"
    )
  })

  it("does not modify the state it is given and is repeatable", () => {
    const state = createMatch(config)
    const before = JSON.stringify(state)
    const first = applyAction(state, 0, shoot(state))
    const second = applyAction(state, 0, shoot(state))
    expect(JSON.stringify(state)).to.equal(before)
    expect(first).to.deep.equal(second)
  })

  it("passes the turn after a miss, balls staying where they stopped", () => {
    const state = createMatch(config)
    const result = apply(state, 0, shoot(state))
    expect(result.events.map((e) => e.type)).to.deep.equal(["shot", "turn"])
    expect(result.state.turnSeat).to.equal(1)
    expect(result.state.shotNo).to.equal(2)
    expect(result.state.innings).to.deep.equal([1, 0])
    expect(result.state.scores).to.deep.equal([0, 0])
    expect(result.state.opening).to.equal(false)
    const shot = result.events[0]
    if (shot.type !== "shot") throw new Error("expected shot")
    expect(shot.outcome.foul).to.be.null
    expect(shot.stateHash).to.equal(stateHash(result.state))
    expect(shot.final).to.deep.equal(result.state.balls)
  })

  it("rounds the shot to float32 and reports the rounded one", () => {
    const state = createMatch(config)
    const result = apply(state, 0, shoot(state, { ...softShot, angle: 0.1 }))
    const shot = result.events[0]
    if (shot.type !== "shot") throw new Error("expected shot")
    expect(shot.shot.angle).to.equal(Math.fround(0.1))
  })

  it("rejects actions out of turn, stale or out of range", () => {
    const state = createMatch(config)
    expect(code(state, 1, shoot(state))).to.equal("NOT_YOUR_TURN")
    expect(code(state, 1, { type: "timeout" })).to.equal("NOT_YOUR_TURN")
    expect(code(state, 0, { type: "extend" })).to.equal("VALIDATION_FAILED")
    expect(code(state, 0, { ...shoot(state), shotNo: 2 })).to.equal(
      "STALE_SHOT_NO"
    )
    expect(code(state, 2, shoot(state))).to.equal("VALIDATION_FAILED")
    expect(code(state, 0, { type: "nonsense" })).to.equal("VALIDATION_FAILED")
    expect(code(state, 0, { ...shoot(state), side: "up" })).to.equal(
      "VALIDATION_FAILED"
    )
    const bad: Partial<Shot>[] = [
      { power: SHOT_LIMITS.power[1] * 2 },
      { power: 0 },
      { power: NaN },
      { elevation: -0.1 },
      { elevation: 2 },
      { offset: { x: 0.5, y: 0 } },
      { angle: Infinity },
      { offset: undefined },
    ]
    for (const b of bad) {
      expect(code(state, 0, shoot(state, { ...softShot, ...b }))).to.equal(
        "SHOT_OUT_OF_RANGE"
      )
    }
  })

  it("lets either seat concede at any time", () => {
    const state = createMatch(config)
    const result = apply(state, 1, { type: "concede" })
    expect(result.state.result).to.deep.equal({
      winnerSeat: 0,
      reason: "concede",
    })
  })
})

describe("engine starting shot (art. 23)", () => {
  const hard: Shot = { ...softShot, power: 3 }

  it("is a foul unless it goes directly to the red", () => {
    const state = createMatch(config)
    // straight into the long cushion
    const result = apply(
      state,
      0,
      shoot(state, { ...hard, angle: Math.PI / 2 })
    )
    const shot = result.events[0]
    if (shot.type !== "shot") throw new Error("expected shot")
    expect(shot.outcome.foul).to.equal("redFirst")
    expect(shot.outcome.points).to.equal(0)
    expect(result.state.turnSeat).to.equal(1)
    // a foul leaves the balls where they stopped
    expect(result.state.balls).to.deep.equal(shot.final)
  })

  it("accepts a direct shot to the red", () => {
    const state = createMatch(config)
    const [white, , red] = state.balls
    const angle = Math.atan2(red.y - white.y, red.x - white.x)
    const result = apply(state, 0, shoot(state, { ...hard, angle }))
    const shot = result.events[0]
    if (shot.type !== "shot") throw new Error("expected shot")
    expect(shot.outcome.events[0]).to.include({ type: "collision", a: 0, b: 2 })
    expect(shot.outcome.foul).to.be.null
  })

  it("lets the player choose the side of the cue ball", () => {
    const state = createMatch(config)
    const left = apply(state, 0, { ...shoot(state), side: "left" })
    const right = apply(state, 0, { ...shoot(state), side: "right" })
    const start = (r) => r.events[0].start[0]
    expect(start(left).y).to.be.above(0)
    expect(start(right).y).to.be.below(0)
    expect(start(left).y).to.equal(-start(right).y)
  })

  it("refuses a side once the balls are in play", () => {
    const state = apply(
      createMatch(config),
      0,
      shoot(createMatch(config))
    ).state
    expect(code(state, 1, { ...shoot(state), side: "left" })).to.equal(
      "ILLEGAL_ACTION"
    )
  })
})

describe("engine end of match (art. 29)", () => {
  it("gives the opponent an equalizing inning when the starter finishes", () => {
    const v = scoringVector(true)
    const state = onePointShort(v)
    const result = apply(state, v.seat, v.action)
    const second = v.seat === 0 ? 1 : 0
    expect(result.events.map((e) => e.type)).to.deep.equal([
      "shot",
      "position",
      "turn",
    ])
    expect(result.state.phase).to.equal("playing")
    expect(result.state.stage).to.equal("equalizing")
    expect(result.state.turnSeat).to.equal(second)
    expect(result.state.opening).to.equal(true)
    expect(result.state.innings[v.seat]).to.equal(
      result.state.innings[second] + 1
    )
    // the opponent's own ball is the one on the side spot
    const own = result.state.balls[result.state.cueBallOf[second]]
    expect(Math.abs(own.y)).to.be.above(0.1)
  })

  it("ends at once without equalizing innings", () => {
    const v = scoringVector(true)
    const state = onePointShort(v, { equalizingInning: false })
    const result = apply(state, v.seat, v.action)
    expect(result.state.result).to.deep.equal({
      winnerSeat: v.seat,
      reason: "score",
    })
  })

  it("ends at once when the second player finishes first", () => {
    const v = scoringVector(false)
    const state = onePointShort(v)
    const result = apply(state, v.seat, v.action)
    expect(result.state.result).to.deep.equal({
      winnerSeat: v.seat,
      reason: "score",
    })
  })

  it("the starter wins when the equalizing inning falls short", () => {
    const state = createMatch({ ...config, firstSeat: 1 })
    state.stage = "equalizing"
    state.turnSeat = 0
    state.scores = [0, 2]
    const result = apply(state, 0, shoot(state))
    expect(result.state.result).to.deep.equal({
      winnerSeat: 1,
      reason: "score",
    })
  })

  function levelling(tieBreak: "draw" | "shootout") {
    const v = scoringVector(false)
    const state = onePointShort(v, { tieBreak })
    state.stage = "equalizing"
    state.scores[state.config.firstSeat] = 30
    return { v, result: apply(state, v.seat, v.action) }
  }

  it("is a draw when the equalizing inning also finishes", () => {
    const { result } = levelling("draw")
    expect(result.state.scores).to.deep.equal([30, 30])
    expect(result.state.result).to.deep.equal({
      winnerSeat: null,
      reason: "draw",
    })
  })

  it("goes to a penalty shoot-out instead when configured", () => {
    const { v, result } = levelling("shootout")
    expect(result.state.phase).to.equal("playing")
    expect(result.state.stage).to.equal("shootout")
    expect(result.state.shootout).to.deep.equal({
      round: 1,
      runs: [null, null],
    })
    // same order as the start of the match, from the starting position
    expect(result.state.turnSeat).to.equal(v.state.config.firstSeat)
    expect(result.state.opening).to.equal(true)
  })
})

describe("engine penalty shoot-out", () => {
  function shootoutState(): MatchState {
    const state = createMatch(config)
    state.stage = "shootout"
    state.scores = [2, 2]
    state.shootout = { round: 1, runs: [null, null] }
    return state
  }

  it("replays the round when both runs are equal", () => {
    let state = shootoutState()
    state = apply(state, 0, shoot(state)).state
    expect(state.shootout).to.deep.equal({ round: 1, runs: [0, null] })
    expect(state.turnSeat).to.equal(1)
    expect(state.opening).to.equal(true)
    state = apply(state, 1, shoot(state)).state
    expect(state.phase).to.equal("playing")
    expect(state.shootout).to.deep.equal({ round: 2, runs: [null, null] })
    expect(state.turnSeat).to.equal(0)
  })

  it("the higher run wins and penalty points leave the score alone", () => {
    const v = scoringVector(false)
    let state = v.state
    state.stage = "shootout"
    state.scores = [30, 30]
    state.shootout = { round: 1, runs: [null, null] }
    state.shootout.runs[state.config.firstSeat] = 0
    state.extensionsLeft = [0, 0]
    state = apply(state, v.seat, v.action).state
    expect(state.run).to.equal(1)
    expect(state.scores).to.deep.equal([30, 30])
    expect(state.highRun).to.deep.equal(v.state.highRun)
    // a time foul ends the run
    state = apply(state, v.seat, { type: "timeout" }).state
    expect(state.result).to.deep.equal({
      winnerSeat: v.seat,
      reason: "shootout",
    })
  })
})

describe("engine time regulation", () => {
  it("a time foul puts the balls up for the opponent", () => {
    let state = createMatch({ ...config, timeoutLimit: 0 })
    state = apply(state, 0, shoot(state)).state
    const before = state.balls
    const result = apply(state, 1, { type: "timeout" })
    expect(result.events.map((e) => e.type)).to.deep.equal([
      "timeout",
      "position",
      "turn",
    ])
    expect(result.state.turnSeat).to.equal(0)
    expect(result.state.opening).to.equal(true)
    expect(result.state.balls).to.not.deep.equal(before)
    expect(result.state.innings).to.deep.equal([1, 1])
  })

  it("forfeits after the configured run of time fouls", () => {
    let state = createMatch(config)
    state = apply(state, 0, { type: "timeout" }).state
    expect(state.timeouts).to.deep.equal([1, 0])
    state = apply(state, 1, shoot(state)).state
    const result = apply(state, 0, { type: "timeout" })
    expect(result.state.result).to.deep.equal({
      winnerSeat: 1,
      reason: "timeout",
    })
    expect(applyAction(result.state, 1, shoot(result.state))).to.deep.equal({
      ok: false,
      code: "ROUND_NOT_ACTIVE",
    })
  })

  it("never forfeits when the limit is zero", () => {
    let state = createMatch({ ...config, timeoutLimit: 0 })
    for (let i = 0; i < 12; i++) {
      state = apply(state, state.turnSeat, { type: "timeout" }).state
    }
    expect(state.phase).to.equal("playing")
  })

  it("a shot clears that seat's count of time fouls", () => {
    let state = createMatch(config)
    state = apply(state, 0, { type: "timeout" }).state
    state = apply(state, 1, shoot(state)).state
    state = apply(state, 0, shoot(state)).state
    expect(state.timeouts).to.deep.equal([0, 0])
  })

  it("allows time-outs by match length as at UMB World Cups", () => {
    expect([10, 29].map(extensionsFor)).to.deep.equal([1, 1])
    expect([30, 35, 39].map(extensionsFor)).to.deep.equal([2, 2, 2])
    expect([40, 50, 100].map(extensionsFor)).to.deep.equal([3, 3, 3])
    const state = createMatch({ ...config, raceTo: 40, extensions: undefined })
    expect(state.config.extensions).to.equal(3)
    expect(state.extensionsLeft).to.deep.equal([3, 3])
  })

  it("spends every time-out on the same shot before calling a time foul", () => {
    let state = createMatch({ ...config, extensions: 2 })
    const first = apply(state, 0, { type: "timeout" })
    expect(first.events).to.deep.equal([
      { type: "extension", seat: 0, left: 1 },
    ])
    state = first.state
    expect(state.turnSeat).to.equal(0)
    expect(state.shotNo).to.equal(1)
    expect(state.extensionsOnShot).to.equal(1)
    const second = apply(state, 0, { type: "timeout" })
    expect(second.events).to.deep.equal([
      { type: "extension", seat: 0, left: 0 },
    ])
    state = second.state
    expect(state.extensionsOnShot).to.equal(2)
    // nothing left: time foul, the opponent starts from the starting position
    const third = apply(state, 0, { type: "timeout" })
    expect(third.events.map((e) => e.type)).to.deep.equal([
      "timeout",
      "position",
      "turn",
    ])
    state = third.state
    expect(state.turnSeat).to.equal(1)
    expect(state.opening).to.equal(true)
    expect(state.extensionsLeft).to.deep.equal([0, 2])
    expect(state.extensionsOnShot).to.equal(0)
  })

  it("a shot starts the next clock without extensions", () => {
    let state = createMatch({ ...config, extensions: 2 })
    state = apply(state, 0, { type: "timeout" }).state
    state = apply(state, 0, shoot(state)).state
    expect(state.extensionsOnShot).to.equal(0)
    expect(state.extensionsLeft).to.deep.equal([1, 2])
  })
})

describe("engine balls in contact (art. 27)", () => {
  const table = tableInfo()
  const d = 2 * table.ballRadius
  const hard: Shot = { ...softShot, power: 3, angle: 0 }

  /** seat 0 (white) to play with the balls at the given places */
  function position(white: number[], yellow: number[], red: number[]) {
    const state = createMatch(config)
    state.balls = [white, yellow, red].map((p, id) => ({
      id,
      x: Math.fround(p[0]),
      y: Math.fround(p[1]),
    }))
    state.opening = false
    state.frozen = frozenTo(state.balls, 0)
    return state
  }

  function foulOf(state: MatchState, angle: number) {
    const shot = apply(state, 0, shoot(state, { ...hard, angle })).events[0]
    if (shot.type !== "shot") throw new Error("expected shot")
    return shot.outcome.foul
  }

  it("finds the balls touching the cue ball", () => {
    expect(position([0, 0], [-0.5, 0], [d, 0]).frozen).to.deep.equal([2])
    expect(position([0, 0], [-d, 0], [d, 0]).frozen).to.deep.equal([1, 2])
    expect(position([0, 0], [-0.5, 0], [d + 0.001, 0]).frozen).to.deep.equal([])
  })

  it("playing straight into the touching ball is a foul, playing away is not", () => {
    const state = position([0, 0], [-0.5, 0.3], [d, 0])
    expect(foulOf(state, 0)).to.equal("ballInContact")
    expect(foulOf(state, Math.PI)).to.be.null
    expect(foulOf(state, Math.PI / 2)).to.be.null
  })

  it("playing straight into a touching cushion is a foul", () => {
    const state = position([0.3, table.halfWidth], [-0.5, 0], [0.6, -0.2])
    expect(foulOf(state, Math.PI / 2)).to.equal("cushionInContact")
    expect(foulOf(state, -Math.PI / 2)).to.be.null
  })

  it("respots only the balls in contact", () => {
    const state = position([0.2, 0.1], [-0.6, -0.3], [0.2 + d, 0.1])
    const result = apply(state, 0, { type: "respot", shotNo: state.shotNo })
    const [white, yellow, red] = result.state.balls
    expect(white).to.deep.include({ x: Math.fround(table.spots.start.x), y: 0 })
    expect(red).to.deep.include({ x: Math.fround(table.spots.top.x), y: 0 })
    expect(yellow).to.deep.equal(state.balls[1])
    expect(result.state.frozen).to.deep.equal([])
    expect(result.state.turnSeat).to.equal(0)
    expect(result.state.shotNo).to.equal(state.shotNo + 1)
    // not a starting position: any first ball is allowed
    expect(result.state.opening).to.equal(false)
  })

  it("uses the covering ball's spot when a spot is taken", () => {
    // the opponent's ball sits on the top spot, where the red belongs
    const state = position([0.2, 0.1], [table.spots.top.x, 0], [0.2 + d, 0.1])
    const result = apply(state, 0, { type: "respot", shotNo: state.shotNo })
    expect(result.state.balls[2]).to.deep.include({ x: 0, y: 0 })
  })

  it("refuses a respot when nothing is touching", () => {
    const state = position([0, 0], [-0.5, 0], [0.5, 0])
    expect(code(state, 0, { type: "respot", shotNo: state.shotNo })).to.equal(
      "ILLEGAL_ACTION"
    )
  })
})

describe("engine shot suggester", () => {
  function lcg(seed: number) {
    let a = seed
    return () => {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0
      return a / 4294967296
    }
  }

  it("is repeatable for the same generator and within the shot limits", () => {
    const state = createMatch(config)
    const first = suggestShot(state, 0, lcg(7), { tries: 15 })
    const again = suggestShot(state, 0, lcg(7), { tries: 15 })
    expect(again).to.deep.equal(first)
    expect(first.power).to.be.within(SHOT_LIMITS.power[0], SHOT_LIMITS.power[1])
    expect(Math.hypot(first.offset.x, first.offset.y)).to.be.at.most(
      SHOT_LIMITS.offsetMax
    )
  })

  it("suggests a legal starting shot, straight to the red", () => {
    const state = createMatch(config)
    const shot = suggestShot(state, 0, lcg(3), { tries: 15 })
    const event = apply(state, 0, shoot(state, shot)).events[0]
    if (event.type !== "shot") throw new Error("expected shot")
    expect(event.outcome.foul).to.be.null
    expect(event.outcome.events[0]).to.include({ type: "collision", b: 2 })
  })

  it("plays the chosen shot unsteadily when asked, within the limits", () => {
    const state = createMatch(config)
    const exact = suggestShot(state, 0, lcg(5), { tries: 10 })
    const shaky = suggestShot(state, 0, lcg(5), {
      tries: 10,
      aimError: 0.01,
    })
    expect(shaky).to.not.deep.equal(exact)
    expect(Math.abs(shaky.angle - exact.angle)).to.be.below(0.1)
    expect(shaky.power).to.be.within(SHOT_LIMITS.power[0], SHOT_LIMITS.power[1])
    expect(Math.hypot(shaky.offset.x, shaky.offset.y)).to.be.at.most(
      SHOT_LIMITS.offsetMax
    )
  })

  it("does not modify the state", () => {
    const state = createMatch(config)
    const before = JSON.stringify(state)
    suggestShot(state, 0, lcg(1), { tries: 5 })
    expect(JSON.stringify(state)).to.equal(before)
  })
})

describe("engine three cushion point", () => {
  const cushion = (a: number) => ({ type: "cushion" as const, t: 0, a })
  const hit = (a: number, b: number) => ({
    type: "collision" as const,
    t: 0,
    a,
    b,
  })

  it("needs three cushions before the second ball", () => {
    expect(
      isPoint(0, [hit(0, 1), cushion(0), cushion(0), cushion(0), hit(0, 2)])
    ).to.equal(true)
    expect(
      isPoint(0, [cushion(0), cushion(0), cushion(0), hit(1, 0), hit(2, 0)])
    ).to.equal(true)
    expect(isPoint(0, [hit(0, 1), cushion(0), cushion(0), hit(0, 2)])).to.equal(
      false
    )
  })

  it("ignores cushions after the second ball and other balls' cushions", () => {
    expect(
      isPoint(0, [hit(0, 1), hit(0, 2), cushion(0), cushion(0), cushion(0)])
    ).to.equal(false)
    expect(
      isPoint(0, [hit(0, 1), cushion(1), cushion(1), cushion(1), hit(0, 2)])
    ).to.equal(false)
  })

  it("does not count the same ball twice or a kiss between object balls", () => {
    expect(
      isPoint(0, [hit(0, 1), cushion(0), cushion(0), cushion(0), hit(0, 1)])
    ).to.equal(false)
    expect(
      isPoint(0, [hit(0, 1), cushion(0), cushion(0), cushion(0), hit(1, 2)])
    ).to.equal(false)
  })
})

describe("engine golden vectors", () => {
  it("was generated by this engine version", () => {
    expect(golden.engineVersion).to.equal(ENGINE_VERSION)
  })

  it("replays every vector exactly", () => {
    for (const v of golden.vectors) {
      const got = applyAction(
        v.state as MatchState,
        v.seat as 0 | 1,
        v.action as Action
      )
      expect(JSON.parse(JSON.stringify(got))).to.deep.equal(v.expected)
    }
  })

  it("is unaffected by another rule type configured in the same process", () => {
    const v = golden.vectors.find((x) => x.expected.ok)!
    TableConfig.apply("nineball")
    const got = applyAction(
      v.state as MatchState,
      v.seat as 0 | 1,
      v.action as Action
    )
    expect(JSON.parse(JSON.stringify(got))).to.deep.equal(v.expected)
  })

  it("records frames that end on the final position", () => {
    const v = golden.vectors.find((x) => x.expected.ok)!
    const state = v.state as MatchState
    const event = (v.expected as any).events[0]
    const sim = simulateShot(
      "threecushion",
      state.balls,
      event.cueBall,
      event.shot,
      {
        frameEvery: 8,
      }
    )
    expect(sim.final).to.deep.equal(event.final)
    const last = sim.frames![sim.frames!.length - 1]
    expect(last.t).to.equal(sim.durationMs)
    expect(last.p).to.deep.equal(sim.final.flatMap((b) => [b.x, b.y]))
  })
})
