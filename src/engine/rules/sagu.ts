import { R } from "../../model/physics/constants"
import { TableGeometry } from "../../view/tablegeometry"
import { configure } from "../configure"
import { seededRandom } from "../random"
import { BallState, OutcomeEvent } from "../types"
import { CaromRules, Judgement } from "./carom"
import { isPoint } from "./threecushion"

/** Ball ids: 0 white, 1 yellow, 2 and 3 red. */
const REDS = [2, 3]

/**
 * Korean four-ball (sagu) as commonly played: white and yellow are the
 * cue balls, a cannon on both reds scores, touching the opponent's cue
 * ball or missing every ball is a foul that costs a point, and the point
 * that wins the match must be made as a three-cushion shot.
 */
function startingPosition(seed: string, rackNo: number): BallState[] {
  configure("sagu")
  const random = seededRandom(`${seed}#${rackNo}`)
  const noise = R * 0.023 + 0.00075
  const jitter = (v: number) => Math.fround(v + noise * (random() - 0.5))
  const dx = TableGeometry.X / 2
  const dy = TableGeometry.Y / 4
  const at = [
    [-dx, -dy],
    [dx * 1.5, 0],
    [-dx, 0],
    [dx, 0],
  ]
  return at.map(([x, y], id) => ({ id, x: jitter(x), y: jitter(y) }))
}

function contacts(cueBall: number, events: OutcomeEvent[]): number[] {
  const hit: number[] = []
  for (const e of events) {
    if (e.type !== "collision") continue
    if (e.a === cueBall) hit.push(e.b!)
    else if (e.b === cueBall) hit.push(e.a)
  }
  return hit
}

function judge({
  cueBall,
  opponentBall,
  events,
  score,
  target,
}: {
  cueBall: number
  opponentBall: number
  events: OutcomeEvent[]
  score: number
  target: number
}): Judgement {
  const hit = contacts(cueBall, events)
  if (hit.includes(opponentBall)) {
    return { points: 0, foul: "opponentBall", penalty: 1 }
  }
  if (hit.length === 0) {
    return { points: 0, foul: "noBall", penalty: 1 }
  }
  const bothReds = REDS.every((red) => hit.includes(red))
  if (!bothReds) {
    return { points: 0, foul: null, penalty: 0 }
  }
  // the winning point has to be a three-cushion cannon
  const lastPoint = score === target - 1
  const points = !lastPoint || isPoint(cueBall, events) ? 1 : 0
  return { points, foul: null, penalty: 0 }
}

export const saguRules: CaromRules = {
  ruleType: "sagu",
  ballCount: 4,
  openingRules: false,
  contactRules: false,
  startingPosition: (seed, rackNo) => startingPosition(seed, rackNo),
  judge,
  aimTargets: () => REDS,
}
