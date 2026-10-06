import { ShotLimits, Side, Vec2 } from "../engine/types"
import { t, TextKey } from "./i18n"
import { CommandName, Rect } from "./protocol"

export interface ControlHandlers {
  onChange(): void
  onHit(): void
  onRespot(): void
  onCommand(name: CommandName): void
}

function el(tag: string, className: string, parent: HTMLElement): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  parent.appendChild(node)
  return node
}

/**
 * Track a press-and-drag on `target`, reporting pointer positions. The
 * press is kept to the control: it never reaches the table underneath and
 * the browser gets no chance to scroll or zoom with it.
 */
function drag(target: HTMLElement, move: (e: PointerEvent) => void) {
  let active: number | null = null
  target.addEventListener("pointerdown", (e) => {
    if (active !== null || !e.isPrimary) {
      return
    }
    active = e.pointerId
    e.preventDefault()
    e.stopPropagation()
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // capture is a convenience; the pointer id check below still works
    }
    move(e)
  })
  target.addEventListener("pointermove", (e) => {
    if (e.pointerId === active) {
      e.preventDefault()
      e.stopPropagation()
      move(e)
    }
  })
  const release = (e: PointerEvent) => {
    if (e.pointerId === active) {
      active = null
      e.stopPropagation()
    }
  }
  target.addEventListener("pointerup", release)
  target.addEventListener("pointercancel", release)
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    target.addEventListener(type, (e) => e.stopPropagation(), {
      passive: false,
    })
  }
}

/**
 * The aiming controls that live beside the table: where the tip strikes
 * the cue ball, how hard, and the button that plays the shot.
 */
export class Controls {
  /** strike point, engine convention: +y is above centre, +x is left */
  offset: Vec2 = { x: 0, y: 0 }
  /** 0..1 of the power range */
  power = 0.5
  side: Side = "right"

