import {
  applyAction,
  createMatch,
  ENGINE_VERSION,
  frozenTo,
  RULE_TYPES,
  SHOT_LIMITS,
  suggestCall,
  suggestShot,
} from "../engine"
import { chooseSide } from "../engine/rules/threecushion"
import {
  Action,
  BallState,
  BilEvent,
  MatchState,
  PoolState,
  RuleType,
  Seat,
  Shot,
  ShotEvent,
} from "../engine/types"
import { Overlap } from "../utils/overlap"
import { unitAtAngle } from "../utils/three-utils"
import { Sound } from "../view/sound"
import { Bridge } from "./bridge"
import { Controls, Prompt } from "./controls"
import { setLocale, t } from "./i18n"
import {
  BotLevel,
  BRIDGE_VERSION,
  BUNDLE_VERSION,
  CommandName,
  HostMessage,
  Hud,
  InitMessage,
  Layout,
  Mode,
  Prefs,
  ServerFrame,
} from "./protocol"
import { selfCheck } from "./selfcheck"
import { ShotPlayer } from "./shotplayer"
import { TableView } from "./tableview"

/**
 * How the practice bot plays: how many candidate shots it considers and how
 * steadily it delivers the one it picks (standard deviation of the aiming
 * error, in degrees). Roughly 0.2, 0.4, 1 and 2.3 points per inning.
 */
const BOT_LEVELS: Record<BotLevel, { tries: number; aimError: number }> = {
  easy: { tries: 40, aimError: 0.5 },
  normal: { tries: 60, aimError: 0.15 },
  hard: { tries: 150, aimError: 0.07 },
  pro: { tries: 150, aimError: 0 },
}

/** Balls further than this from where the server put them are reported. */
const DESYNC = 1e-6

const AIM_SEND_MS = 100

interface FreeState {
  cueBall: number
  lastStart: BallState[] | null
  lastShot: Shot | null
}

/** A practice position the player can come back to. */
interface PracticeStep {
  /** the referee's state before the step */
  state: MatchState
  /** the shot played from it; null when the balls were moved by hand */
  action: Action | null
}

/** "0.5.2" and "0.5.9" are compatible; before 1.0 the minor is breaking. */
function compatible(a: string, b: string): boolean {
  const [a0, a1] = a.split(".")
  const [b0, b1] = b.split(".")
  return a0 === b0 && (a0 !== "0" || a1 === b1)
}

/**
 * Runs the page: takes commands from the host, turns the player's input
 * into shots, and plays back what the referee (the server in a match, the
 * local engine in practice) says happened.
 */
export class Game {
  private player: ShotPlayer
  private ruleType: RuleType = "threecushion"
  private readonly controls: Controls
  private readonly sound = new Sound(true)
  private mode: Mode | null = null
  private mySeat: Seat | null = null
  private botSeat: Seat | null = null
  private botLevel: BotLevel = "normal"
  /** what the player has been shown so far */
  private state: MatchState | null = null
  /** practice: the referee's state, ahead of `state` while events play */
  private refereeState: MatchState | null = null
  /** practice: `state` has caught up with the referee */
  private refereeShown = true
  private free: FreeState | null = null
  /** practice and free play: the player is moving balls by hand */
  private placing = false
  /** practice: positions before each of the player's shots, oldest first */
  private history: PracticeStep[] = []
  /** practice: the last shot played or undone, for "repeat" */
  private lastPlayed: PracticeStep | null = null
  private readonly queue: BilEvent[] = []
  private current: ShotEvent | null = null
  private holdUntil = 0
  /** a shot or respot was sent and not yet answered */
  private pending: string | null = null
  private connected = true
  private paused = false
  private prefs: Required<Prefs> = {
    sound: true,
    haptics: true,
    quality: "mid",
  }
  private hostLayout = false
  /** where the table is on the page; presses elsewhere are not aiming */
  private tableRect = { x: 0, y: 0, w: 0, h: 0 }
  private nativeTools = false
  private angle = 0
  private remoteAim: { seat: Seat; angle: number } | null = null
  private lastAimSent = 0
  private lastFrame = 0
  private sendId = 0
  private dragBall: number | null = null
  private dragMoved = false
  /** pool: the cue ball is being carried by hand */
  private carryingCue = false
  /** match: where the balls were before a placement the server may refuse */
  private cueBefore: BallState[] | null = null
  /** practice bot / auto-play: the cue ball has been put down for this shot */
  private cuePlaced = false
  /** pool, 8-ball: the ball tapped for the call, waiting for a pocket */
  private callBall: number | null = null
  /** pool, 9-ball: the next shot is a push-out */
  private pushOut = false

  constructor(
    private readonly bridge: Bridge,
    private readonly view: TableView,
    host: HTMLElement
  ) {
    this.player = new ShotPlayer(this.ruleType, this.newMatch(10).balls, true)
    this.view.addTable(this.player.table)
    this.controls = new Controls(host, SHOT_LIMITS, {
      onChange: () => this.sendAim(),
      onSide: () => this.sideChanged(),
      onHit: () => this.hit(),
      onRespot: () => this.respot(),
      onCommand: (name) => this.command(name),
      onPrompt: (id) => this.prompt(id),
    })
    this.bindPointer(view.canvas)
    globalThis.addEventListener("resize", () => this.resized())
    this.resized()
    bridge.onMessage((m) => this.receive(m))
    const checked = selfCheck()
    bridge.send({
      t: "game.loaded",
      d: {
        bridgeVersion: BRIDGE_VERSION,
        bundleVersion: BUNDLE_VERSION,
        engineVersion: ENGINE_VERSION,
        selfCheck: checked,
      },
    })
    if (!checked) {
      this.error("ENGINE_SELFCHECK_FAILED", true)
    }
    requestAnimationFrame((now) => this.frame(now))
  }

