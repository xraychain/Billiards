import { expect } from "chai"
import { applyAction, createMatch, SHOT_LIMITS } from "../../src/engine"
import { saguRules } from "../../src/engine/rules/sagu"
import { Action, MatchConfig, MatchState, Shot } from "../../src/engine/types"
import golden from "../../vectors/sagu.json"

const config: MatchConfig = {
  ruleType: "sagu",
  raceTo: 3,
  equalizingInning: false,
  tieBreak: "draw",
  extensions: 0,
  timeoutLimit: 0,
  firstSeat: 0,
  seed: "sagu-spec",
}

const soft: Shot = {
  angle: 1,
  power: SHOT_LIMITS.power[0],
  elevation: 0,
  offset: { x: 0, y: 0 },
}

function apply(state: MatchState, seat, action: Action) {
  const r = applyAction(state, seat, action)
  if (!r.ok) throw new Error(`${r.code} ${r.reason ?? ""}`)
  return r
}

const hit = (a: number, b: number) => ({
  type: "collision" as const,
  t: 100,
  a,
  b,
})
const cushion = (a: number) => ({ type: "cushion" as const, t: 50, a })

describe("engine sagu", () => {
  it("racks four balls with no opening rules", () => {
    const state = createMatch(config)
    expect(state.balls.map((b) => b.id)).to.deep.equal([0, 1, 2, 3])
    expect(state.opening).to.equal(false)
    expect(state.frozen).to.deep.equal([])
    // the two reds sit on the head and foot spots, yellow beyond the foot spot
    expect(state.balls[2].x).to.be.below(0)
    expect(state.balls[3].x).to.be.above(0)
    expect(state.balls[1].x).to.be.above(state.balls[3].x)
  })

  it("scores when the cue ball meets both reds", () => {
    const base = { start: [], opening: false, frozen: [], score: 0, target: 3 }
    const judge = (events) =>
      saguRules.judge({ ...base, cueBall: 0, opponentBall: 1, events })
    expect(judge([hit(0, 2), hit(3, 0)])).to.deep.equal({
      points: 1,
      foul: null,
      penalty: 0,
    })
    expect(judge([hit(0, 2), hit(0, 2)]).points).to.equal(0)
  })

  it("touching the opponent's ball or nothing is a foul that costs a point", () => {
    const base = { start: [], opening: false, frozen: [], score: 2, target: 3 }
    const judge = (events) =>
      saguRules.judge({ ...base, cueBall: 1, opponentBall: 0, events })
    expect(judge([hit(1, 2), hit(1, 3), hit(1, 0)])).to.deep.equal({
      points: 0,
      foul: "opponentBall",
      penalty: 1,
    })
    expect(judge([cushion(1), cushion(1)])).to.deep.equal({
      points: 0,
      foul: "noBall",
      penalty: 1,
    })
  })

  it("the winning point must be a three-cushion cannon", () => {
    const base = {
      start: [],
      opening: false,
      frozen: [],
      cueBall: 0,
      opponentBall: 1,
    }
    const plain = [hit(0, 2), hit(0, 3)]
    const threeCushion = [
      cushion(0),
      cushion(0),
      cushion(0),
      hit(0, 2),
      hit(0, 3),
    ]
    expect(
      saguRules.judge({ ...base, score: 1, target: 3, events: plain }).points
    ).to.equal(1)
    expect(
      saguRules.judge({ ...base, score: 2, target: 3, events: plain }).points
    ).to.equal(0)
    expect(
      saguRules.judge({ ...base, score: 2, target: 3, events: threeCushion })
        .points
    ).to.equal(1)
  })

  it("a penalty never takes the score below zero", () => {
    const state = createMatch(config)
    // too soft to reach any ball: a "no ball" foul
    const result = apply(state, 0, { type: "shoot", shotNo: 1, shot: soft })
    const shot = result.events[0]
    if (shot.type !== "shot") throw new Error()
    expect(shot.outcome.foul).to.equal("noBall")
    expect(shot.outcome.penalty).to.equal(1)
    expect(result.state.scores).to.deep.equal([0, 0])
    expect(result.state.turnSeat).to.equal(1)
  })

  it("supports a handicap target per seat", () => {
    const state = createMatch({ ...config, targets: [5, 2] })
    expect(state.config.targets).to.deep.equal([5, 2])
    expect(() => createMatch({ ...config, targets: [0, 2] })).to.throw(
      "targets"
    )
  })

  it("has no respot and no side choice", () => {
    const state = createMatch(config)
    const code = (action) => {
      const r = applyAction(state, 0, action)
      return r.ok ? "ok" : r.code
    }
    expect(code({ type: "respot", shotNo: 1 })).to.equal("ILLEGAL_ACTION")
    expect(
      code({ type: "shoot", shotNo: 1, shot: soft, side: "left" })
    ).to.equal("ILLEGAL_ACTION")
  })

  it("replays every golden vector exactly", () => {
    for (const v of golden.vectors) {
      const got = applyAction(
        v.state as MatchState,
        v.seat as 0 | 1,
        v.action as Action
      )
      expect(JSON.parse(JSON.stringify(got))).to.deep.equal(v.expected)
    }
  })
})
