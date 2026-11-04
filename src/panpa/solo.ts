import { frozenTo } from "../engine"
import { rulesFor } from "../engine/rules"
import { BilEvent, MatchState, Seat } from "../engine/types"

/**
 * Practice is played alone: whatever the rules would do with the turn, the
 * player stays at the table with the ball they were playing. A miss still
 * ends the inning (the engine has already counted it), so score / innings
 * is the player's average. Changes `state` and the turn event in place.
 */
export function stayAtTable(seat: Seat, state: MatchState, events: BilEvent[]) {
  if (state.phase !== "playing" || state.turnSeat === seat) {
    return
  }
  state.turnSeat = seat
  state.run = 0
  const pool = state.pool
  if (pool?.pendingChoice) {
    pool.pendingChoice = { ...pool.pendingChoice, seat }
  }
  if (!pool) {
    keepCaromBall(seat, state, events)
  }
  const turn = [...events].reverse().find((e) => e.type === "turn")
  if (turn && turn.type === "turn") {
    turn.seat = seat
    turn.frozen = state.frozen
    if (pool) {
      turn.pendingChoice = pool.pendingChoice
    }
  }
}

/** Carom: a time foul set the balls up for the other ball; set them up for ours. */
function keepCaromBall(seat: Seat, state: MatchState, events: BilEvent[]) {
  const rules = rulesFor(state.config.ruleType)
  const reracked = events.find(
    (e) => e.type === "position" && e.reason === "timeout"
  )
  if (reracked && reracked.type === "position") {
    state.balls = rules.startingPosition(
      state.config.seed,
      state.rackNo++,
      state.cueBallOf[seat]
    )
    reracked.balls = state.balls
  }
  state.frozen =
    state.opening || !rules.contactRules
      ? []
      : frozenTo(state.balls, state.cueBallOf[seat])
}