  // ---------------------------------------------------------------- host

  private receive(message: HostMessage) {
    switch (message.t) {
      case "game.init":
        this.init(message.d)
        break
      case "game.layout":
        this.applyLayout(message.d)
        break
      case "game.prefs":
        this.prefs = { ...this.prefs, ...message.d }
        break
      case "game.pause":
        this.paused = true
        this.sound.listener?.context?.suspend?.()
        break
      case "game.resume":
        this.paused = false
        this.lastFrame = 0
        this.sound.listener?.context?.resume?.()
        break
      case "game.reset":
        this.reset()
        break
      case "game.cmd":
        this.command(message.d.name)
        break
      case "net.recv":
        this.receiveFrame(message.d)
        break
      case "net.state":
        this.connected = message.d.state === "connected"
        this.refresh()
        break
    }
  }

  private init(d: InitMessage) {
    if (d.bridgeVersion !== BRIDGE_VERSION) {
      this.error("BRIDGE_VERSION_MISMATCH", true)
      return
    }
    this.reset()
    if (!RULE_TYPES.includes(d.ruleType)) {
      this.error("RULE_NOT_SUPPORTED", true, String(d.ruleType))
      return
    }
    this.setRule(d.ruleType)
    setLocale(d.locale)
    this.controls.refreshText()
    this.prefs = { ...this.prefs, ...d.prefs }
    this.nativeTools = d.controls === "native"
    this.view.setTheme(d.theme ?? {})
    if (d.tableArea && d.controlsArea) {
      this.applyLayout({ tableArea: d.tableArea, controlsArea: d.controlsArea })
    }
    this.mode = d.mode
    if (d.mode === "practice") {
      this.botSeat = d.practice?.opponent === "bot" ? 1 : null
      this.botLevel = d.practice?.botLevel ?? "normal"
      this.startPractice(d.practice?.raceTo ?? 10)
    } else if (d.mode === "free") {
      this.startFree()
    } else {
      // the table appears with the first snapshot from the server
      this.mySeat = d.mode === "match" ? (d.mySeat ?? null) : null
    }
  }

  private reset() {
    this.mode = null
    this.state = null
    this.refereeState = null
    this.free = null
    this.placing = false
    this.history = []
    this.lastPlayed = null
    this.mySeat = null
    this.botSeat = null
    this.queue.length = 0
    this.current = null
    this.pending = null
    this.remoteAim = null
    this.connected = true
    this.controls.resetSpin()
    this.refresh()
  }

  private applyLayout(layout: Layout) {
    this.hostLayout = true
    this.tableRect = layout.tableArea
    this.view.layout(innerWidth, innerHeight, layout.tableArea)
    this.controls.layout(layout.controlsArea)
    this.controls.layoutTools(layout.tableArea)
  }

  /** Without a host layout: table on the left, controls in a strip on the right. */
  private resized() {
    if (this.hostLayout) {
      return
    }
    const strip = Math.max(72, Math.min(110, innerWidth * 0.12))
    const tableArea = {
      x: 8,
      y: 8,
      w: innerWidth - strip - 24,
      h: innerHeight - 16,
    }
    this.tableRect = tableArea
    this.view.layout(innerWidth, innerHeight, tableArea)
    this.controls.layout({
      x: innerWidth - strip - 8,
      y: Math.max(8, innerHeight - 260),
      w: strip,
      h: Math.min(252, innerHeight - 16),
    })
    this.controls.layoutTools(tableArea)
  }

  private error(code: string, fatal: boolean, detail?: string) {
    this.bridge.send({
      t: "game.error",
      d: detail === undefined ? { code, fatal } : { code, fatal, detail },
    })
  }

  // ---------------------------------------------------------------- modes

  /** Switch disciplines: a table with that discipline's balls. */
  private setRule(ruleType: RuleType) {
    if (ruleType === this.ruleType) {
      return
    }
    this.ruleType = ruleType
    this.view.removeTable(this.player.table)
    this.view.setRule(ruleType)
    this.player = new ShotPlayer(ruleType, this.newMatch(10).balls, true)
    this.view.addTable(this.player.table)
  }

  private pool(): PoolState | null {
    return this.state?.pool ?? null
  }

  private newMatch(raceTo: number): MatchState {
    return createMatch({
      ruleType: this.ruleType,
      raceTo,
      equalizingInning: true,
      tieBreak: "shootout",
      timeoutLimit: 0,
      firstSeat: 0,
      seed: `local-${Date.now()}-${Math.random()}`,
    })
  }

  private startPractice(raceTo: number) {
    this.history = []
    this.lastPlayed = null
    this.placing = false
    this.refereeState = this.newMatch(Math.min(100, Math.max(1, raceTo)))
    this.refereeShown = false
    this.show(this.refereeState)
    this.bridge.send({ t: "game.ready", d: {} })
  }

