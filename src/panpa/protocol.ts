import { BallState, MatchState, Seat, Shot, Side, Stage } from "../engine/types"

/** Version of the host <-> game bridge described in this file. */
export const BRIDGE_VERSION = 1

/** Version of the downloadable bundle; bump on every release. */
export const BUNDLE_VERSION = "0.1.0"

export type Mode = "match" | "spectate" | "practice" | "free"

/** A rectangle in CSS pixels of the web view. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Layout {
  /** where the whole table, rails included, is fitted */
  tableArea: Rect
  /** where the aiming controls go */
  controlsArea: Rect
}

export interface Theme {
  /** CSS colours, e.g. "#1f5fa8" */
  cloth?: string
  cushion?: string
  frame?: string
}

export interface Prefs {
  sound?: boolean
  haptics?: boolean
  quality?: "low" | "mid" | "high"
}

export interface PracticeOptions {
  raceTo?: number
  opponent?: "none" | "bot"
}

export interface InitMessage extends Partial<Layout> {
  bridgeVersion: number
  mode: Mode
  ruleType: "threecushion"
  locale?: string
  /** match mode: the seat this player sits in */
  mySeat?: Seat
  prefs?: Prefs
  theme?: Theme
  practice?: PracticeOptions
  /** "native": the host draws the practice/free buttons itself */
  controls?: "web" | "native"
}

export type CommandName = "rerack" | "undo" | "repeat" | "placeMode"

/** Host -> game. */
export type HostMessage =
  | { t: "game.init"; d: InitMessage }
  | { t: "game.layout"; d: Layout }
  | { t: "game.prefs"; d: Prefs }
  | { t: "game.pause"; d?: unknown }
  | { t: "game.resume"; d?: unknown }
  | { t: "game.reset"; d?: unknown }
  | { t: "game.cmd"; d: { name: CommandName } }
  /** a server frame, exactly as received */
  | { t: "net.recv"; d: string }
  | { t: "net.state"; d: { state: "connected" | "reconnecting" | "closed" } }

export interface Hud {
  mode: Mode
  stage: Stage | null
  scores: [number, number]
  innings: [number, number]
  run: number
  turnSeat: Seat | null
  /** true while the local player may shoot */
  canShoot: boolean
  opening: boolean
  frozen: number[]
  extensionsLeft: [number, number]
  shootout: MatchState["shootout"]
  result: MatchState["result"]
  /** practice/free commands that would do something right now */
  commands: CommandName[]
}

/** Game -> host. */
export type GameMessage =
  | {
      t: "game.loaded"
      d: {
        bridgeVersion: number
        bundleVersion: string
        engineVersion: string
        /** recorded shots replayed identically on this device */
        selfCheck: boolean
      }
    }
  | { t: "game.ready"; d: Record<string, never> }
  | { t: "game.hud"; d: Hud }
  | { t: "game.haptic"; d: { kind: "hit" | "point" | "foul" } }
  | { t: "game.error"; d: { code: string; fatal: boolean; detail?: string } }
  /** to be wrapped in the platform envelope and sent to the table node */
  | { t: "net.send"; d: { id: string; t: string; d: unknown } }

/** Server frames the game understands (platform envelope). */
export interface ServerFrame {
  t: string
  id?: string
  seq?: number
  d?: any
}

export interface ShotPlayback {
  cueBall: number
  shot: Shot
  start: BallState[]
  final: BallState[]
}

export type { BallState, MatchState, Seat, Shot, Side }
