import { applyAction } from "../engine"
import { Action, MatchState, Seat } from "../engine/types"
import recorded from "./selfcheck.json"

interface RecordedShot {
  state: MatchState
  seat: Seat
  action: Action
  stateHash: string
}

/**
 * Replay a handful of recorded shots and compare with what the reference
 * engine produced. A mismatch means this device's JavaScript engine would
 * animate shots differently from the server.
 */
export function selfCheck(): boolean {
  const shots = recorded as unknown as RecordedShot[]
  return shots.every((s) => {
    const result = applyAction(s.state, s.seat, s.action)
    if (!result.ok) {
      return false
    }
    const shot = result.events[0]
    return shot.type === "shot" && shot.stateHash === s.stateHash
  })
}