  private startFree() {
    this.player.place(this.newMatch(10).balls)
    this.free = { cueBall: 0, lastStart: null, lastShot: null }
    this.placing = false
    this.aimAtRed()
    this.refresh()
    this.bridge.send({ t: "game.ready", d: {} })
  }

  /** Replace everything on screen with `state`. */
  private show(state: MatchState) {
    this.queue.length = 0
    this.current = null
    this.pending = null
    this.state = JSON.parse(JSON.stringify(state))
    this.placeForTurn()
    this.refresh()
  }

  // ---------------------------------------------------------------- server

  private receiveFrame(raw: string) {
    let frame: ServerFrame
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    const d = frame.d
    switch (frame.t) {
      case "bil.snapshot":
      case "bil.matchStart":
        this.serverState(d)
        break
      case "bil.shot":
        this.enqueue({ type: "shot", ...d })
        break
      case "bil.position":
        this.enqueue({ type: "position", ...d })
        break
      case "bil.turn":
        this.enqueue({ type: "turn", ...d })
        break
      case "bil.extension":
        this.enqueue({ type: "extension", ...d })
        break
      case "bil.shootout":
        this.enqueue({ type: "shootout", ...d })
        break
      case "bil.matchEnd":
        this.enqueue({ type: "matchEnd", ...d })
        break
      case "bil.aim":
        if (d.seat !== this.mySeat) {
          this.remoteAim = { seat: d.seat, angle: d.angle }
        }
        break
      case "ack":
        if (frame.id && frame.id === this.pending) {
          this.pending = null
          this.cueBefore = null
          this.refresh()
        }
        break
      case "err":
        if (frame.id && frame.id === this.pending) {
          this.pending = null
          if (this.cueBefore && this.state) {
            // the referee refused the spot: the cue ball goes back
            this.state.balls = this.cueBefore
            this.player.place(this.cueBefore)
            this.cueBefore = null
          }
          this.error(d?.code ?? "REJECTED", false, d?.reason)
          this.refresh()
        }
        break
    }
  }

  private serverState(d: any) {
    if (d?.mySeat === 0 || d?.mySeat === 1) {
      this.mySeat = d.mySeat
    }
    const match: MatchState | undefined = d?.match
    if (!match) {
      return
    }
    if (!compatible(match.engineVersion, ENGINE_VERSION)) {
      this.error(
        "ENGINE_VERSION_MISMATCH",
        true,
        `${match.engineVersion} / ${ENGINE_VERSION}`
      )
      return
    }
    if (RULE_TYPES.includes(match.config.ruleType)) {
      this.setRule(match.config.ruleType)
    }
    const first = this.state === null
    this.show(match)
    if (first) {
      this.bridge.send({ t: "game.ready", d: {} })
    }
  }

  private netSend(t: string, d: unknown): string {
    const id = `g${++this.sendId}`
    this.bridge.send({ t: "net.send", d: { id, t, d } })
    return id
  }

  // ---------------------------------------------------------------- events

  private enqueue(event: BilEvent) {
    this.queue.push(event)
  }

  /** Play queued events in order; a shot holds the queue until the balls rest. */
  private drain(now: number) {
    while (!this.current && now >= this.holdUntil && this.queue.length > 0) {
      const event = this.queue.shift()!
      this.apply(event, now)
    }
    if (
      !this.current &&
      this.queue.length === 0 &&
      this.refereeState &&
      this.state &&
      !this.refereeShown
    ) {
      // practice: everything has been shown, take the referee's full state
      // (a copy: events patch `state`, the referee's own stays untouched)
      this.state = JSON.parse(JSON.stringify(this.refereeState))
      this.refereeShown = true
      this.refresh()
      this.botTurn()
    }
  }

  private apply(event: BilEvent, now: number) {
    const state = this.state
    if (!state) {
      return
    }
    switch (event.type) {
      case "shot":
        this.current = event
        this.pending = null
        this.remoteAim = null
        this.view.hideAim()
        this.player.strike(event.start, event.cueBall, event.shot)
        this.sound.lastOutcomeTime = -1
        if (this.prefs.sound) {
          this.sound.outcomeToSound({
            type: "Hit",
            incidentSpeed: event.shot.power * 4,
          })
        }
        break
      case "position":
        state.balls = event.balls
        this.player.place(event.balls)
        this.pending = null
        // let the player see the balls being set up
        this.holdUntil = now + 500
        break
      case "turn": {
        const timedOut = (event as any).timedOut
        if (timedOut && state.stage !== "shootout") {
          state.innings[timedOut.seat as Seat]++
          state.run = 0
        }
        state.turnSeat = event.seat
        state.shotNo = event.shotNo
        state.stage = event.stage
        state.opening = event.opening
        state.frozen = event.frozen
        if (state.pool) {
          const pool = state.pool
          pool.ballInHand = event.ballInHand ?? "none"
          pool.breakShot = event.breakShot ?? false
          pool.pushOutAvailable = event.pushOutAvailable ?? false
          pool.pendingChoice = event.pendingChoice ?? null
          pool.call = null
          this.callBall = null
          this.pushOut = false
          this.cuePlaced = false
        }
        this.controls.resetSpin()
        this.placeForTurn()
        break
      }
      case "extension":
        state.extensionsLeft[event.seat] = event.left
        break
      case "shootout":
        state.shootout = { round: event.round, runs: event.runs }
        break
      case "rackEnd":
        state.scores = event.racks
        if (this.prefs.haptics) {
          this.bridge.send({ t: "game.haptic", d: { kind: "point" } })
        }
        break
      case "placed":
        state.balls = state.balls.map((b) =>
          b.id === event.ball ? { id: b.id, x: event.pos.x, y: event.pos.y } : b
        )
        this.player.moveBall(event.ball, event.pos.x, event.pos.y)
        break
      case "matchEnd":
        state.phase = "ended"
        state.scores = event.scores
        state.result = { winnerSeat: event.winnerSeat, reason: event.reason }
        break
    }
    this.refresh()
  }

