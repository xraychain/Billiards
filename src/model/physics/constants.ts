export let mu = 0.0055 // Han rolling friction
export let muS = 0.126 // Han sliding friction
export let rho = 0.045 // Han spindown rate

export let m = 0.23
export let R = 0.03275
export const g = 9.8

// Mathavan cushion coefficient of restitution
export let ee = 0.85

// Mathavan coefficient (table)
export let μs = 0.2

// Mathavan coefficient (cushion)
export let μw = 0.175

// Stronge slip stick ratio (cushion)
export let stronge_omega_ratio = 1.76

// Stronge restitution (cushion)
export let stronge_e_n = 0.77

// Stronge friction (cushion)
export let stronge_μ = 0.25

export let Mz: number
export let Mxy: number
export let I: number

export let e = 0.86 // Han cushion coefficient of restitution - unused
export let muC = 0.85 // Han cushion friction- unused

// Angle of cushion contact point above ball center (set per table)
export let sinθ = 2 / 5
// Angle of cushion contact point above ball center (set per table)
export let cosθ = Math.sqrt(21) / 5

// Share of the side the tip gives that turns into spin (set per table)
export let sideSpin = 1

// How far from centre the tip actually strikes for a strike point on the pad:
// the pad's furthest point (the tip's edge at the ball's edge) is a real
// offset of tipReach × offCenterLimit (set per table)
export let tipReach = 1

// Speed lost to an off-centre hit: the ball leaves at 1 / (1 + tipLoss · b²)
// of a centre hit's speed for a real offset b (in R), after Alciatore TP A.30.
// 0 keeps the original 1 − 0.25 · b² (set per table)
export let tipLoss = 0

// Cushion friction falls as the ball runs faster along the rubber:
// μw / (1 + μwFade · speed along the cushion in m/s). 0 keeps it constant
// (set per table)
export let μwFade = 0

// The pad shows the cue ball: its edge is 0.5. A tip a fifth of the ball's
// width (11.9 mm on 61.5 mm) reaches the edge with its centre at 0.4.
export const offCenterLimit = 0.4
export const maxPower = 176 * R

refresh()

function refresh() {
  Mz = ((mu * m * g * 2) / 3) * rho
  Mxy = (7 / (5 * Math.sqrt(2))) * R * mu * m * g
  I = (2 / 5) * m * R * R
}

export function setR(val: number) {
  R = val
  refresh()
}
export function setm(val: number) {
  m = val
  refresh()
}
export function setmu(val: number) {
  mu = val
  refresh()
}
export function setrho(val: number) {
  rho = val
  refresh()
}
export function setmuS(val: number) {
  muS = val
}
export function sete(val: number) {
  e = val
}
export function setmuC(val: number) {
  muC = val
}
export function setμs(val: number) {
  μs = val
}
export function setμw(val: number) {
  μw = val
}
export function setee(val: number) {
  ee = val
}

export function setstronge_omega_ratio(val: number) {
  stronge_omega_ratio = val
}
export function setstronge_e_n(val: number) {
  stronge_e_n = val
}
export function setstronge_μ(val: number) {
  stronge_μ = val
}

export function settipReach(val: number) {
  tipReach = val
}

export function settipLoss(val: number) {
  tipLoss = val
}

export function setμwFade(val: number) {
  μwFade = val
}

export function setsideSpin(val: number) {
  sideSpin = val
}

/** height of the cushion's contact point above the ball centre, as sin θ */
export function setsinθ(val: number) {
  sinθ = val
  cosθ = Math.sqrt(1 - val * val)
}
