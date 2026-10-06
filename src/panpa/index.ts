import { Bridge } from "./bridge"
import { Game } from "./game"
import { TableView } from "./tableview"

// The page is a game surface: no scrolling, pinching or double-tap zoom.
// touch-action in CSS is not enough on every mobile browser, so the
// gestures are refused here as well.
for (const type of ["touchmove", "gesturestart", "gesturechange", "dblclick"]) {
  document.addEventListener(type, (e) => e.preventDefault(), {
    passive: false,
  })
}
let lastTouchEnd = 0
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now()
    if (now - lastTouchEnd < 350) {
      e.preventDefault()
    }
    lastTouchEnd = now
  },
  { passive: false }
)

const canvas = document.getElementById("table") as HTMLCanvasElement
const host = document.getElementById("ui") as HTMLElement
const view = new TableView(canvas, true)
const game = new Game(new Bridge(), view, host)

// for the dev harness and for debugging from the host's console
;(globalThis as any).panpaGame = game