  private shotFinished() {
    const event = this.current!
    this.current = null
    const off = this.player.deviation(event.final)
    if (off > DESYNC) {
      this.error("DESYNC", false, off.toExponential(2))
    }
    this.player.place(event.final)
    const s = this.state
    if (s) {
      s.balls = event.final
      s.scores = event.scores
      // innings and run as the engine counts them, so the HUD can show
      // them in a match too
      if (event.outcome.points > 0) {
        s.run++
      } else if (event.stage !== "shootout") {
        s.innings[event.seat]++
        s.run = 0
      }
    }
    if (this.prefs.haptics) {
      if (event.outcome.points > 0) {
        this.bridge.send({ t: "game.haptic", d: { kind: "point" } })
      } else if (event.outcome.foul) {
        this.bridge.send({ t: "game.haptic", d: { kind: "foul" } })
      }
    }
    if (event.outcome.points > 0 && this.prefs.sound) {
      this.sound.playSuccess(8)
    }
    this.refresh()
  }

  // ---------------------------------------------------------------- input

  /** The seat whose shot it is, if the local player may play it now. */
  private shooter(): Seat | null {
    const s = this.state
    if (!s || s.phase !== "playing" || this.current || this.queue.length > 0) {
      return null
    }
    if (this.pending || !this.connected || this.paused || this.placing) {
      return null
    }
    if (this.mode === "match") {
      return s.turnSeat === this.mySeat ? s.turnSeat : null
    }
    if (this.mode === "practice") {
      return s.turnSeat === this.botSeat ? null : s.turnSeat
    }
    return null
  }

  private canShootFree(): boolean {
    return this.free !== null && !this.player.playing && !this.placing
  }

  private cueBall(): number | null {
    if (this.free) {
      return this.free.cueBall
    }
    const seat = this.shooter()
    return seat === null || !this.state ? null : this.state.cueBallOf[seat]
  }

  /** On a starting position the player's ball may be on either side spot. */
  private placeForTurn() {
    const s = this.state
    if (!s) {
      return
    }
    const seat = this.shooter()
    const balls =
      seat !== null && s.opening
        ? chooseSide(s.balls, s.cueBallOf[seat], this.controls.side)
        : s.balls
    this.player.place(balls)
    if (seat !== null && (s.opening || s.pool?.breakShot)) {
      this.aimAtRed()
    }
  }

  /** Carom: the red; pool: the lowest ball on the table. */
  private aimAtRed() {
    const cueBall = this.cueBall()
    if (cueBall === null) {
      return
    }
    const balls = this.player.table.balls
    const from = balls[cueBall].pos
    const target = this.state?.pool
      ? balls.find((b) => b.id > 0 && b.onTable())
      : balls[2]
    if (!target) {
      return
    }
    this.angle = Math.atan2(target.pos.y - from.y, target.pos.x - from.x)
  }

  /** Only the side button moves the ball; spin and power never re-aim. */
  private sideChanged() {
    if (this.state?.opening && this.shooter() !== null) {
      this.placeForTurn()
    }
    this.sendAim()
  }

  private sendAim() {
    const now = performance.now()
    if (this.mode !== "match" || this.shooter() === null) {
      return
    }
    if (now - this.lastAimSent < AIM_SEND_MS) {
      return
    }
    this.lastAimSent = now
    this.netSend("bil.aim", this.shot())
  }

  private shot(): Shot {
    return {
      angle: Math.fround(this.angle),
      power: Math.fround(this.controls.shotPower()),
      elevation: 0,
      offset: {
        x: Math.fround(this.controls.offset.x),
        y: Math.fround(this.controls.offset.y),
      },
    }
  }

  private hit() {
    if (this.free) {
      this.hitFree()
      return
    }
    const seat = this.shooter()
    const s = this.state
    if (seat === null || !s) {
      return
    }
    const action: Action = {
      type: "shoot",
      shotNo: s.shotNo,
      shot: this.shot(),
    }
    if (s.opening) {
      action.side = this.controls.side
    }
    if (s.pool && this.pushOut) {
      action.pushOut = true
    }
    if (this.mustCall()) {
      return
    }
    this.bridge.send({ t: "game.haptic", d: { kind: "hit" } })
    this.act(seat, action)
  }

  /** 8-ball: a call is owed before this shot. */
  private mustCall(): boolean {
    const pool = this.pool()
    return (
      this.ruleType === "eightball" &&
      !!pool &&
      !pool.breakShot &&
      pool.pendingChoice === null &&
      pool.call === null
    )
  }

