import { expect } from "chai"
import { previewSpot, PreviewScene } from "../../src/panpa/previewspot"

const area = { x: 0, y: 0, w: 800, h: 400 }
const base: PreviewScene = {
  cue: { x: 100, y: 200 },
  ghost: { x: 388, y: 200 },
  object: { x: 400, y: 200 },
  dir: { x: 1, y: 0 },
  radius: 6,
  size: 96,
  area,
}

function inside(c, size) {
  const h = size / 2
  return (
    c.x - h >= area.x &&
    c.x + h <= area.x + area.w &&
    c.y - h >= area.y &&
    c.y + h <= area.y + area.h
  )
}

function clearOf(c, size, p, pad) {
  const h = size / 2 + pad
  return Math.abs(p.x - c.x) > h || Math.abs(p.y - c.y) > h
}

describe("panpa cut preview placement", () => {
  it("goes a little past the object ball along the line of aim", () => {
    const c = previewSpot(base)
    expect(c.x).to.be.above(base.object.x + base.size / 2)
    expect(Math.abs(c.y - base.object.y)).to.be.below(1)
    expect(clearOf(c, base.size, base.object, base.radius)).to.equal(true)
  })

  it("stays on the table and off the balls when the object ball is on a cushion", () => {
    const scene = {
      ...base,
      ghost: { x: 778, y: 200 },
      object: { x: 790, y: 200 },
    }
    const c = previewSpot(scene)
    expect(inside(c, scene.size)).to.equal(true)
    expect(clearOf(c, scene.size, scene.object, scene.radius)).to.equal(true)
    expect(clearOf(c, scene.size, scene.cue, scene.radius)).to.equal(true)
  })

  it("does not sit on the line of aim", () => {
    const scene = {
      ...base,
      cue: { x: 700, y: 380 },
      ghost: { x: 712, y: 30 },
      object: { x: 712, y: 18 },
      dir: { x: 0.034, y: -1 },
    }
    const c = previewSpot(scene)
    expect(inside(c, scene.size)).to.equal(true)
    // the aim runs up near x = 706; the box keeps clear of it
    expect(Math.abs(c.x - 706)).to.be.above(scene.size / 2)
  })
})
