import { Vector3 } from "three"
import { Ball, State } from "../model/ball"
import { PocketGeometry } from "../view/pocketgeometry"
import { Headless } from "../model/headless"
import { OutcomeType } from "../model/outcome"
import { cueStrike, mathavanAdapter } from "../model/physics/physics"
import { Table } from "../model/table"
import { R } from "../model/physics/constants"
import { configure } from "./configure"
import {
  BallState,
  Frame,
  OutcomeEvent,
  RuleType,
  Shot,
  SimResult,
} from "./types"

/** Fixed physics step in seconds; the same step the browser game uses. */
export const STEP = 0.001953125

/** Simulated time after which a shot is cut short and the balls are halted. */
export const MAX_SHOT_MS = 90_000

export interface SimOptions {
  /** record a frame every `frameEvery` steps (0 = no frames) */
  frameEvery?: number
}

function frame(table: Table): Frame {
  const p: number[] = []
  for (const b of table.balls) {
    p.push(b.pos.x, b.pos.y)
  }
  return { t: table.time, p }
}

function toEvents(table: Table): OutcomeEvent[] {
  const events: OutcomeEvent[] = []
  for (const o of table.outcome) {
    if (o.type === OutcomeType.Pot) {
      const ball = o.ballA!
      const pocket = PocketGeometry.pocketCenters.indexOf(ball.pocket)
      const e: OutcomeEvent = { type: "pot", t: o.timestamp, a: ball.id }
      if (pocket >= 0) {
        e.pocket = pocket
      }
      events.push(e)
    } else if (o.type === OutcomeType.Collision) {
      events.push({
        type: "collision",
        t: o.timestamp,
        a: o.ballA!.id,
        b: o.ballB!.id,
      })
    } else if (o.type === OutcomeType.Cushion) {
      const e: OutcomeEvent = {
        type: "cushion",
        t: o.timestamp,
        a: o.ballA!.id,
      }
      if (o.cushion) {
        e.cushion = o.cushion
      }
      events.push(e)
    }
  }
  return events
}

function headlessTable(balls: BallState[]): Table {
  const before = Headless.on
  Headless.on = true
  try {
    Ball.id = 0
    const table = new Table(
      balls.map((b) => new Ball(new Vector3(b.x, b.y, 0), 0xffffff))
    )
    // pocketed balls take no part: parked below the slate, out of play
    balls.forEach((b, i) => {
      if (b.pocketed) {
        table.balls[i].pos.z = -10 * R
        table.balls[i].state = State.InPocket
      }
    })
    return table
  } finally {
    Headless.on = before
  }
}

/**
 * Play one shot to rest. Deterministic: the same inputs give the same
 * result on every call. Throws if the collision resolver cannot settle.
 */
export function simulateShot(
  ruleType: RuleType,
  balls: BallState[],
  cueBall: number,
  shot: Shot,
  options: SimOptions = {}
): SimResult {
  configure(ruleType)

  const table = headlessTable(balls)
  table.cushionModel = mathavanAdapter
  table.cueball = table.balls[cueBall]

  const strike = cueStrike(
    shot.angle,
    shot.power,
    new Vector3(shot.offset.x, shot.offset.y, 0),
    shot.elevation
  )
  table.time = 0
  table.cueball.state = State.Sliding
  table.cueball.vel.copy(strike.vel)
  table.cueball.rvel.copy(strike.rvel)

  const frameEvery = options.frameEvery ?? 0
  const frames: Frame[] = frameEvery > 0 ? [frame(table)] : []
  let steps = 0
  while (!table.allStationary()) {
    if (table.time >= MAX_SHOT_MS) {
      table.halt()
      break
    }
    table.advance(STEP)
    steps++
    if (frameEvery > 0 && steps % frameEvery === 0) {
      frames.push(frame(table))
    }
  }
  if (frameEvery > 0 && steps % frameEvery !== 0) {
    frames.push(frame(table))
  }

  const result: SimResult = {
    final: table.balls.map((b) =>
      b.onTable()
        ? { id: b.id, x: b.pos.x, y: b.pos.y }
        : { id: b.id, x: b.pos.x, y: b.pos.y, pocketed: true }
    ),
    durationMs: table.time,
    events: toEvents(table),
    steps,
  }
  if (frameEvery > 0) {
    result.frames = frames
  }
  return result
}