  /** A pool decision button: a pending choice, a safety call or push-out. */
  private prompt(id: string) {
    const seat = this.shooter()
    const s = this.state
    if (seat === null || !s?.pool) {
      return
    }
    const pool = s.pool
    if (pool.pendingChoice) {
      if (pool.pendingChoice.options.includes(id)) {
        this.act(seat, { type: "choice", shotNo: s.shotNo, option: id })
      }
      return
    }
    if (id === "safety") {
      this.callBall = null
      this.act(seat, { type: "call", shotNo: s.shotNo, safety: true })
    } else if (id === "pushOut") {
      this.pushOut = !this.pushOut
      this.refresh()
    }
  }

  /** 8-ball: a tap on a ball or a pocket while a call is owed. */
  private callAt(p: { x: number; y: number }): boolean {
    const seat = this.shooter()
    const s = this.state
    if (seat === null || !s || !this.mustCall()) {
      return false
    }
    const pocket = this.view.pocketAt(p)
    if (pocket !== null && this.callBall !== null) {
      this.act(seat, {
        type: "call",
        shotNo: s.shotNo,
        ball: this.callBall,
        pocket,
      })
      return true
    }
    const ball = this.ballAt(p.x, p.y)
    if (ball !== null && ball !== 0) {
      this.callBall = ball
      this.refresh()
      return true
    }
    return false
  }

  /** Dev host only: play the suggested shot (or a random one in free play). */
  autoHit() {
    const seat = this.shooter()
    if (seat !== null && this.state?.pool) {
      const s = this.refereeState ?? this.state
      if (this.mode === "practice" && this.botPoolStep(s, seat)) {
        // a placement or a choice was made; shoot once it has been shown
        setTimeout(() => this.autoHit(), 600)
        return
      }
      if (this.mustCall()) {
        const shot = suggestShot(s, seat, Math.random, { tries: 40 })
        const call = suggestCall(s, seat, shot)
        this.act(
          seat,
          call === "safety"
            ? { type: "call", shotNo: s.shotNo, safety: true }
            : { type: "call", shotNo: s.shotNo, ...call }
        )
        this.angle = shot.angle
        this.controls.setShot(shot, SHOT_LIMITS)
        this.hit()
        return
      }
    }
    if (seat !== null && this.state) {
      const shot = suggestShot(this.state, seat, Math.random, { tries: 40 })
      this.angle = shot.angle
      this.controls.offset = shot.offset
      const [min, max] = SHOT_LIMITS.power
      this.controls.power = (shot.power - min) / (max - min)
    } else if (this.canShootFree()) {
      this.angle = Math.random() * 2 * Math.PI
    }
    this.hit()
  }

  private respot() {
    const seat = this.shooter()
    if (seat === null || !this.state || this.state.frozen.length === 0) {
      return
    }
    this.act(seat, { type: "respot", shotNo: this.state.shotNo })
  }

  /** Hand an action to the referee: the server, or the engine in practice. */
  private act(seat: Seat, action: Action) {
    if (this.mode === "match") {
      this.sendAction(action)
      this.refresh()
      return
    }
    const before = this.refereeState!
    const result = applyAction(before, seat, action)
    if (!result.ok) {
      this.error(result.code, false, result.reason)
      return
    }
    if (seat !== this.botSeat) {
      const step = { state: before, action }
      this.history.push(step)
      this.lastPlayed = step
    }
    this.refereeState = result.state
    this.refereeShown = false
    result.events.forEach((e) => this.enqueue(e))
    this.refresh()
  }

  /** Match: the action as a table message; calls take effect at once. */
  private sendAction(action: Action) {
    const pool = this.pool()
    switch (action.type) {
      case "shoot": {
        const d: any = { shotNo: action.shotNo, shot: action.shot }
        if (action.side) d.side = action.side
        if (action.pushOut) d.pushOut = true
        this.pending = this.netSend("bil.shoot", d)
        break
      }
      case "respot":
        this.pending = this.netSend("bil.respot", { shotNo: action.shotNo })
        break
      case "placeBall":
        this.pending = this.netSend("bil.placeBall", {
          shotNo: action.shotNo,
          pos: action.pos,
        })
        break
      case "call":
        this.netSend(
          "bil.call",
          action.safety
            ? { shotNo: action.shotNo, safety: true }
            : {
                shotNo: action.shotNo,
                ball: action.ball,
                pocket: action.pocket,
              }
        )
        if (pool) {
          pool.call = action.safety
            ? "safety"
            : { ball: action.ball!, pocket: action.pocket! }
        }
        break
      case "choice":
        this.pending = this.netSend("bil.choice", {
          shotNo: action.shotNo,
          option: action.option,
        })
        break
    }
  }

