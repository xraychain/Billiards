import { R } from "../../model/physics/constants"
import { TableGeometry } from "../../view/tablegeometry"
import { configure } from "../configure"
import { seededRandom } from "../random"
import { BallState, Foul, OutcomeEvent, Side, Vec2 } from "../types"

export const RED = 2

/** Gap below which two balls, or a ball and a cushion, count as touching. */
const contactGap = () => R * 0.004

/** A first contact this soon after the strike was played straight into it. */
const DIRECT_MS = 30

/**
 * UMB spots, in table coordinates (x along the table, red at +x).
 * The side starting spots are 182.5 mm from the centre of the starting line
 * on a table whose balls have a 30.75 mm radius; the engine's table is
 * dimensioned in ball radii, so the distance scales with R.
 */
function spots() {
  const head = -TableGeometry.X / 2
  return {
    top: { x: TableGeometry.X / 2, y: 0 },
    centre: { x: 0, y: 0 },
    start: { x: head, y: 0 },
    side: (182.5 / 30.75) * R,
  }
}

function sideSign(side: Side): number {
  return side === "left" ? 1 : -1
}

/**
 * Starting position for `shooter` (art. 23): red on the top spot, the
 * opponent's ball on the centre of the starting line, the shooter's ball on
 * a side starting spot. Each ball is nudged by a seeded jitter well under a
 * millimetre, standing in for placement by hand.
 */
export function startingPosition(
  seed: string,
  rackNo: number,
  shooterBall: number,
  side: Side = "right"
): BallState[] {
  configure("threecushion")
  const random = seededRandom(`${seed}#${rackNo}`)
  const noise = R * 0.023 + 0.00075
  const jitter = (v: number) => Math.fround(v + noise * (random() - 0.5))
  const s = spots()
  const opponentBall = shooterBall === 0 ? 1 : 0
  const at: Vec2[] = []
  at[shooterBall] = { x: s.start.x, y: sideSign(side) * s.side }
  at[opponentBall] = s.start
  at[RED] = s.top
  return at.map((p, id) => ({ id, x: jitter(p.x), y: jitter(p.y) }))
}

/** Move the shooter's ball to the other side starting spot. */
export function chooseSide(
  balls: BallState[],
  shooterBall: number,
  side: Side
): BallState[] {
  return balls.map((b) =>
    b.id === shooterBall
      ? { id: b.id, x: b.x, y: Math.fround(sideSign(side) * Math.abs(b.y)) }
      : b
  )
}

/** Object balls touching the given cue ball. */
export function frozenTo(balls: BallState[], cueBall: number): number[] {
  configure("threecushion")
  const c = balls[cueBall]
  return balls
    .filter(
      (b) =>
        b.id !== cueBall &&
        Math.hypot(b.x - c.x, b.y - c.y) - 2 * R <= contactGap()
    )
    .map((b) => b.id)
}

function touchesCushion(ball: BallState): boolean {
  return (
    TableGeometry.tableX - Math.abs(ball.x) <= contactGap() ||
    TableGeometry.tableY - Math.abs(ball.y) <= contactGap()
  )
}

/**
 * Art. 27.3 b: only the balls in contact go back on spots: red on the top
 * spot, the shooter's ball on the centre of the starting line, the
 * opponent's ball on the centre spot. If a ball that stays where it is
 * covers the spot, the respotted ball takes that ball's spot instead.
 */
export function respot(
  balls: BallState[],
  shooterBall: number,
  frozen: number[]
): BallState[] {
  configure("threecushion")
  const s = spots()
  const spotOf = (id: number): Vec2 => {
    if (id === RED) return s.top
    return id === shooterBall ? s.start : s.centre
  }
  const moving = new Set([shooterBall, ...frozen])
  const staying = balls.filter((b) => !moving.has(b.id))
  const covering = (p: Vec2) =>
    staying.find((b) => Math.hypot(b.x - p.x, b.y - p.y) < 2 * R)
  return balls.map((b) => {
    if (!moving.has(b.id)) {
      return b
    }
    let spot = spotOf(b.id)
    const blocker = covering(spot)
    if (blocker) {
      spot = spotOf(blocker.id)
    }
    return { id: b.id, x: Math.fround(spot.x), y: Math.fround(spot.y) }
  })
}

/**
 * Fouls a referee would call from how the shot began. `start` and `frozen`
 * describe the table before the strike.
 */
export function foul(
  cueBall: number,
  events: OutcomeEvent[],
  start: BallState[],
  opening: boolean,
  frozen: number[]
): Foul | null {
  const first = events.find(
    (e) => e.a === cueBall || (e.type === "collision" && e.b === cueBall)
  )
  if (!first) {
    return null
  }
  let hitBall = -1
  if (first.type === "collision") {
    hitBall = first.a === cueBall ? first.b! : first.a
  }
  if (opening && hitBall !== RED) {
    return "redFirst"
  }
  if (first.t > DIRECT_MS) {
    return null
  }
  if (frozen.includes(hitBall)) {
    return "ballInContact"
  }
  if (first.type === "cushion" && touchesCushion(start[cueBall])) {
    return "cushionInContact"
  }
  return null
}

/**
 * Art. 83: a cannon counts when the cue ball has touched cushions at least
 * three times before it first touches the second object ball.
 */
export function isPoint(cueBall: number, events: OutcomeEvent[]): boolean {
  const hit = new Set<number>()
  let cushions = 0
  for (const e of events) {
    if (e.type === "cushion") {
      if (e.a === cueBall) {
        cushions++
      }
      continue
    }
    if (e.a !== cueBall && e.b !== cueBall) {
      continue
    }
    hit.add(e.a === cueBall ? e.b! : e.a)
    if (hit.size === 2) {
      return cushions >= 3
    }
  }
  return false
}

/** Dimensions a client needs to draw the table, in engine units. */
export function tableInfo() {
  configure("threecushion")
  const s = spots()
  return {
    ballRadius: R,
    /** half extents of the area ball centres can reach */
    halfLength: TableGeometry.tableX,
    halfWidth: TableGeometry.tableY,
    spots: { top: s.top, centre: s.centre, start: s.start, side: s.side },
  }
}
