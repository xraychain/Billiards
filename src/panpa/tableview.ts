import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { tableInfo } from "../engine/rules/threecushion"
import { Vec2 } from "../engine/types"
import { Table } from "../model/table"
import { Rect, Theme } from "./protocol"

const DEFAULT_THEME: Required<Theme> = {
  cloth: "#1c5fa5",
  cushion: "#184f8a",
  frame: "#4a2f1d",
}

/**
 * The only view of the game: the table seen from straight above, drawn on a
 * transparent canvas that covers the page. Table coordinates: x along the
 * table to the right, y up.
 */
export class TableView {
  readonly scene = new Scene()
  private readonly renderer: WebGLRenderer
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10)
  private readonly info = tableInfo()
  private readonly cloth = new MeshLambertMaterial()
  private readonly cushion = new MeshLambertMaterial()
  private readonly frame = new MeshLambertMaterial()
  private readonly aimLine: Line
  private readonly objectLine: Line
  private readonly cueAfterLine: Line
  private readonly ghost: Mesh
  private readonly ghostRing: Mesh
  private readonly cueStick: Mesh
  private readonly tipDot: Mesh
  private readonly marker: Mesh
  /** half size of the table including rails, table units */
  private readonly outer: Vec2
  /** pixels per table unit and the pixel the table centre maps to */
  private scale = 1
  private centre: Vec2 = { x: 0, y: 0 }

  constructor(
    readonly canvas: HTMLCanvasElement,
    antialias: boolean
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias,
      powerPreference: "high-performance",
    })
    this.renderer.setClearColor(0x000000, 0)
    this.camera.position.set(0, 0, 5)
    this.camera.lookAt(0, 0, 0)

    const R = this.info.ballRadius
    const rail = 3.4 * R
    this.outer = {
      x: this.info.halfLength + R + rail,
      y: this.info.halfWidth + R + rail,
    }
    this.scene.add(new AmbientLight(0xffffff, 1.9))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(-0.4, 0.5, 2)
    this.scene.add(sun)
    this.scene.add(this.buildTable(rail))

    const line = (opacity: number) =>
      new Line(
        new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
        new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity })
      )
    this.aimLine = line(0.7)
    this.objectLine = line(0.55)
    this.cueAfterLine = line(0.55)
    this.ghost = new Mesh(
      new CircleGeometry(R, 32),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
      })
    )
    this.ghostRing = new Mesh(
      new RingGeometry(R * 0.86, R, 32),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
      })
    )
    this.cueStick = new Mesh(
      new BoxGeometry(1, R * 0.36, R * 0.2),
      new MeshLambertMaterial({ color: 0xd9b48a })
    )
    this.tipDot = new Mesh(
      new CircleGeometry(R * 0.16, 12),
      new MeshBasicMaterial({ color: 0x2f6fd0 })
    )
    this.marker = new Mesh(
      new RingGeometry(R * 1.15, R * 1.3, 32),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
      })
    )
    for (const o of [
      this.aimLine,
      this.objectLine,
      this.cueAfterLine,
      this.ghost,
      this.ghostRing,
      this.cueStick,
      this.tipDot,
      this.marker,
    ]) {
      o.visible = false
      o.position.z = R * 1.2
      this.scene.add(o)
    }
    this.setTheme({})
  }

  private buildTable(rail: number): Group {
    const R = this.info.ballRadius
    const X = this.info.halfLength + R
    const Y = this.info.halfWidth + R
    const group = new Group()
    const box = (w: number, h: number, material, x = 0, y = 0, z = 0) => {
      const mesh = new Mesh(new BoxGeometry(w, h, R * 0.4), material)
      mesh.position.set(x, y, z)
      group.add(mesh)
    }
    box(2 * this.outer.x, 2 * this.outer.y, this.frame, 0, 0, -R * 1.6)
    box(2 * X, 2 * Y, this.cloth, 0, 0, -R * 1.2)
    const nose = 1.1 * R
    box(2 * X + 2 * nose, nose, this.cushion, 0, Y + nose / 2, -R * 0.9)
    box(2 * X + 2 * nose, nose, this.cushion, 0, -Y - nose / 2, -R * 0.9)
    box(nose, 2 * Y, this.cushion, X + nose / 2, 0, -R * 0.9)
    box(nose, 2 * Y, this.cushion, -X - nose / 2, 0, -R * 0.9)

    // diamonds: 8 divisions on the long rails, 4 on the short ones
    const dot = new CircleGeometry(R * 0.22, 12)
    const white = new MeshBasicMaterial({ color: 0xf2ead8 })
    const inset = nose + (rail - nose) / 2
    const diamond = (x: number, y: number) => {
      const mesh = new Mesh(dot, white)
      mesh.position.set(x, y, -R * 0.6)
      group.add(mesh)
    }
    for (let i = 0; i <= 8; i++) {
      const x = -X + (i * 2 * X) / 8
      diamond(x, Y + inset)
      diamond(x, -Y - inset)
    }
    for (let i = 1; i < 4; i++) {
      const y = -Y + (i * 2 * Y) / 4
      diamond(X + inset, y)
      diamond(-X - inset, y)
    }
    return group
  }

  get ballRadius(): number {
    return this.info.ballRadius
  }

  /** half extents of the area ball centres can reach */
  get bounds() {
    return {
      halfLength: this.info.halfLength,
      halfWidth: this.info.halfWidth,
    }
  }

  setTheme(theme: Theme) {
    const t = { ...DEFAULT_THEME, ...theme }
    const set = (material: MeshLambertMaterial, css: string) => {
      try {
        material.color = new Color(css)
      } catch {
        // an unparsable colour keeps the previous one
      }
    }
    set(this.cloth, t.cloth)
    set(this.cushion, t.cushion)
    set(this.frame, t.frame)
  }

  /** Fit the whole table into `area`, keeping its proportions. */
  layout(width: number, height: number, area: Rect) {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.scale = Math.min(
      area.w / (2 * this.outer.x),
      area.h / (2 * this.outer.y)
    )
    this.centre = { x: area.x + area.w / 2, y: area.y + area.h / 2 }
    const s = this.scale
    this.camera.left = -this.centre.x / s
    this.camera.right = (width - this.centre.x) / s
    this.camera.top = this.centre.y / s
    this.camera.bottom = -(height - this.centre.y) / s
    this.camera.updateProjectionMatrix()
  }

  /** Page pixel -> table coordinates. */
  toTable(px: number, py: number): Vec2 {
    return {
      x: (px - this.centre.x) / this.scale,
      y: -(py - this.centre.y) / this.scale,
    }
  }

  pixelsPerUnit(): number {
    return this.scale
  }

  addTable(table: Table) {
    table.balls.forEach((b) => {
      this.scene.add(b.ballmesh.mesh)
      this.scene.add(b.ballmesh.shadow)
    })
  }

  /** Meshes follow the balls; the flat shadow is pushed aside so it shows. */
  syncBalls(table: Table, seconds: number) {
    const R = this.info.ballRadius
    for (const b of table.balls) {
      b.ballmesh.updateAll(b, seconds)
      b.ballmesh.shadow.position.set(
        b.pos.x + R * 0.22,
        b.pos.y - R * 0.22,
        R * 0.2
      )
    }
  }

  /**
   * The cue behind the cue ball, and with `assist` the guide: a line to
   * the first contact, a ghost ball there, and where both balls go next.
   * `offset` is the strike point; the cue moves across with its sideways
   * part and a dot marks it on the ball.
   */
  showAim(
    table: Table,
    cueBall: number,
    angle: number,
    pull: number,
    offset: Vec2 | null,
    assist: boolean
  ) {
    const R = this.info.ballRadius
    const from = table.balls[cueBall].pos
    const dir = new Vector3(Math.cos(angle), Math.sin(angle), 0)
    // to the left of the direction of travel, where positive side spin strikes
    const perp = new Vector3(-dir.y, dir.x, 0)
    const side = (offset?.x ?? 0) * R
    const vertical = (offset?.y ?? 0) * R

    const length = 28 * R
    const back = R * 1.1 + pull * 6 * R + length / 2
    this.cueStick.scale.x = length
    this.cueStick.position
      .copy(from)
      .addScaledVector(dir, -back)
      .addScaledVector(perp, side)
    this.cueStick.position.z = R * 1.3
    this.cueStick.rotation.z = angle
    this.cueStick.visible = true
    this.tipDot.position
      .copy(from)
      .addScaledVector(perp, side)
      .addScaledVector(dir, -vertical * 0.5)
    this.tipDot.position.z = R * 1.25
    this.tipDot.visible = offset !== null

    if (!assist) {
      this.hideGuide()
      return
    }
    let reach = this.cushionDistance(from, dir)
    let object: Vector3 | null = null
    for (const b of table.balls) {
      if (b.id === cueBall) continue
      const to = b.pos.clone().sub(from)
      const along = to.dot(dir)
      const off2 = to.lengthSq() - along * along
      if (along > 0 && off2 < 4 * R * R) {
        const d = along - Math.sqrt(4 * R * R - off2)
        if (d < reach) {
          reach = d
          object = b.pos
        }
      }
    }
    const end = from.clone().addScaledVector(dir, Math.max(0, reach))
    this.setLine(this.aimLine, from, end)
    this.ghost.position.set(end.x, end.y, R * 1.2)
    this.ghostRing.position.set(end.x, end.y, R * 1.21)
    this.ghost.visible = object !== null
    this.ghostRing.visible = object !== null
    if (object) {
      // the object ball leaves along the line of centres; the cue ball
      // along the tangent (a stun shot), the usual first guess
      const n = object.clone().sub(end).normalize()
      this.setLine(
        this.objectLine,
        object,
        object.clone().addScaledVector(n, 4 * R)
      )
      const tangent = dir.clone().addScaledVector(n, -dir.dot(n))
      const t = tangent.length() > 1e-6 ? tangent.normalize() : perp
      this.setLine(
        this.cueAfterLine,
        end,
        end.clone().addScaledVector(t, 3 * R)
      )
      this.objectLine.visible = true
      this.cueAfterLine.visible = true
    } else {
      this.objectLine.visible = false
      this.cueAfterLine.visible = false
    }
  }

  private setLine(line: Line, a: Vector3, b: Vector3) {
    line.geometry.setFromPoints([
      new Vector3(a.x, a.y, 0),
      new Vector3(b.x, b.y, 0),
    ])
    line.visible = true
  }

  private hideGuide() {
    for (const o of [
      this.aimLine,
      this.objectLine,
      this.cueAfterLine,
      this.ghost,
      this.ghostRing,
    ]) {
      o.visible = false
    }
  }

  private cushionDistance(from: Vector3, dir: Vector3): number {
    const { halfLength, halfWidth } = this.info
    let best = Infinity
    if (dir.x > 0) best = Math.min(best, (halfLength - from.x) / dir.x)
    if (dir.x < 0) best = Math.min(best, (-halfLength - from.x) / dir.x)
    if (dir.y > 0) best = Math.min(best, (halfWidth - from.y) / dir.y)
    if (dir.y < 0) best = Math.min(best, (-halfWidth - from.y) / dir.y)
    return best
  }

  hideAim() {
    this.hideGuide()
    this.cueStick.visible = false
    this.tipDot.visible = false
  }

  /** Ring around a ball (the cue ball in turn, or the one picked up). */
  mark(position: Vec2 | null) {
    this.marker.visible = position !== null
    if (position) {
      this.marker.position.set(
        position.x,
        position.y,
        this.info.ballRadius * 1.2
      )
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