  private botTurn() {
    const s = this.refereeState
    if (!s || s.phase !== "playing" || s.turnSeat !== this.botSeat) {
      return
    }
    if (this.placing) {
      return
    }
    const seat = s.turnSeat
    setTimeout(() => {
      if (this.refereeState !== s || this.mode !== "practice") {
        return
      }
      const level = BOT_LEVELS[this.botLevel] ?? BOT_LEVELS.normal
      if (s.pool && this.botPoolStep(s, seat)) {
        return
      }
      const shot = suggestShot(s, seat, Math.random, {
        tries: level.tries,
        aimError: (level.aimError * Math.PI) / 180,
      })
      if (s.pool && this.ruleType === "eightball" && !s.pool.breakShot) {
        const call = suggestCall(s, seat, shot)
        this.act(
          seat,
          call === "safety"
            ? { type: "call", shotNo: s.shotNo, safety: true }
            : { type: "call", shotNo: s.shotNo, ...call }
        )
      }
      this.act(seat, { type: "shoot", shotNo: this.refereeState!.shotNo, shot })
    }, 900)
  }

  /** Pool bot: answer a choice or put the cue ball somewhere; true if it did. */
  private botPoolStep(s: MatchState, seat: Seat): boolean {
    const pool = s.pool!
    if (pool.pendingChoice) {
      this.act(seat, {
        type: "choice",
        shotNo: s.shotNo,
        option: pool.pendingChoice.options[0],
      })
      return true
    }
    if (pool.ballInHand !== "none" && !this.cuePlaced) {
      const { halfLength, halfWidth } = this.view.bounds
      for (let k = 0; k < 40; k++) {
        const pos =
          pool.ballInHand === "kitchen"
            ? {
                x:
                  -halfLength +
                  Math.random() * (this.view.headString + halfLength - 0.01),
                y: (Math.random() - 0.5) * halfWidth,
              }
            : {
                x: (Math.random() - 0.5) * 1.6 * halfLength,
                y: (Math.random() - 0.5) * 1.6 * halfWidth,
              }
        const r = applyAction(s, seat, {
          type: "placeBall",
          shotNo: s.shotNo,
          pos,
        })
        if (r.ok) {
          this.cuePlaced = true
          this.refereeState = r.state
          this.refereeShown = false
          r.events.forEach((e) => this.enqueue(e))
          return true
        }
      }
    }
    return false
  }

  // ---------------------------------------------------------------- free play

  private hitFree() {
    const free = this.free!
    if (!this.canShootFree()) {
      return
    }
    free.lastStart = this.player.positions()
    free.lastShot = this.shot()
    this.playFree()
  }

  private playFree() {
    const free = this.free!
    this.view.hideAim()
    this.player.strike(free.lastStart!, free.cueBall, free.lastShot!)
    this.sound.lastOutcomeTime = -1
    this.refresh()
  }

  private command(name: CommandName) {
    if (!this.commands().includes(name)) {
      return
    }
    if (name === "rerack") {
      if (this.free) {
        this.startFree()
      } else {
        this.startPractice(this.refereeState?.config.raceTo ?? 10)
      }
      return
    }
    if (name === "placeMode") {
      this.placing = !this.placing
      if (!this.placing && this.refereeState) {
        this.commitPlacement()
      }
    } else if (this.free) {
      if (name === "undo") {
        this.player.place(this.free.lastStart!)
      } else if (name === "repeat") {
        this.playFree()
      }
    } else if (name === "undo") {
      this.undoPractice()
    } else if (name === "repeat") {
      this.repeatPractice()
    }
    this.refresh()
  }

  /** Practice: the balls as the player left them become the position. */
  private commitPlacement() {
    const before = this.refereeState!
    const state: MatchState = JSON.parse(JSON.stringify(before))
    state.balls = this.player.positions()
    state.opening = false
    state.frozen = frozenTo(state.balls, state.cueBallOf[state.turnSeat])
    this.history.push({ state: before, action: null })
    this.refereeState = state
    this.refereeShown = false
    this.show(state)
  }

  /** Practice: back to the position before the last shot or placement. */
  private undoPractice() {
    const step = this.history.pop()
    if (!step) {
      return
    }
    if (step.action) {
      this.lastPlayed = step
      this.showShot(step.action)
    }
    this.refereeState = step.state
    this.refereeShown = false
    this.show(step.state)
  }

  /** Practice: the last shot again, from where it was played. */
  private repeatPractice() {
    const step = this.lastPlayed
    if (!step?.action) {
      return
    }
    this.refereeState = step.state
    this.refereeShown = false
    this.show(step.state)
    this.showShot(step.action)
    this.act(step.state.turnSeat, step.action)
  }

  /** Put a shot's aim, strike point and power back on the controls. */
  private showShot(action: Action) {
    if (action.type !== "shoot") {
      return
    }
    this.angle = action.shot.angle
    this.controls.setShot(action.shot, SHOT_LIMITS)
    if (action.side) {
      this.controls.side = action.side
      this.controls.refreshText()
    }
  }

  private commands(): CommandName[] {
    if (this.current || this.queue.length > 0 || this.player.playing) {
      return []
    }
    if (this.mode === "practice") {
      const list: CommandName[] = ["placeMode"]
      if (this.history.length > 0) {
        list.push("undo")
      }
      if (this.lastPlayed?.action) {
        list.push("repeat")
      }
      list.push("rerack")
      return list
    }
    const free = this.free
    if (!free) {
      return []
    }
    const list: CommandName[] = ["placeMode", "rerack"]
    if (free.lastStart && free.lastShot) {
      list.push("undo", "repeat")
    }
    return list
  }

