import { Bridge } from "./bridge"
import { Game } from "./game"
import { TableView } from "./tableview"

const canvas = document.getElementById("table") as HTMLCanvasElement
const host = document.getElementById("ui") as HTMLElement
const view = new TableView(canvas, true)
const game = new Game(new Bridge(), view, host)

// for the dev harness and for debugging from the host's console
;(globalThis as any).panpaGame = game
