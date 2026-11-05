import { SHOT_LIMITS } from "../../src/engine/common"
import { simulateShot } from "../../src/engine/simulate"
import { BallState } from "../../src/engine/types"
import { tableInfo } from "../../src/engine/rules/threecushion"
import { cushionDistance, strokeOffsetY, strokeY } from "../../src/panpa/stroke"

const MAX = SHOT_LIMITS.offsetMax

describe("strokeOffsetY", () => {
  it("leaves a normal stroke to the pad", () => {
    expect(strokeOffsetY("normal", 1, 2, 0, MAX)).toBeNull()
  })

  it("rolls a follow stroke from the strike, inside the tip's reach", () => {
    expect(strokeOffsetY("follow", 1, 2, 0, MAX)).toBeCloseTo(0.4)
    const y = strokeOffsetY("follow", 1, 2, 0.3, MAX)!
    expect(Math.hypot(0.3, y)).toBeLessThanOrEqual(MAX + 1e-9)
  })

  it("draws more for a stop the further and slower the shot", () => {
    const near = strokeOffsetY("stop", 0.3, 3, 0, MAX)!
    const far = strokeOffsetY("stop", 1.2, 3, 0, MAX)!
    const slow = strokeOffsetY("stop", 0.3, 1.5, 0, MAX)!
    expect(near).toBeLessThan(0)
    expect(far).toBeLessThan(near)
    expect(slow).toBeLessThan(near)
    expect(strokeOffsetY("stop", 0, 3, 0, MAX)).toBeCloseTo(0)
  })

  it("never asks for more than the tip can reach", () => {
    const y = strokeOffsetY("stop", 2.5, 0.5, 0.2, MAX)!
    expect(Math.hypot(0.2, y)).toBeLessThanOrEqual(MAX + 1e-9)
  })
})

describe("strokeY", () => {
  const play = (stroke: "normal" | "follow" | "stop", padY: number) =>
    strokeY(stroke, padY, 0.8, 2.5, 0, MAX)

  it("plays the pad's point on a normal stroke", () => {
    expect(play("normal", -0.2)).toBeCloseTo(-0.2)
  })

  it("rolls a follow, keeping extra follow and leaving a draw shot alone", () => {
    expect(play("follow", 0)).toBeCloseTo(0.4)
    expect(play("follow", 0.45)).toBeCloseTo(0.45)
    expect(play("follow", -0.3)).toBeCloseTo(-0.3)
  })

  it("takes the follow away on a stop, keeping a deeper draw", () => {
    const stop = strokeOffsetY("stop", 0.8, 2.5, 0, MAX)!
    expect(play("stop", 0.3)).toBeCloseTo(stop)
    expect(play("stop", 0)).toBeCloseTo(stop)
    expect(play("stop", -0.44)).toBeCloseTo(-0.44)
  })
})

describe("cushionDistance", () => {
  it("measures along the line to the first cushion", () => {
    expect(
      cushionDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.4, 0.7)
    ).toBeCloseTo(1.4)
    const d = Math.SQRT1_2
    expect(
      cushionDistance({ x: 0, y: 0 }, { x: d, y: d }, 1.4, 0.7)
    ).toBeCloseTo(0.7 / d)
  })
})

describe("strokes on the table", () => {
  /** a straight, full hit: how far the cue ball runs on after the contact */
  function runOn(stroke: "follow" | "stop" | "normal", gap: number) {
    const { ballRadius: R } = tableInfo("threecushion")
    const balls: BallState[] = [
      { id: 0, x: -0.6, y: 0 },
      { id: 1, x: -0.6 + gap + 2 * R, y: 0.0 },
      { id: 2, x: -1.2, y: 0.55 },
    ]
    const power = 2.5
    const y = strokeOffsetY(stroke, gap, power, 0, MAX) ?? 0
    const result = simulateShot(
      "threecushion",
      balls,
      0,
      { angle: 0, power, offset: { x: 0, y }, elevation: 0 },
      { frameEvery: 1 }
    )
    const hit = result.events.find((e) => e.type === "collision")!
    const at = (t: number) =>
      result.frames!.find((f) => f.t >= t) ?? result.frames!.at(-1)!
    // before the object ball can come back off the cushion
    return at(hit.t + 500).p[0] - at(hit.t).p[0]
  }

  it("a stop leaves the cue ball where it met the object ball", () => {
    // within reach of the draw a tip can give at this pace
    for (const gap of [0.3, 0.6]) {
      expect(Math.abs(runOn("stop", gap))).toBeLessThan(0.05)
    }
  })

  it("a follow runs through after the object ball", () => {
    for (const gap of [0.3, 0.8]) {
      expect(runOn("follow", gap)).toBeGreaterThan(0.15)
    }
    // close in, a centre hit still slides: the follow stroke is what rolls it
    expect(runOn("follow", 0.3)).toBeGreaterThan(runOn("normal", 0.3) + 0.08)
  })
})
