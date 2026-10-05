import {
  applyAction,
  createMatch,
  ENGINE_VERSION,
  SHOT_LIMITS,
  suggestShot,
} from "../engine"
import { chooseSide } from "../engine/rules/threecushion"
import {
  Action,
  BallState,
  BilEvent,
  MatchState,
  Seat,
  Shot,
  ShotEvent,
} from "../engine/types"
import { Sound } from "../view/sound"
import { Bridge } from "./bridge"
import { Controls } from "./controls"
import { setLocale } from "./i18n"
import {
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

/** Balls further than this from where the server put them are reported. */
const DESYNC = 1e-6

const AIM_SEND_MS = 100

interface FreeState {
  cueBall: number
  placing: boolean
  lastStart: BallState[] | null
  lastShot: Shot | null
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
  private readonly player: ShotPlayer
  private readonly controls: Controls
  private readonly sound = new Sound(true)
  private mode: Mode | null = null
  private mySeat: Seat | null = null
  private botSeat: Seat | null = null
  /** what the player has been shown so far */
  private state: MatchState | null = null
  /** practice: the referee's state, ahead of `state` while events play */
  private refereeState: MatchState | null = null
  private free: FreeState | null = null
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
  private nativeTools = false
  private angle = 0
  private remoteAim: { seat: Seat; angle: number } | null = null
  private lastAimSent = 0
  private lastFrame = 0
  private sendId = 0
  private dragBall: number | null = null
  private dragMoved = false

  constructor(
    private readonly bridge: Bridge,
    private readonly view: TableView,
    host: HTMLElement
  ) {
    const start = this.newMatch(10).balls
    this.player = new ShotPlayer(start, true)
    this.view.addTable(this.player.table)
    this.controls = new Controls(host, SHOT_LIMITS, {
      onChange: () => this.aimChanged(),
      onHit: () => this.hit(),
      onRespot: () => this.respot(),
      onCommand: (name) => this.command(name),
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

  private newMatch(raceTo: number): MatchState {
    return createMatch({
      ruleType: "threecushion",
      raceTo,
      equalizingInning: true,
      tieBreak: "shootout",
      timeoutLimit: 0,
      firstSeat: 0,
      seed: `local-${Date.now()}-${Math.random()}`,
    })
  }

  private startPractice(raceTo: number) {
    this.refereeState = this.newMatch(Math.min(100, Math.max(1, raceTo)))
    this.show(this.refereeState)
    this.bridge.send({ t: "game.ready", d: {} })
  }

  private startFree() {
    this.player.place(this.newMatch(10).balls)
    this.free = { cueBall: 0, placing: false, lastStart: null, lastShot: null }
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
      case "err":
        if (frame.id && frame.id === this.pending) {
          this.pending = null
          this.error(d?.code ?? "REJECTED", false, d?.reason)
          this.refresh()
        }
        break
    }
  }

  private serverState(d: any) {
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
    if (d.mySeat === 0 || d.mySeat === 1) {
      this.mySeat = d.mySeat
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
      this.state !== this.refereeState
    ) {
      // practice: everything has been shown, take the referee's full state
      this.state = this.refereeState
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
      case "turn":
        state.turnSeat = event.seat
        state.shotNo = event.shotNo
        state.stage = event.stage
        state.opening = event.opening
        state.frozen = event.frozen
        this.controls.resetSpin()
        this.placeForTurn()
        break
      case "extension":
        state.extensionsLeft[event.seat] = event.left
        break
      case "shootout":
        state.shootout = { round: event.round, runs: event.runs }
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
    if (this.state) {
      this.state.balls = event.final
      this.state.scores = event.scores
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
    if (this.pending || !this.connected || this.paused) {
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
    return this.free !== null && !this.player.playing && !this.free.placing
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
    if (seat !== null && s.opening) {
      this.aimAtRed()
    }
  }

  private aimAtRed() {
    const cueBall = this.cueBall()
    if (cueBall === null) {
      return
    }
    const balls = this.player.table.balls
    const from = balls[cueBall].pos
    const red = balls[2].pos
    this.angle = Math.atan2(red.y - from.y, red.x - from.x)
  }

  private aimChanged() {
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
    this.bridge.send({ t: "game.haptic", d: { kind: "hit" } })
    this.act(seat, action)
  }

  /** Dev host only: play the suggested shot (or a random one in free play). */
  autoHit() {
    const seat = this.shooter()
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
      if (action.type === "shoot") {
        const d: any = { shotNo: action.shotNo, shot: action.shot }
        if (action.side) {
          d.side = action.side
        }
        this.pending = this.netSend("bil.shoot", d)
      } else if (action.type === "respot") {
        this.pending = this.netSend("bil.respot", { shotNo: action.shotNo })
      }
      this.refresh()
      return
    }
    const result = applyAction(this.refereeState!, seat, action)
    if (!result.ok) {
      this.error(result.code, false, result.reason)
      return
    }
    this.refereeState = result.state
    result.events.forEach((e) => this.enqueue(e))
    this.refresh()
  }

  private botTurn() {
    const s = this.refereeState
    if (!s || s.phase !== "playing" || s.turnSeat !== this.botSeat) {
      return
    }
    const seat = s.turnSeat
    setTimeout(() => {
      if (this.refereeState !== s || this.mode !== "practice") {
        return
      }
      const shot = suggestShot(s, seat, Math.random, { tries: 60 })
      this.act(seat, { type: "shoot", shotNo: s.shotNo, shot })
    }, 900)
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
    const free = this.free
    if (name === "rerack") {
      if (free) {
        this.startFree()
      } else {
        this.startPractice(this.refereeState?.config.raceTo ?? 10)
      }
      return
    }
    if (!free) {
      return
    }
    if (name === "placeMode") {
      free.placing = !free.placing
    } else if (name === "undo") {
      this.player.place(free.lastStart!)
    } else if (name === "repeat") {
      this.playFree()
    }
    this.refresh()
  }

  private commands(): CommandName[] {
    if (this.mode === "practice") {
      return this.current || this.queue.length > 0 ? [] : ["rerack"]
    }
    const free = this.free
    if (!free || this.player.playing) {
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
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId)
      const p = at(e)
      if (this.free?.placing && !this.player.playing) {
        this.dragBall = this.ballAt(p.x, p.y)
        this.dragMoved = false
      } else {
        this.aimTo(p.x, p.y)
      }
    })
    canvas.addEventListener("pointermove", (e) => {
      if (!canvas.hasPointerCapture(e.pointerId)) {
        return
      }
      const p = at(e)
      if (this.dragBall !== null) {
        this.dragMoved = true
        this.moveBall(this.dragBall, p.x, p.y)
      } else if (!this.free?.placing) {
        this.aimTo(p.x, p.y)
      }
    })
    const release = () => {
      if (this.dragBall !== null && !this.dragMoved && this.free) {
        // a tap picks the ball to play with
        this.free.cueBall = this.dragBall
      }
      this.dragBall = null
    }
    canvas.addEventListener("pointerup", release)
    canvas.addEventListener("pointercancel", release)
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
    this.controls.setTools(commands, !!this.free?.placing, !this.nativeTools)
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
    const json = JSON.stringify(hud)
    if (json !== this.lastHud) {
      this.lastHud = json
      this.bridge.send({ t: "game.hud", d: hud })
    }
  }

  private lastHud = ""

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

  private drawAim() {
    const table = this.player.table
    const cueBall = this.cueBall()
    const mine = this.shooter() !== null || this.canShootFree()
    if (mine && cueBall !== null) {
      this.view.showAim(table, cueBall, this.angle, this.controls.power)
      this.view.mark(null)
    } else if (this.remoteAim && this.state && !this.current) {
      const ball = this.state.cueBallOf[this.remoteAim.seat]
      this.view.showAim(table, ball, this.remoteAim.angle, 0.3)
      this.view.mark(null)
    } else {
      this.view.hideAim()
      const picked = this.free?.placing
        ? table.balls[this.free.cueBall].pos
        : null
      this.view.mark(picked)
    }
  }
}
