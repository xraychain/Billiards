import {
  BufferGeometry,
  Float32BufferAttribute,
  Shape,
  ShapeGeometry,
} from "three"
import { Vec2 } from "../engine/types"

/**
 * A flat four-sided piece with its own shading: `tones` give the brightness
 * at each corner (they multiply the material colour) and blend across it.
 * Corners go round the outline in order.
 */
export function shadedQuad(
  corners: [Vec2, Vec2, Vec2, Vec2],
  tones: [number, number, number, number],
  z: number
): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute(
    "position",
    new Float32BufferAttribute(
      corners.flatMap((p) => [p.x, p.y, z]),
      3
    )
  )
  g.setAttribute(
    "color",
    new Float32BufferAttribute(
      tones.flatMap((t) => [t, t, t]),
      3
    )
  )
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

/**
 * One cushion seen from above. A cushion is a wedge: wide and high where it
 * sits on the rail, sloping down to a thin nose where the ball meets it. So
 * it is drawn as a flat slope, lit at the back and falling off towards the
 * nose; its ends are cut at an angle (mitred at the corners, angled into
 * the pocket jaws).
 */
export function cushion(
  noseA: Vec2,
  noseB: Vec2,
  backB: Vec2,
  backA: Vec2,
  z: number
): BufferGeometry {
  return shadedQuad([noseA, noseB, backB, backA], [0.8, 0.8, 0.97, 0.97], z)
}

/** A rectangle with rounded corners, centred, with UVs spanning 0..1. */
export function roundedRect(
  halfW: number,
  halfH: number,
  radius: number
): ShapeGeometry {
  const r = Math.min(radius, halfW, halfH)
  const s = new Shape()
  s.moveTo(-halfW + r, -halfH)
  s.lineTo(halfW - r, -halfH)
  s.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r)
  s.lineTo(halfW, halfH - r)
  s.quadraticCurveTo(halfW, halfH, halfW - r, halfH)
  s.lineTo(-halfW + r, halfH)
  s.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r)
  s.lineTo(-halfW, -halfH + r)
  s.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH)
  const g = new ShapeGeometry(s, 8)
  // ShapeGeometry's UVs are raw coordinates; map them onto the texture
  const pos = g.getAttribute("position")
  const uv = g.getAttribute("uv")
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) + halfW) / (2 * halfW),
      (pos.getY(i) + halfH) / (2 * halfH)
    )
  }
  uv.needsUpdate = true
  return g
}
