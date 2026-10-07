import { expect } from "chai"
import {
  applyAction,
  createMatch,
  SHOT_LIMITS,
  spotBall,
  tableInfo,
} from "../../src/engine"
import { Action, MatchConfig, MatchState, Shot } from "../../src/engine/types"
import eight from "../../vectors/eightball.json"
import nine from "../../vectors/nineball.json"

const base: MatchConfig = {
  ruleType: "nineball",
  raceTo: 2,
  equalizingInning: false,
  tieBreak: "draw",
  extensions: 0,
  timeoutLimit: 0,
  firstSeat: 0,
  seed: "pool-spec",
}

const soft: Shot = {
  angle: 0,
  power: SHOT_LIMITS.power[0],
  elevation: 0,
  offset: { x: 0, y: 0 },
}

function apply(state: MatchState, seat, action: Action) {
  const r = applyAction(state, seat, action)
  if (!r.ok) throw new Error(`${r.code} ${r.reason ?? ""}`)
  return r
}

function code(state: MatchState, seat, action: Action) {
  const r = applyAction(state, seat, action)
  if (r.ok) return "ok"
  return r.reason ? `${r.code}:${r.reason}` : r.code
}

/** a vector whose expected shot event satisfies `pick` */
function shotVector(vectors: any[], pick: (shot: any, v: any) => boolean) {
  const v = vectors.find(
    (x) =>
      x.expected.ok &&
      x.expected.events[0]?.type === "shot" &&
      pick(x.expected.events[0], x)
  )
  if (!v) throw new Error("no such vector")
  return v
}

describe("engine pool racks", () => {
  const R = tableInfo().ballRadius

  it("racks nine ball as a diamond with the 1 at the apex and the 9 on the foot spot", () => {
    const state = createMatch(base)
    const balls = state.balls
    expect(balls).to.have.lengthOf(10)
    expect(balls[0].id).to.equal(0)
    const one = balls.find((b) => b.id === 1)!
    const nineBall = balls.find((b) => b.id === 9)!
    expect(one.x).to.be.below(nineBall.x)
    expect(Math.abs(nineBall.y)).to.be.below(0.001)
    // every pair of object balls is at least a ball apart
    const objects = balls.filter((b) => b.id > 0)
    for (const a of objects)
      for (const b of objects)
        if (a !== b)
          expect(Math.hypot(a.x - b.x, a.y - b.y)).to.be.at.least(2 * R)
    expect(state.pool).to.include({
      breakShot: true,
      ballInHand: "kitchen",
      breaker: 0,
    })
  })

  it("racks eight ball as a triangle with the 8 in the middle and mixed back corners", () => {
    const state = createMatch({ ...base, ruleType: "eightball" })
    const balls = state.balls
    expect(balls).to.have.lengthOf(16)
    const eightBall = balls.find((b) => b.id === 8)!
    const apex = balls.find((b) => b.id === 1)!
    expect(eightBall.x).to.be.above(apex.x)
    expect(Math.abs(eightBall.y)).to.be.below(0.001)
    const backRow = balls
      .filter((b) => b.id > 0)
      .sort((a, b) => b.x - a.x)
      .slice(0, 5)
      .sort((a, b) => a.y - b.y)
    const groups = [backRow[0], backRow[4]].map((b) =>
      b.id <= 7 ? "solids" : "stripes"
    )
    expect(groups[0]).to.not.equal(groups[1])
  })

  it("spots a ball on the foot spot or behind it when the spot is taken", () => {
    const state = createMatch(base)
    const foot = state.balls.find((b) => b.id === 9)!
    // the 9 is pocketed, then spotted back: the spot is free
    const down = state.balls.map((b) =>
      b.id === 9 ? { ...b, pocketed: true } : b
    )
    const back = spotBall(down, 9).find((b) => b.id === 9)!
    expect(back.pocketed).to.be.undefined
    expect(Math.abs(back.x - foot.x)).to.be.below(0.001)
    // with the 9 sitting on the spot, a spotted 1 goes behind it
    const spotted = spotBall(
      state.balls.map((b) => (b.id === 1 ? { ...b, pocketed: true } : b)),
      1
    ).find((b) => b.id === 1)!
    expect(spotted.x).to.be.above(foot.x)
    expect(spotted.y).to.equal(0)
  })
})

