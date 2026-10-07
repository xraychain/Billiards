import { expect } from "chai"
import { MatchState } from "../../src/engine/types"
import { selfCheck } from "../../src/panpa/selfcheck"
import { ShotPlayer } from "../../src/panpa/shotplayer"
import golden from "../../vectors/threecushion.json"

describe("panpa shot player", () => {
  const shots = (golden.vectors as any[])
    .filter((v) => v.expected.ok && v.expected.events[0].type === "shot")
    .filter((_, i) => i % 25 === 0)
    .map((v) => v.expected.events[0])

  it("comes to rest exactly where the engine says, in uneven frames", () => {
    const player = new ShotPlayer("threecushion", shots[0].start, false)
    // frame times a display would produce: 60 Hz, a hitch, 120 Hz
    const frames = [1 / 60, 0.1, 1 / 120, 0.033, 0.0041]
    for (const shot of shots) {
      player.strike(shot.start, shot.cueBall, shot.shot)
      let rested = false
      for (let i = 0; i < 200000 && !rested; i++) {
        rested = player.advance(frames[i % frames.length])
      }
      expect(rested).to.equal(true)
      expect(player.deviation(shot.final)).to.equal(0)
      expect(player.positions()).to.deep.equal(shot.final)
    }
  })

  it("places balls at rest", () => {
    const player = new ShotPlayer("threecushion", shots[0].start, false)
    player.strike(shots[0].start, shots[0].cueBall, shots[0].shot)
    player.advance(0.2)
    player.place(shots[1].start)
    expect(player.playing).to.equal(false)
    expect(player.positions()).to.deep.equal(shots[1].start)
    expect(player.advance(1)).to.equal(false)
  })

  it("the device self-check passes on the reference engine", () => {
    expect(selfCheck()).to.equal(true)
  })

  it("self-check data is a valid match state", () => {
    const state = (golden.vectors[0] as any).state as MatchState
    expect(state.v).to.equal(2)
  })
})
