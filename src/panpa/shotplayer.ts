import { Vector3 } from "three"
import { configure } from "../engine/configure"
import { R } from "../model/physics/constants"

function configureRadius(ruleType: RuleType): number {
  configure(ruleType)
  return R
}
import { MAX_SHOT_MS, STEP } from "../engine/simulate"
import { BallState, RuleType, Shot } from "../engine/types"
import { Ball, State } from "../model/ball"
import { cueStrike, mathavanAdapter } from "../model/physics/physics"
import { Table } from "../model/table"

import { Rack } from "../utils/rack"

/** carom: white, yellow, red (and a second red for sagu) */
const CAROM_COLOURS = [0xffffff, 0xffd700, 0xdd1111, 0xdd1111]

/**
 * The table the player watches. It replays a shot in real time with exactly
 * the steps the engine takes when it simulates the same shot in one go, so
 * the balls come to rest where the engine (and the server) says they do.
 */
export class ShotPlayer {
  readonly table: Table
  private carry = 0
  playing = false

  constructor(
    readonly ruleType: RuleType,
    balls: BallState[],
    textured: boolean
  ) {
    configure(ruleType)
    Ball.id = 0
    const pool = ruleType === "nineball" || ruleType === "eightball"
    const plain = textured ? "texturedDots" : "dotted"
    const make = (b: BallState): Ball => {
      const pos = new Vector3(b.x, b.y, 0)
      if (pool && b.id > 0) {
        // numbered pool ball
        return new Ball(pos, Rack.BALL_COLORS[b.id], b.id)
      }
      const colour = pool ? 0xffffff : CAROM_COLOURS[b.id]
      return new Ball(pos, colour, undefined, plain)
    }
    // table.balls[id] must be the ball with that id
    const ordered = balls.slice().sort((a, b) => a.id - b.id)
    this.table = new Table(ordered.map(make))
    this.table.cushionModel = mathavanAdapter
    this.place(balls)
  }

  /** Put the balls at rest on the given places. */
  place(balls: BallState[]) {
    this.playing = false
    const R = this.radius()
    for (const b of balls) {
      const ball = this.table.balls[b.id]
      ball.setStationary()
      if (b.pocketed) {
        ball.pos.set(b.x, b.y, -10 * R)
        ball.state = State.InPocket
      } else {
        ball.pos.set(b.x, b.y, 0)
      }
    }
    this.table.outcome = []
  }

  private radius(): number {
    return configureRadius(this.ruleType)
  }

  positions(): BallState[] {
    return this.table.balls.map((b) =>
      b.onTable()
        ? { id: b.id, x: b.pos.x, y: b.pos.y }
        : { id: b.id, x: b.pos.x, y: b.pos.y, pocketed: true }
    )
  }

  /** Move one ball at rest (placing by hand). */
  moveBall(id: number, x: number, y: number) {
    const ball = this.table.balls[id]
    ball.pos.set(x, y, 0)
    ball.setStationary()
  }

  strike(start: BallState[], cueBall: number, shot: Shot) {
    this.place(start)
    const table = this.table
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
    this.carry = 0
    this.playing = true
  }

  /**
   * Advance by `seconds` of wall time. Returns true on the call in which
   * the balls came to rest.
   */
  advance(seconds: number): boolean {
    if (!this.playing) {
      return false
    }
    const table = this.table
    this.carry += seconds
    while (this.carry >= STEP) {
      if (table.allStationary()) {
        break
      }
      if (table.time >= MAX_SHOT_MS) {
        table.halt()
        break
      }
      table.advance(STEP)
      this.carry -= STEP
    }
    if (table.allStationary()) {
      this.playing = false
      return true
    }
    return false
  }

  /** Largest distance between where a ball is and where it should be. */
  deviation(expected: BallState[]): number {
    let worst = 0
    for (const e of expected) {
      const b = this.table.balls[e.id]
      worst = Math.max(worst, Math.hypot(b.pos.x - e.x, b.pos.y - e.y))
    }
    return worst
  }
}