describe("engine pool ball in hand", () => {
  it("accepts a placement behind the head string and refuses one past it", () => {
    const state = createMatch(base)
    expect(
      code(state, 0, { type: "placeBall", shotNo: 1, pos: { x: -1.0, y: 0.1 } })
    ).to.equal("ok")
    expect(
      code(state, 0, { type: "placeBall", shotNo: 1, pos: { x: 0.0, y: 0.1 } })
    ).to.equal("ILLEGAL_PLACEMENT:kitchen")
    expect(
      code(state, 0, { type: "placeBall", shotNo: 1, pos: { x: -9, y: 0 } })
    ).to.equal("ILLEGAL_PLACEMENT:offTable")
    expect(
      code(state, 0, { type: "placeBall", shotNo: 1, pos: { x: NaN, y: 0 } })
    ).to.equal("VALIDATION_FAILED:pos")
  })

  it("refuses a spot on another ball and placing when not in hand", () => {
    const state = createMatch(base)
    const one = state.balls.find((b) => b.id === 1)!
    state.pool!.ballInHand = "anywhere"
    expect(
      code(state, 0, {
        type: "placeBall",
        shotNo: 1,
        pos: { x: one.x, y: one.y },
      })
    ).to.equal("ILLEGAL_PLACEMENT:overlap")
    state.pool!.ballInHand = "none"
    expect(
      code(state, 0, { type: "placeBall", shotNo: 1, pos: { x: -1, y: 0 } })
    ).to.equal("ILLEGAL_ACTION:placeBall")
  })

  it("will not play the break from past the head string", () => {
    const state = createMatch(base)
    state.balls[0] = { id: 0, x: 0.2, y: 0.3 }
    expect(code(state, 0, { type: "shoot", shotNo: 1, shot: soft })).to.equal(
      "ILLEGAL_PLACEMENT:kitchen"
    )
  })
})

describe("engine nine ball", () => {
  const vectors = nine.vectors as any[]

  it("the break must drive four balls to a rail or pocket one", () => {
    const v = shotVector(
      vectors,
      (s, x) => x.state.pool.breakShot && s.outcome.foul === "badBreak"
    )
    expect(v.expected.state.pool.ballInHand).to.equal("anywhere")
    expect(v.expected.state.turnSeat).to.equal(v.seat === 0 ? 1 : 0)
  })

  it("the lowest ball must be hit first; a foul gives ball in hand", () => {
    const v = shotVector(vectors, (s) => s.outcome.foul === "wrongBallFirst")
    expect(v.expected.state.pool.ballInHand).to.equal("anywhere")
    expect(v.expected.state.pool.fouls[v.seat]).to.equal(
      v.state.pool.fouls[v.seat] + 1
    )
  })

  it("a scratch is a foul and the cue ball waits on the head spot in hand", () => {
    const v = shotVector(vectors, (s) => s.outcome.foul === "scratch")
    const cue = v.expected.state.balls[0]
    expect(cue.pocketed).to.be.undefined
    expect(v.expected.state.pool.ballInHand).to.equal("anywhere")
  })

  it("three fouls in a row lose the rack", () => {
    const v = shotVector(vectors, (s) => s.outcome.foul === "threeFouls")
    expect(v.expected.events.map((e) => e.type)).to.include("rackEnd")
    expect(v.expected.events[0].outcome.rack).to.equal(false)
  })

  it("pocketing the 9 legally wins the rack and breaks alternate", () => {
    const v = shotVector(
      vectors,
      (s) => s.outcome.rack === true && s.outcome.pocketed.includes(9)
    )
    const next = v.expected.state
    if (next.phase === "playing") {
      expect(next.pool.breaker).to.equal(v.state.pool.breaker === 0 ? 1 : 0)
      expect(next.pool.breakShot).to.equal(true)
      expect(next.balls.filter((b) => b.pocketed)).to.have.lengthOf(0)
    }
  })

  it("a legal pot keeps the table; a dry shot passes it as the balls lie", () => {
    const pot = shotVector(
      vectors,
      (s, x) =>
        !x.state.pool.breakShot &&
        s.outcome.foul === null &&
        s.outcome.points > 0 &&
        s.outcome.rack === undefined
    )
    expect(pot.expected.state.turnSeat).to.equal(pot.seat)
    const dry = shotVector(
      vectors,
      (s, x) =>
        !x.state.pool.breakShot &&
        s.outcome.foul === null &&
        s.outcome.pocketed.length === 0 &&
        !x.state.pool.pushOutAvailable
    )
    expect(dry.expected.state.turnSeat).to.equal(dry.seat === 0 ? 1 : 0)
    expect(dry.expected.state.pool.ballInHand).to.equal("none")
  })

  it("a push-out suspends the usual fouls and hands the opponent the choice", () => {
    const state = createMatch(base)
    state.pool!.breakShot = false
    state.pool!.ballInHand = "none"
    state.pool!.pushOutAvailable = true
    // too soft to reach anything: a foul on any ordinary shot, fine as a push-out
    const plain = apply(state, 0, { type: "shoot", shotNo: 1, shot: soft })
    const plainShot = plain.events[0]
    if (plainShot.type !== "shot") throw new Error()
    expect(plainShot.outcome.foul).to.equal("noBall")
    const pushed = apply(state, 0, {
      type: "shoot",
      shotNo: 1,
      shot: soft,
      pushOut: true,
    })
    const shot = pushed.events[0]
    if (shot.type !== "shot") throw new Error()
    expect(shot.outcome.foul).to.be.null
    const after = pushed.state
    expect(after.pool!.pendingChoice).to.deep.include({
      kind: "pushOut",
      seat: 1,
    })
    expect(after.pool!.pendingChoice!.options).to.deep.equal(["shoot", "pass"])
    expect(after.turnSeat).to.equal(1)
    expect(
      code(after, 1, { type: "shoot", shotNo: after.shotNo, shot: soft })
    ).to.equal("ILLEGAL_ACTION:choice")
    const pass = apply(after, 1, {
      type: "choice",
      shotNo: after.shotNo,
      option: "pass",
    })
    expect(pass.state.turnSeat).to.equal(0)
    expect(pass.state.pool!.pendingChoice).to.be.null
    // without the offer a push-out is refused
    expect(
      code(pass.state, 0, {
        type: "shoot",
        shotNo: pass.state.shotNo,
        shot: soft,
        pushOut: true,
      })
    ).to.equal("ILLEGAL_ACTION:pushOut")
  })

  it("replays every golden vector exactly", () => {
    for (const v of vectors) {
      const got = applyAction(v.state, v.seat, v.action)
      expect(JSON.parse(JSON.stringify(got))).to.deep.equal(v.expected)
    }
  })
})

