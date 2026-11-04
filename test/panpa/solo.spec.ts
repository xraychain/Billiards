import { expect } from "chai"
import { applyAction, createMatch, SHOT_LIMITS } from "../../src/engine"
import { Action, MatchConfig, MatchState, Shot } from "../../src/engine/types"
import { stayAtTable } from "../../src/panpa/solo"

const config: MatchConfig = {
  ruleType: "threecushion",
  raceTo: 10,
  equalizingInning: false,
  tieBreak: "draw",
  extensions: 0,
  timeoutLimit: 0,
  firstSeat: 0,
  seed: "solo-spec",
}

/** too soft to reach anything: a plain miss */
const miss: Shot = {
  angle: 1,
  power: SHOT_LIMITS.power[0],
  elevation: 0,
  offset: { x: 0, y: 0 },
}

function play(state: MatchState, action: Action) {
  const r = applyAction(state, state.turnSeat, action)
  if (!r.ok) throw new Error(r.code)
  stayAtTable(state.turnSeat, r.state, r.events)
  return r
}

describe("panpa solo practice", () => {
  it("a miss ends the inning but the player keeps the white ball", () => {
    const state = createMatch(config)
    const r = play(state, { type: "shoot", shotNo: 1, shot: miss })
    expect(r.state.turnSeat).to.equal(0)
    expect(r.state.innings).to.deep.equal([1, 0])
    const turn = r.events.find((e) => e.type === "turn")
    expect(turn).to.deep.include({ seat: 0 })
    // and the next shot is the player's again
    const next = play(r.state, {
      type: "shoot",
      shotNo: r.state.shotNo,
      shot: miss,
    })
    expect(next.state.innings).to.deep.equal([2, 0])
    expect(next.state.turnSeat).to.equal(0)
  })

  it("after a time foul the white ball is set up on the starting position", () => {
    const state = createMatch(config)
    const r = play(state, { type: "timeout" })
    expect(r.state.turnSeat).to.equal(0)
    expect(r.state.opening).to.equal(true)
    const position = r.events.find((e) => e.type === "position")
    if (!position || position.type !== "position") throw new Error()
    expect(position.balls).to.deep.equal(r.state.balls)
    // the white ball (the player's) is the one on a side starting spot
    expect(Math.abs(r.state.balls[0].y)).to.be.above(0.1)
    expect(Math.abs(r.state.balls[1].y)).to.be.below(0.01)
  })

  it("pool: decisions and the next rack stay with the player", () => {
    const state = createMatch({ ...config, ruleType: "nineball", raceTo: 3 })
    state.pool!.breakShot = false
    state.pool!.ballInHand = "none"
    state.pool!.pushOutAvailable = true
    const r = play(state, {
      type: "shoot",
      shotNo: 1,
      shot: miss,
      pushOut: true,
    })
    expect(r.state.turnSeat).to.equal(0)
    expect(r.state.pool!.pendingChoice).to.deep.include({ seat: 0 })
    const choice = play(r.state, {
      type: "choice",
      shotNo: r.state.shotNo,
      option: "pass",
    })
    expect(choice.state.turnSeat).to.equal(0)
  })
})
