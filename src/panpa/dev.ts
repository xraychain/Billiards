/**
 * Development host. Stands in for the Flutter app so the bundle can be run
 * in a plain browser: it frames index.html, sends game.init, and in match
 * mode relays between the page and a table node over a WebSocket. It is not
 * part of the released bundle.
 *
 *   dev.html?mode=practice&opponent=bot&raceTo=10&locale=tr
 *   dev.html?mode=free
 *   dev.html?ws=ws://localhost:4300/ws&token=<access token>&table=<tableId>
 *            [&res=<reservation token>] [&spectate] [&log]
 *
 * &auto plays for you: it presses HIT whenever a shot is possible, aiming
 * where the page's own shot suggester points. Useful for unattended runs.
 */
const params = new URLSearchParams(location.search)
const frame = document.getElementById("game") as HTMLIFrameElement
const hud = document.getElementById("hud") as HTMLElement
const logBox = document.getElementById("log") as HTMLElement
logBox.hidden = !params.has("log")

const lines: string[] = []
function log(direction: string, text: string) {
  console.log(direction, text)
  lines.push(`${direction} ${text.slice(0, 160)}`)
  logBox.textContent = lines.slice(-14).join("\n")
}

function toGame(t: string, d: unknown) {
  frame.contentWindow!.postMessage(JSON.stringify({ t, d }), location.origin)
}

let socket: WebSocket | null = null

function init() {
  const ws = params.get("ws")
  let mode = params.get("mode") ?? "practice"
  if (ws) {
    mode = params.has("spectate") ? "spectate" : "match"
  }
  toGame("game.init", {
    bridgeVersion: 1,
    mode,
    ruleType: "threecushion",
    locale: params.get("locale") ?? navigator.language,
    practice: {
      opponent: params.get("opponent") ?? "none",
      raceTo: Number(params.get("raceTo") ?? 10),
    },
    theme: params.has("cloth") ? { cloth: params.get("cloth") } : undefined,
  })
  if (ws) {
    connect(ws)
  }
}

function connect(url: string) {
  const table = params.get("table") ?? ""
  let joined = false
  socket = new WebSocket(url)
  socket.onopen = () => {
    toGame("net.state", { state: "connected" })
    send({
      t: "auth",
      id: "auth",
      d: {
        protocolVersion: 1,
        accessToken: params.get("token") ?? "",
        client: { platform: "web", appVersion: "dev" },
      },
    })
  }
  socket.onmessage = (e) => {
    const text = String(e.data)
    log("<", text)
    if (!joined) {
      // the first frame answers auth; then take the seat
      joined = true
      send({
        t: "table.join",
        id: "join",
        d: {
          tableId: table,
          reservationToken: params.get("res") ?? `dev-${table}-${Date.now()}`,
        },
      })
    }
    const t = frameType(text)
    if (t.startsWith("bil.") || t === "err" || t === "ack") {
      toGame("net.recv", text)
    }
  }
  socket.onclose = () => {
    log("!", "socket closed")
    toGame("net.state", { state: "closed" })
  }
}

function frameType(text: string): string {
  try {
    return String(JSON.parse(text).t)
  } catch {
    return ""
  }
}

function send(envelope: unknown) {
  const text = JSON.stringify(envelope)
  log(">", text)
  socket?.send(text)
}

addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow || typeof e.data !== "string") {
    return
  }
  const message = JSON.parse(e.data)
  if (message.t === "game.loaded") {
    log("<", e.data)
    init()
  } else if (message.t === "net.send") {
    send({ t: message.d.t, id: message.d.id, d: message.d.d })
  } else if (message.t === "game.hud") {
    const h = message.d
    console.log("hud", e.data)
    if (params.has("auto") && h.canShoot) {
      setTimeout(() => (frame.contentWindow as any).panpaGame.autoHit(), 300)
    }
    hud.textContent =
      `${h.mode} ${h.stage ?? ""}  ${h.scores[0]} - ${h.scores[1]}  ` +
      `innings ${h.innings[0]}/${h.innings[1]}  run ${h.run}  ` +
      `turn ${h.turnSeat ?? "-"}${h.canShoot ? " (you)" : ""}` +
      (h.opening ? "  opening" : "") +
      (h.result ? `  RESULT ${JSON.stringify(h.result)}` : "")
  } else {
    log("<", e.data)
  }
})