describe("engine eight ball", () => {
  const vectors = eight.vectors as any[]

  it("a shot needs a call first", () => {
    const v = vectors.find(
      (x) =>
        x.action.type === "shoot" &&
        !x.expected.ok &&
        x.expected.reason === "call"
    )
    expect(v).to.not.be.undefined
  })

  it("the first legally pocketed called ball decides the groups", () => {
    const v = shotVector(
      vectors,
      (s, x) =>
        x.state.pool.open &&
        !x.state.pool.breakShot &&
        s.outcome.points > 0 &&
        s.outcome.foul === null
    )
    const groups = v.expected.state.pool.groups
    expect(v.expected.state.pool.open).to.equal(false)
    expect(groups[0]).to.not.equal(groups[1])
    expect(groups[v.seat]).to.equal(
      v.state.pool.call.ball <= 7 ? "solids" : "stripes"
    )
  })

  it("a weak break gives the opponent three options", () => {
    const v = shotVector(vectors, (s) => s.outcome.foul === "badBreak")
    expect(v.expected.state.pool.pendingChoice).to.deep.include({
      kind: "illegalBreak",
    })
    expect(v.expected.state.pool.pendingChoice.options).to.deep.equal([
      "accept",
      "rerackBreak",
      "rerackOffenderBreaks",
    ])
    const rerack = apply(v.expected.state, v.expected.state.turnSeat, {
      type: "choice",
      shotNo: v.expected.state.shotNo,
      option: "rerackBreak",
    })
    expect(rerack.state.pool.breakShot).to.equal(true)
    expect(rerack.state.pool.breaker).to.equal(v.seat === 0 ? 1 : 0)
    expect(rerack.events.map((e) => e.type)).to.deep.equal(["position", "turn"])
  })

  it("the 8 decides the rack: a called 8 in its pocket wins, anything else loses", () => {
    const won = shotVector(vectors, (s) => s.outcome.rack === true)
    expect(won.state.pool.call).to.deep.include({ ball: 8 })
    const lost = vectors.find(
      (x) =>
        x.expected.ok &&
        x.expected.events[0]?.type === "shot" &&
        x.expected.events[0].outcome.rack === false
    )
    if (lost) {
      expect(lost.expected.events[0].outcome.pocketed).to.include(8)
    }
  })

  it("a safety passes play even when a ball drops", () => {
    const v = shotVector(
      vectors,
      (s, x) =>
        x.state.pool.call === "safety" &&
        s.outcome.foul === null &&
        s.outcome.rack === undefined
    )
    expect(v.expected.state.turnSeat).to.equal(v.seat === 0 ? 1 : 0)
  })

  it("replays every golden vector exactly", () => {
    for (const v of vectors) {
      const got = applyAction(v.state, v.seat, v.action)
      expect(JSON.parse(JSON.stringify(got))).to.deep.equal(v.expected)
    }
  })
})
