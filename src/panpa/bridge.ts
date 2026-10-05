import { GameMessage, HostMessage } from "./protocol"

type Listener = (message: HostMessage) => void

/**
 * Message channel to whatever hosts the page:
 * - a Flutter web view: outgoing through the `PanpaBridge` JavaScript
 *   channel, incoming through `window.panpa.receive(json)`
 * - a parent page (Flutter web, dev harness): `postMessage` both ways,
 *   accepted only from the page's own origin
 */
export class Bridge {
  private readonly listeners: Listener[] = []

  constructor() {
    const w = globalThis as any
    w.panpa = { receive: (json: unknown) => this.accept(json) }
    globalThis.addEventListener?.("message", (e: MessageEvent) => {
      if (
        e.origin === globalThis.location?.origin &&
        e.source !== (globalThis as unknown)
      ) {
        this.accept(e.data)
      }
    })
  }

  onMessage(listener: Listener) {
    this.listeners.push(listener)
  }

  send(message: GameMessage) {
    const w = globalThis as any
    const json = JSON.stringify(message)
    if (w.PanpaBridge?.postMessage) {
      w.PanpaBridge.postMessage(json)
    } else if (w.parent && w.parent !== w) {
      w.parent.postMessage(json, globalThis.location.origin)
    }
  }

  private accept(raw: unknown) {
    let message: HostMessage
    try {
      message = typeof raw === "string" ? JSON.parse(raw) : (raw as HostMessage)
    } catch {
      return
    }
    if (!message || typeof message.t !== "string") {
      return
    }
    this.listeners.forEach((l) => l(message))
  }
}
