import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three"
import { seededRandom } from "../engine/random"

/**
 * Textures for the top view, drawn in code so the package needs no image
 * files. They are grey: the theme colour multiplies them, so a salon theme
 * still decides the colours while these give the surface its grain and its
 * light.
 */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return { c, g: c.getContext("2d")! }
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * Billiard cloth seen from above: a fine worsted grain running along the
 * table, a faint mottle, two pools of light under the lamps, and the shade
 * the cushions cast along every edge. `edge` is the width of that shade as a
 * fraction of the table's width.
 */
export function clothTexture(aspect: number, edge: number): CanvasTexture {
  const h = 512
  const w = Math.round(h * aspect)
  const { c, g } = canvas(w, h)
  const random = seededRandom("cloth")

  // fibres: per-pixel noise, smeared along the length (the nap)
  const image = g.createImageData(w, h)
  const d = image.data
  for (let y = 0; y < h; y++) {
    let run = 0
    for (let x = 0; x < w; x++) {
      run = run * 0.6 + (random() - 0.5) * 0.4
      const v = 232 + run * 26 + (random() - 0.5) * 10
      const i = (y * w + x) * 4
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v))
      d[i + 3] = 255
    }
  }
  g.putImageData(image, 0, 0)

  // mottle: large soft blotches, barely there
  for (let i = 0; i < 40; i++) {
    const x = random() * w
    const y = random() * h
    const r = (0.08 + random() * 0.18) * h
    const blotch = g.createRadialGradient(x, y, 0, x, y, r)
    const a = 0.025 + random() * 0.03
    const tone = random() < 0.5 ? "0,0,0" : "255,255,255"
    blotch.addColorStop(0, `rgba(${tone},${a})`)
    blotch.addColorStop(1, `rgba(${tone},0)`)
    g.fillStyle = blotch
    g.fillRect(0, 0, w, h)
  }

  // light: two lamps over the table, darker towards the rails
  for (const lx of [0.3, 0.7]) {
    const lamp = g.createRadialGradient(
      lx * w,
      h / 2,
      0,
      lx * w,
      h / 2,
      w * 0.42
    )
    lamp.addColorStop(0, "rgba(255,255,255,0.10)")
    lamp.addColorStop(1, "rgba(255,255,255,0)")
    g.fillStyle = lamp
    g.fillRect(0, 0, w, h)
  }
  const vignette = g.createRadialGradient(
    w / 2,
    h / 2,
    h * 0.3,
    w / 2,
    h / 2,
    w * 0.62
  )
  vignette.addColorStop(0, "rgba(0,0,0,0)")
  vignette.addColorStop(1, "rgba(0,0,0,0.16)")
  g.fillStyle = vignette
  g.fillRect(0, 0, w, h)

  // the cushions' shade along each edge
  const e = Math.max(4, edge * h)
  const shade = (x0: number, y0: number, x1: number, y1: number) => {
    const s = g.createLinearGradient(x0, y0, x1, y1)
    s.addColorStop(0, "rgba(0,0,0,0.30)")
    s.addColorStop(0.35, "rgba(0,0,0,0.10)")
    s.addColorStop(1, "rgba(0,0,0,0)")
    g.fillStyle = s
    g.fillRect(
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.abs(x1 - x0) || w,
      Math.abs(y1 - y0) || h
    )
  }
  shade(0, 0, 0, e)
  shade(0, h, 0, h - e)
  shade(0, 0, e, 0)
  shade(w, 0, w - e, 0)

  return texture(c)
}

/** Polished wood for the frame: long grain with a few darker streaks. */
export function woodTexture(): CanvasTexture {
  const w = 1024
  const h = 256
  const { c, g } = canvas(w, h)
  const random = seededRandom("wood")
  const image = g.createImageData(w, h)
  const d = image.data
  const waves = Array.from({ length: 6 }, () => ({
    f: 2 + random() * 9,
    p: random() * Math.PI * 2,
    a: 0.6 + random() * 1.4,
  }))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bend = 0
      for (const wave of waves) {
        bend += Math.sin((x / w) * wave.f + wave.p) * wave.a
      }
      const ring = Math.sin((y + bend * 6) * 0.42) * 0.5 + 0.5
      const fine = (random() - 0.5) * 0.06
      const v = 0.78 + ring * 0.16 + fine
      const i = (y * w + x) * 4
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v * 255))
      d[i + 3] = 255
    }
  }
  g.putImageData(image, 0, 0)
  // varnish: a soft sheen across the middle
  const sheen = g.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, "rgba(255,255,255,0)")
  sheen.addColorStop(0.5, "rgba(255,255,255,0.08)")
  sheen.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = sheen
  g.fillRect(0, 0, w, h)
  const t = texture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}

export type RailSide = "top" | "bottom" | "left" | "right"

/**
 * Cushion top: the cloth over the rubber, lit from above, darkening into
 * the nose where it meets the bed. Drawn for one rail so the nose faces
 * the playing surface (canvas top is +y on the table).
 */
export function cushionTexture(side: RailSide): CanvasTexture {
  const n = 64
  const { c, g } = canvas(n, n)
  const from = {
    top: [0, 0, 0, n],
    bottom: [0, n, 0, 0],
    left: [0, 0, n, 0],
    right: [n, 0, 0, 0],
  }[side]
  const s = g.createLinearGradient(from[0], from[1], from[2], from[3])
  s.addColorStop(0, "#c4c4c4")
  s.addColorStop(0.4, "#f4f4f4")
  s.addColorStop(0.8, "#dcdcdc")
  s.addColorStop(1, "#6e6e6e")
  g.fillStyle = s
  g.fillRect(0, 0, n, n)
  return texture(c)
}

/** Soft round shadow, darkest under the ball. */
export function shadowTexture(): CanvasTexture {
  const n = 128
  const { c, g } = canvas(n, n)
  const s = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
  s.addColorStop(0, "rgba(0,0,0,0.55)")
  s.addColorStop(0.55, "rgba(0,0,0,0.35)")
  s.addColorStop(1, "rgba(0,0,0,0)")
  g.fillStyle = s
  g.fillRect(0, 0, n, n)
  return texture(c)
}

/** Mother-of-pearl inlay for the diamonds. */
export function pearlTexture(): CanvasTexture {
  const n = 64
  const { c, g } = canvas(n, n)
  const s = g.createRadialGradient(n * 0.4, n * 0.38, 0, n / 2, n / 2, n / 2)
  s.addColorStop(0, "#ffffff")
  s.addColorStop(0.5, "#ecebe4")
  s.addColorStop(0.85, "#c9cbd6")
  s.addColorStop(1, "#9a9aa4")
  g.fillStyle = s
  g.beginPath()
  g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2)
  g.fill()
  return texture(c)
}
