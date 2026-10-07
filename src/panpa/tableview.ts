import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
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
import { RuleType, Vec2 } from "../engine/types"
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
  private info = tableInfo()
  private tableGroup: Group
  private readonly pocketMarkers: Mesh[] = []
  private readonly kitchen: Mesh
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
  private outer: Vec2
  /** pixels per table unit and the pixel the table centre maps to */
  private scale = 1
  private centre: Vec2 = { x: 0, y: 0 }
  private lastLayout: { width: number; height: number; area: Rect } | null =
    null

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
    this.outer = this.outerFor(this.info)
    this.scene.add(new AmbientLight(0xffffff, 1.9))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(-0.4, 0.5, 2)
    this.scene.add(sun)
    this.tableGroup = this.buildTable()
    this.scene.add(this.tableGroup)
    this.kitchen = new Mesh(
      new BoxGeometry(1, 1, 0.001),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
      })
    )
    this.kitchen.visible = false
    this.scene.add(this.kitchen)

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

  private outerFor(info: ReturnType<typeof tableInfo>): Vec2 {
    const R = info.ballRadius
    const rail = 3.4 * R
    return {
      x: info.halfLength + R + rail,
      y: info.halfWidth + R + rail,
    }
  }

  /** Rebuild the table for another discipline (pocketed or not). */
  setRule(ruleType: RuleType) {
    if (ruleType === this.info.ruleType) {
      return
    }
    this.info = tableInfo(ruleType)
    this.outer = this.outerFor(this.info)
    this.scene.remove(this.tableGroup)
    this.tableGroup = this.buildTable()
    this.scene.add(this.tableGroup)
    if (this.lastLayout) {
      const { width, height, area } = this.lastLayout
      this.layout(width, height, area)
    }
  }

  private buildTable(): Group {
    const R = this.info.ballRadius
    const X = this.info.halfLength + R
    const Y = this.info.halfWidth + R
    const rail = 3.4 * R
    const group = new Group()
    const box = (w: number, h: number, material, x = 0, y = 0, z = 0) => {
      const mesh = new Mesh(new BoxGeometry(w, h, R * 0.4), material)
      mesh.position.set(x, y, z)
      group.add(mesh)
    }
    box(2 * this.outer.x, 2 * this.outer.y, this.frame, 0, 0, -R * 1.6)
    box(2 * X, 2 * Y, this.cloth, 0, 0, -R * 1.2)
    const nose = 1.1 * R
    if (this.info.hasPockets) {
      this.buildPockets(group, nose)
    } else {
      box(2 * X + 2 * nose, nose, this.cushion, 0, Y + nose / 2, -R * 0.9)
      box(2 * X + 2 * nose, nose, this.cushion, 0, -Y - nose / 2, -R * 0.9)
      box(nose, 2 * Y, this.cushion, X + nose / 2, 0, -R * 0.9)
      box(nose, 2 * Y, this.cushion, -X - nose / 2, 0, -R * 0.9)
    }

    // diamonds: 8 divisions on the long rails, 4 on the short ones
    const dot = new CircleGeometry(R * 0.22, 12)
    const white = new MeshBasicMaterial({ color: 0xf2ead8 })
    const inset = nose + (rail - nose) / 2
    const diamond = (x: number, y: number) => {
      const mesh = new Mesh(dot, white)
      mesh.position.set(x, y, -R * 0.6)
      group.add(mesh)
    }
    for (let i = 1; i < 8; i++) {
      const x = -X + (i * 2 * X) / 8
      if (this.info.hasPockets && i === 4) continue
      diamond(x, Y + inset)
      diamond(x, -Y - inset)
    }
    for (let i = 1; i < 4; i++) {
      const y = -Y + (i * 2 * Y) / 4
      diamond(X + inset, y)
      diamond(-X - inset, y)
    }
    if (!this.info.hasPockets) {
      for (const x of [-X, X]) {
        diamond(x, Y + inset)
        diamond(x, -Y - inset)
      }
    }
    return group
  }

  /** Cushion segments between the pocket jaws, the jaws, and the holes. */
  private buildPockets(group: Group, nose: number) {
    const R = this.info.ballRadius
    const X = this.info.halfLength + R
    const Y = this.info.halfWidth + R
    const k = this.info.knuckles
    const segment = (a: Vec2, b: Vec2, vertical: boolean) => {
      const length = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x)
      const mesh = new Mesh(
        new BoxGeometry(
          vertical ? nose : length,
          vertical ? length : nose,
          R * 0.4
        ),
        this.cushion
      )
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      mesh.position.set(
        vertical ? Math.sign(mx) * (X + nose / 2) : mx,
        vertical ? my : Math.sign(my) * (Y + nose / 2),
        -R * 0.9
      )
      group.add(mesh)
    }
    // knuckles come in pairs along each cushion run (see PocketGeometry)
    segment(k[0], k[2], false) // NW -> N, top rail
    segment(k[3], k[6], false) // N -> NE, top rail
    segment(k[4], k[11], false) // S -> SW, bottom rail
    segment(k[5], k[9], false) // S -> SE, bottom rail
    segment(k[1], k[10], true) // NW -> SW, left rail
    segment(k[7], k[8], true) // NE -> SE, right rail
    const jaw = new MeshLambertMaterial({ color: this.cushion.color })
    for (const j of k) {
      const mesh = new Mesh(
        new CylinderGeometry(j.radius, j.radius, R * 0.4, 12),
        jaw
      )
      mesh.rotation.x = Math.PI / 2
      mesh.position.set(j.x, j.y, -R * 0.9)
      group.add(mesh)
    }
    const hole = new MeshBasicMaterial({ color: 0x0b0b10 })
    this.pocketMarkers.forEach((m) => this.scene.remove(m))
    this.pocketMarkers.length = 0
    for (const p of this.info.pockets) {
      const mesh = new Mesh(new CircleGeometry(p.radius, 24), hole)
      mesh.position.set(p.x, p.y, -R * 1.0)
      group.add(mesh)
      const marker = new Mesh(
        new RingGeometry(p.radius * 0.9, p.radius * 1.15, 32),
        new MeshBasicMaterial({
          color: 0xffd34d,
          transparent: true,
          opacity: 0.9,
        })
      )
      marker.position.set(p.x, p.y, R * 1.1)
      marker.visible = false
      this.pocketMarkers.push(marker)
      this.scene.add(marker)
    }
  }

  /** Pool: show the pockets as targets for a call; `selected` glows. */
  showPockets(visible: boolean, selected: number | null = null) {
    this.pocketMarkers.forEach((m, i) => {
      m.visible = visible
      const material = m.material as MeshBasicMaterial
      material.opacity = i === selected ? 1 : 0.45
      material.color.set(i === selected ? 0xffffff : 0xffd34d)
    })
  }

  /** Nearest pocket to a table point, if the point is close to one. */
  pocketAt(p: Vec2): number | null {
    let best: number | null = null
    let bestD = Infinity
    this.info.pockets.forEach((pk, i) => {
      const d = Math.hypot(pk.x - p.x, pk.y - p.y)
      if (d < pk.radius * 1.6 && d < bestD) {
        best = i
        bestD = d
      }
    })
    return best
  }

  /** Pool: the area behind the head string where the cue ball may go. */
  showKitchen(visible: boolean) {
    this.kitchen.visible = visible
    if (visible) {
      const R = this.info.ballRadius
      const left = -(this.info.halfLength + R)
      const right = this.info.headString
      const Y = this.info.halfWidth + R
      this.kitchen.scale.set(right - left, 2 * Y, 1)
      this.kitchen.position.set((left + right) / 2, 0, -R * 1.1)
    }
  }

  get headString(): number {
    return this.info.headString
  }

  get hasPockets(): boolean {
    return this.info.hasPockets
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
    this.lastLayout = { width, height, area }
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

  removeTable(table: Table) {
    table.balls.forEach((b) => {
      this.scene.remove(b.ballmesh.mesh)
      this.scene.remove(b.ballmesh.shadow)
    })
  }

  /** Meshes follow the balls; the flat shadow is pushed aside so it shows. */
  syncBalls(table: Table, seconds: number) {
    const R = this.info.ballRadius
    for (const b of table.balls) {
      const shown = b.onTable() || b.pos.z > -R
      b.ballmesh.mesh.visible = shown
      b.ballmesh.shadow.visible = shown
      if (!shown) continue
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
