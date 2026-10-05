import { Vector3 } from "three"
import { configure } from "../engine/configure"
import { MAX_SHOT_MS, STEP } from "../engine/simulate"
import { BallState, Shot } from "../engine/types"
import { Ball, State } from "../model/ball"
import { cueStrike, mathavanAdapter } from "../model/physics/physics"
import { Table } from "../model/table"

const COLOURS = [0xffffff, 0xffd700, 0xdd1111]

/**
 * The table the player watches. It replays a shot in real time with exactly
 * the steps the engine takes when it simulates the same shot in one go, so
 * the balls come to rest where the engine (and the server) says they do.
 */
export class ShotPlayer {
  readonly table: Table
  private carry = 0
  playing = false

  constructor(balls: BallState[], textured: boolean) {
    configure("threecushion")
    Ball.id = 0
    this.table = new Table(
      balls.map(
        (b) =>
          new Ball(
            new Vector3(b.x, b.y, 0),
            COLOURS[b.id],
            undefined,
            textured ? "texturedDots" : "dotted"
          )
      )
    )
    this.table.cushionModel = mathavanAdapter
  }

  /** Put the balls at rest on the given places. */
  place(balls: BallState[]) {
    this.playing = false
    for (const b of balls) {
      const ball = this.table.balls[b.id]
      ball.pos.set(b.x, b.y, 0)
      ball.setStationary()
    }
    this.table.outcome = []
  }

  positions(): BallState[] {
    return this.table.balls.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y }))
  }

  strike(start: BallState[], cueBall: number, shot: Shot) {
    configure("threecushion")
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
