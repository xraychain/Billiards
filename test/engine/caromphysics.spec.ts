import { shotLimits } from "../../src/engine/common"
import { simulateShot } from "../../src/engine/simulate"
import { tableInfo } from "../../src/engine/rules/threecushion"

/**
 * The carom cushions are tuned so the diamond system holds as players use
 * it: lines run between the diamonds' marks on the cushion, full running
 * side, centre height, medium pace. From the corner (50), a shot at 30 on
 * the far long rail comes round three cushions into the opposite corner.
 */
const LIMITS = shotLimits("threecushion")

describe("carom physics", () => {
  const { ballRadius: R, halfLength, halfWidth } = tableInfo("threecushion")
  const XN = halfLength + R
  const YN = halfWidth + R
  const diamond = (2 * XN) / 8
  const corner = { x: -XN, y: YN }
  const aim = { x: XN - 3 * diamond, y: -YN }

  /** where the ball meets the fourth cushion, in diamonds from the corner */
  function fourth(pace: number) {
    const angle = Math.atan2(aim.y - corner.y, aim.x - corner.x)
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    let s = 0
    while (
      Math.abs(corner.x + dir.x * s) > halfLength ||
      Math.abs(corner.y + dir.y * s) > halfWidth
    ) {
      s += 0.001
    }
    const [min, max] = LIMITS.power
    const result = simulateShot(
      "threecushion",
      [{ id: 0, x: corner.x + dir.x * s, y: corner.y + dir.y * s }],
      0,
      {
        angle,
        power: min + pace * (max - min),
        offset: { x: LIMITS.offsetMax, y: 0 },
        elevation: 0,
      },
      { frameEvery: 1 }
    )
    const cushions = result.events.filter((e) => e.type === "cushion")
    expect(cushions.slice(0, 3).map((e) => e.cushion)).toEqual(["l", "S", "L"])
    const at = result.frames!.find((f) => f.t >= cushions[3].t)!.p
    return cushions[3].cushion === "s"
      ? (at[1] + halfWidth) / ((2 * YN) / 4)
      : (at[0] + halfLength) / diamond
  }

  it("brings the corner shot 50 → 30 into the opposite corner", () => {
    expect(Math.abs(fourth(0.5))).toBeLessThan(0.3)
  })

  it("sends a full-side shot down the long rail back to the far corner", () => {
    const [min, max] = LIMITS.power
    for (const pace of [0.5, 1]) {
      const result = simulateShot(
        "threecushion",
        [{ id: 0, x: -halfLength + 0.06, y: -halfWidth + 0.06 }],
        0,
        {
          angle: 0,
          power: min + pace * (max - min),
          offset: { x: LIMITS.offsetMax, y: 0 },
          elevation: 0,
        },
        { frameEvery: 1 }
      )
      const cushions = result.events.filter((e) => e.type === "cushion")
      expect(cushions[0].cushion).toBe("S")
      // back at the near corner: on either of its cushions, within half a
      // diamond of it
      const at = result.frames!.find((f) => f.t >= cushions[1].t)!.p
      const off =
        cushions[1].cushion === "s"
          ? (halfWidth - at[1]) / ((2 * YN) / 4)
          : (at[0] + halfLength) / diamond
      expect(["s", "L"]).toContain(cushions[1].cushion)
      expect(off).toBeLessThan(0.5)
    }
  })

  it("goes round nine cushions from the corner at full power and full side", () => {
    // near a corner, almost along the long rail and just into it, left side
    const result = simulateShot(
      "threecushion",
      [{ id: 0, x: halfLength - 0.058, y: halfWidth - 0.07 }],
      0,
      {
        angle: (175.9 * Math.PI) / 180,
        power: LIMITS.power[1],
        offset: { x: LIMITS.offsetMax, y: 0 },
        elevation: 0,
      }
    )
    const rails = result.events
      .filter((e) => e.type === "cushion")
      .map((e) => (e.cushion === "L" || e.cushion === "l" ? "U" : "K"))
      .join("")
    expect(rails).toBe("UKUKUKUUK")
    // stops in the quarter of the table it started from
    const end = result.final[0]
    expect((halfLength - end.x) / (2 * halfLength)).toBeLessThan(0.25)
  })
})