  private readonly root: HTMLElement
  private readonly pad: HTMLElement
  private readonly tip: HTMLElement
  private readonly bar: HTMLElement
  private readonly fill: HTMLElement
  private readonly hit: HTMLButtonElement
  private readonly sideButton: HTMLButtonElement
  private readonly respot: HTMLButtonElement
  private readonly tools: HTMLElement
  private readonly toolButtons = new Map<CommandName, HTMLButtonElement>()
  private readonly thickness: HTMLElement
  private readonly thicknessObject: HTMLElement
  private readonly thicknessValue: HTMLElement
  private thicknessTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    host: HTMLElement,
    private readonly limits: ShotLimits,
    private readonly handlers: ControlHandlers
  ) {
    this.root = el("div", "controls", host)
    this.pad = el("div", "pad", this.root)
    this.tip = el("div", "tip", this.pad)
    this.bar = el("div", "bar", this.root)
    this.fill = el("div", "fill", this.bar)
    this.sideButton = el("button", "small", this.root) as HTMLButtonElement
    this.respot = el("button", "small", this.root) as HTMLButtonElement
    this.hit = el("button", "hit", this.root) as HTMLButtonElement
    this.tools = el("div", "tools", host)
    this.thickness = el("div", "thickness", host)
    const balls = el("div", "thickness-balls", this.thickness)
    this.thicknessObject = el("div", "thickness-object", balls)
    el("div", "thickness-cue", balls)
    this.thicknessValue = el("div", "thickness-value", this.thickness)
    this.thickness.hidden = true

    drag(this.pad, (e) => this.movePad(e))
    drag(this.bar, (e) => this.moveBar(e))
    for (const node of [this.root, this.tools]) {
      node.addEventListener("pointerdown", (e) => e.stopPropagation())
    }
    this.hit.addEventListener("click", () => this.handlers.onHit())
    this.respot.addEventListener("click", () => this.handlers.onRespot())
    this.sideButton.addEventListener("click", () => {
      this.side = this.side === "left" ? "right" : "left"
      this.refreshText()
      this.handlers.onChange()
    })
    const names: CommandName[] = ["placeMode", "undo", "repeat", "rerack"]
    for (const name of names) {
      const button = el("button", "tool", this.tools) as HTMLButtonElement
      button.addEventListener("click", () => this.handlers.onCommand(name))
      this.toolButtons.set(name, button)
    }
    this.refreshText()
    this.draw()
    this.setState({ canShoot: false, opening: false, frozen: false })
    this.setTools([], false)
  }

  refreshText() {
    this.hit.textContent = t("hit")
    this.respot.textContent = t("respot")
    this.sideButton.textContent = t(this.side)
    this.toolButtons.forEach((button, name) => {
      button.textContent = t(name as TextKey)
    })
  }

  layout(area: Rect) {
    const s = this.root.style
    s.left = `${area.x}px`
    s.top = `${area.y}px`
    s.width = `${area.w}px`
    s.height = `${area.h}px`
  }

  /** Practice and free play buttons, along the top of the table area. */
  layoutTools(tableArea: Rect) {
    const s = this.tools.style
    s.left = `${tableArea.x}px`
    s.top = `${tableArea.y}px`
    s.width = `${tableArea.w}px`
    const t = this.thickness.style
    t.left = `${tableArea.x + tableArea.w / 2}px`
    t.top = `${tableArea.y + tableArea.h / 2}px`
    const size = Math.round(Math.min(tableArea.h * 0.42, 150))
    t.setProperty("--thickness-size", `${size}px`)
  }

  /**
   * The cut seen from behind the cue ball: the object ball's silhouette
   * behind it, shifted by `overlap` (in cue ball radii, positive to the
   * right), with the thickness of the hit as a percentage. Shown while
   * aiming and shortly after; null when nothing is in the line of aim.
   */
  showThickness(hit: { overlap: number; colour: string } | null) {
    this.thickness.hidden = false
    if (this.thicknessTimer) {
      clearTimeout(this.thicknessTimer)
    }
    this.thicknessTimer = setTimeout(() => this.hideThickness(), 900)
    if (!hit) {
      this.thicknessObject.style.visibility = "hidden"
      this.thicknessValue.textContent = ""
      return
    }
    const percent = Math.round(
      (1 - Math.min(Math.abs(hit.overlap) / 2, 1)) * 100
    )
    this.thicknessObject.style.visibility = "visible"
    this.thicknessObject.style.left = `${50 + hit.overlap * 45}%`
    this.thicknessObject.style.background = hit.colour
    this.thicknessValue.textContent = `${percent}%`
  }

  hideThickness() {
    this.thickness.hidden = true
    if (this.thicknessTimer) {
      clearTimeout(this.thicknessTimer)
      this.thicknessTimer = null
    }
  }

  setState(state: { canShoot: boolean; opening: boolean; frozen: boolean }) {
    this.root.classList.toggle("off", !state.canShoot)
    this.hit.disabled = !state.canShoot
    this.sideButton.hidden = !(state.canShoot && state.opening)
    this.respot.hidden = !(state.canShoot && state.frozen)
  }

  /** Show the given commands; `active` highlights the place-balls toggle. */
  setTools(available: CommandName[], placing: boolean, visible = true) {
    this.tools.hidden = !visible || available.length === 0
    this.toolButtons.forEach((button, name) => {
      button.hidden = !available.includes(name)
      button.classList.toggle("on", name === "placeMode" && placing)
    })
  }

  /** Power in engine units. */
  shotPower(): number {
    const [min, max] = this.limits.power
    return min + this.power * (max - min)
  }

  resetSpin() {
    this.offset = { x: 0, y: 0 }
    this.draw()
  }

  private movePad(e: PointerEvent) {
    const box = this.pad.getBoundingClientRect()
    const r = box.width / 2
    // the pad is the cue ball seen from behind: right of centre is -x
    let x = -(e.clientX - box.left - r) / (2 * r)
    let y = -(e.clientY - box.top - r) / (2 * r)
    const length = Math.hypot(x, y)
    if (length > this.limits.offsetMax) {
      x *= this.limits.offsetMax / length
      y *= this.limits.offsetMax / length
    }
    this.offset = { x, y }
    this.draw()
    this.handlers.onChange()
  }

  private moveBar(e: PointerEvent) {
    const box = this.bar.getBoundingClientRect()
    const v = 1 - (e.clientY - box.top) / box.height
    this.power = Math.min(1, Math.max(0, v))
    this.draw()
    this.handlers.onChange()
  }

  private draw() {
    this.tip.style.left = `${50 - this.offset.x * 100}%`
    this.tip.style.top = `${50 - this.offset.y * 100}%`
    this.fill.style.height = `${this.power * 100}%`
  }
}
