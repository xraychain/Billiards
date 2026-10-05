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

/** Track a press-and-drag on `target`, reporting pointer positions. */
function drag(target: HTMLElement, move: (e: PointerEvent) => void) {
  target.addEventListener("pointerdown", (e) => {
    target.setPointerCapture(e.pointerId)
    move(e)
    e.preventDefault()
  })
  target.addEventListener("pointermove", (e) => {
    if (target.hasPointerCapture(e.pointerId)) {
      move(e)
    }
  })
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

    drag(this.pad, (e) => this.movePad(e))
    drag(this.bar, (e) => this.moveBar(e))
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