  private bindPointer(canvas: HTMLCanvasElement) {
    const at = (e: PointerEvent) => this.view.toTable(e.clientX, e.clientY)
    let active: number | null = null
    canvas.addEventListener("pointerdown", (e) => {
      if (active !== null || !e.isPrimary || e.target !== canvas) {
        return
      }
      if (!this.onTable(e.clientX, e.clientY)) {
        return
      }
      active = e.pointerId
      e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // without capture the pointer id check below still applies
      }
      const p = at(e)
      if (this.placing && !this.player.playing) {
        this.dragBall = this.ballAt(p.x, p.y)
        this.dragMoved = false
      } else if (this.inHand() && this.ballAt(p.x, p.y) === 0) {
        this.carryingCue = true
        this.dragBall = 0
        this.dragMoved = false
      } else if (!this.callAt(p)) {
        this.aimTo(p.x, p.y)
      }
    })
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== active) {
        return
      }
      e.preventDefault()
      const p = at(e)
      if (this.dragBall !== null) {
        this.dragMoved = true
        this.moveBall(this.dragBall, p.x, p.y)
      } else if (!this.placing) {
        this.aimTo(p.x, p.y)
      }
    })
    const release = (e: PointerEvent) => {
      if (e.pointerId !== active) {
        return
      }
      active = null
      this.controls.hideThickness()
      if (this.carryingCue) {
        this.carryingCue = false
        if (this.dragMoved) {
          this.dropCue()
        }
      } else if (this.dragBall !== null && !this.dragMoved) {
        this.pickCueBall(this.dragBall)
      }
      this.dragBall = null
    }
    canvas.addEventListener("pointerup", release)
    canvas.addEventListener("pointercancel", release)
  }

  /** Pool: the player in turn has the cue ball in hand. */
  private inHand(): boolean {
    const pool = this.pool()
    return this.shooter() !== null && !!pool && pool.ballInHand !== "none"
  }

  /** Pool: the cue ball was let go; the referee checks the spot. */
  private dropCue() {
    const seat = this.shooter()
    const s = this.state
    if (seat === null || !s) {
      return
    }
    const cue = this.player.table.balls[0].pos
    const pos = { x: Math.fround(cue.x), y: Math.fround(cue.y) }
    if (this.mode === "match") {
      this.cueBefore = s.balls
      this.act(seat, { type: "placeBall", shotNo: s.shotNo, pos })
      // shown where it was dropped; a rejection puts it back
      s.balls = s.balls.map((b) => (b.id === 0 ? { id: 0, ...pos } : b))
      return
    }
    const r = applyAction(this.refereeState!, seat, {
      type: "placeBall",
      shotNo: s.shotNo,
      pos,
    })
    if (!r.ok) {
      this.error(r.code, false, r.reason)
      this.player.place(s.balls)
      return
    }
    this.refereeState = r.state
    this.refereeShown = false
    r.events.forEach((e) => this.enqueue(e))
  }

  /** Practice, while placing: the ball of the seat whose turn it is. */
  private placedCueBall(): number | null {
    const s = this.refereeState
    return s && s.phase === "playing" ? s.cueBallOf[s.turnSeat] : null
  }

  /** A tap while placing: play with that ball (practice: that seat's turn). */
  private pickCueBall(id: number) {
    if (this.free) {
      this.free.cueBall = id
      return
    }
    const s = this.refereeState
    if (!s || s.phase !== "playing") {
      return
    }
    const seat = s.cueBallOf.indexOf(id) as Seat | -1
    if (seat === -1 || seat === this.botSeat) {
      return
    }
    const next: MatchState = JSON.parse(JSON.stringify(s))
    next.turnSeat = seat
    next.run = 0
    next.frozen = frozenTo(next.balls, id)
    this.refereeState = next
    this.state!.turnSeat = seat
  }

  /** Inside the table's box on the page, with a small margin. */
  private onTable(px: number, py: number): boolean {
    const r = this.tableRect
    const m = 12
    return (
      px >= r.x - m &&
      px <= r.x + r.w + m &&
      py >= r.y - m &&
      py <= r.y + r.h + m
    )
  }

  private aimTo(x: number, y: number) {
    const cueBall = this.cueBall()
    if (cueBall === null || (this.free && !this.canShootFree())) {
      return
    }
    const from = this.player.table.balls[cueBall].pos
    if (Math.hypot(x - from.x, y - from.y) < 1e-4) {
      return
    }
    this.angle = Math.atan2(y - from.y, x - from.x)
    this.sendAim()
    this.showThickness(cueBall)
  }

  /** The cut on the first ball in the line of aim, while aiming. */
  private showThickness(cueBall: number) {
    const table = this.player.table
    const hit = new Overlap(table.balls).getOverlapOffset(
      table.balls[cueBall],
      unitAtAngle(this.angle)
    )
    this.controls.showThickness(
      hit
        ? {
            overlap: hit.overlap,
            colour: `#${hit.ball.ballmesh.color.getHexString()}`,
          }
        : null
    )
  }

  private ballAt(x: number, y: number): number | null {
    const R = this.radius()
    for (const b of this.player.table.balls) {
      if (Math.hypot(b.pos.x - x, b.pos.y - y) < R * 1.8) {
        return b.id
      }
    }
    return null
  }

  private radius(): number {
    return this.view.ballRadius
  }

  /** Drag a ball in free play: stays on the cloth and off the other balls. */
  private moveBall(id: number, x: number, y: number) {
    const R = this.radius()
    const { halfLength, halfWidth } = this.view.bounds
    const nx = Math.min(halfLength, Math.max(-halfLength, x))
    const ny = Math.min(halfWidth, Math.max(-halfWidth, y))
    const balls = this.player.table.balls
    const clear = balls.every(
      (b) => b.id === id || Math.hypot(b.pos.x - nx, b.pos.y - ny) >= 2 * R
    )
    if (clear) {
      balls[id].pos.set(Math.fround(nx), Math.fround(ny), 0)
    }
  }

  // ---------------------------------------------------------------- output

  private refresh() {
    const s = this.state
    const seat = this.shooter()
    const canShoot = seat !== null || this.canShootFree()
    this.controls.setState({
      canShoot,
      opening: seat !== null && !!s?.opening,
      frozen: seat !== null && (s?.frozen.length ?? 0) > 0,
    })
    const commands = this.commands()
    this.controls.setTools(commands, this.placing, !this.nativeTools)
    this.controls.setPrompt(this.poolPrompt(seat))
    this.view.showKitchen(
      this.inHand() && this.pool()?.ballInHand === "kitchen"
    )
    this.view.showPockets(
      this.mustCall() && seat !== null && this.callBall !== null,
      null
    )
    if (this.mode === null) {
      return
    }
    const hud: Hud = {
      mode: this.mode,
      stage: s?.stage ?? null,
      scores: s?.scores ?? [0, 0],
      innings: s?.innings ?? [0, 0],
      run: s?.run ?? 0,
      turnSeat: s && s.phase === "playing" ? s.turnSeat : null,
      canShoot,
      opening: s?.opening ?? false,
      frozen: s?.frozen ?? [],
      extensionsLeft: s?.extensionsLeft ?? [0, 0],
      shootout: s?.shootout ?? null,
      result: s?.result ?? null,
      commands,
    }
    if (s?.pool) {
      hud.pool = {
        racks: s.scores,
        breakShot: s.pool.breakShot,
        ballInHand: s.pool.ballInHand,
        groups: s.pool.groups,
        open: s.pool.open,
        pendingChoice: s.pool.pendingChoice,
        pushOutAvailable: s.pool.pushOutAvailable,
        mustCall: this.mustCall(),
        call: s.pool.call,
        onTable: s.balls
          .filter((b) => !b.pocketed && b.id > 0)
          .map((b) => b.id),
      }
    }
    const json = JSON.stringify(hud)
    if (json !== this.lastHud) {
      this.lastHud = json
      this.bridge.send({ t: "game.hud", d: hud })
    }
  }

  private lastHud = ""

  /** What the pool rules want from the player right now, as a prompt. */
  private poolPrompt(seat: Seat | null): Prompt | null {
    const pool = this.pool()
    if (!pool || seat === null || this.nativeTools) {
      return null
    }
    const choice = pool.pendingChoice
    if (choice && choice.seat === seat) {
      return { text: "", buttons: choice.options.map((id) => ({ id })) }
    }
    const buttons: Prompt["buttons"] = []
    let text = ""
    if (pool.ballInHand === "kitchen") text = t("kitchen")
    else if (pool.ballInHand === "anywhere") text = t("ballInHand")
    if (this.mustCall()) {
      text = this.callBall === null ? t("callBall") : t("callPocket")
      buttons.push({ id: "safety" })
    }
    if (pool.pushOutAvailable) {
      buttons.push({ id: "pushOut", on: this.pushOut })
    }
    return text === "" && buttons.length === 0 ? null : { text, buttons }
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t))
    const seconds = this.lastFrame
      ? Math.min(0.1, (now - this.lastFrame) / 1000)
      : 0
    this.lastFrame = now
    if (this.paused) {
      return
    }
    const wasPlaying = this.player.playing
    const rested = this.player.advance(seconds)
    if (wasPlaying && this.prefs.sound) {
      this.sound.processOutcomes(this.player.table.outcome)
    }
    if (rested) {
      if (this.current) {
        this.shotFinished()
      } else {
        this.refresh()
      }
    }
    this.drain(now)
    this.view.syncBalls(this.player.table, seconds)
    this.drawAim()
    this.view.render()
  }

  /** The salon may switch the aiming guide off in matches. */
  private assist(): boolean {
    if (this.mode !== "match" && this.mode !== "spectate") {
      return true
    }
    return (this.state?.config as any)?.assist !== false
  }

  private drawAim() {
    const table = this.player.table
    const cueBall = this.cueBall()
    const mine = this.shooter() !== null || this.canShootFree()
    const assist = this.assist()
    if (mine && cueBall !== null) {
      this.view.showAim(
        table,
        cueBall,
        this.angle,
        this.controls.power,
        this.controls.offset,
        assist
      )
      this.view.mark(null)
    } else if (this.remoteAim && this.state && !this.current) {
      const ball = this.state.cueBallOf[this.remoteAim.seat]
      this.view.showAim(table, ball, this.remoteAim.angle, 0.3, null, assist)
      this.view.mark(null)
    } else {
      this.view.hideAim()
      const held = this.free ? this.free.cueBall : this.placedCueBall()
      const picked =
        this.placing && held !== null ? table.balls[held].pos : null
      this.view.mark(picked)
    }
  }
}
