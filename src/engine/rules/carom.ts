import { BallState, Foul, OutcomeEvent, RuleType, Side } from "../types"

export interface Judgement {
  points: number
  foul: Foul | null
  /** points taken off the shooter's score */
  penalty: number
}

export interface JudgeInput {
  cueBall: number
  opponentBall: number
  events: OutcomeEvent[]
  start: BallState[]
  opening: boolean
  frozen: number[]
  /** shooter's score before the shot and the score that wins */
  score: number
  target: number
}

/** What the match engine needs from a carom discipline. */
export interface CaromRules {
  ruleType: RuleType
  ballCount: number
  /** the starting position asks for a direct shot to the red and a side choice */
  openingRules: boolean
  /** balls in contact may be respotted (UMB art. 27) */
  contactRules: boolean
  startingPosition(
    seed: string,
    rackNo: number,
    shooterBall: number,
    side?: Side
  ): BallState[]
  judge(input: JudgeInput): Judgement
  /** balls a player would aim at; used by the shot suggester */
  aimTargets(balls: BallState[], cueBall: number, opening: boolean): number[]
}
