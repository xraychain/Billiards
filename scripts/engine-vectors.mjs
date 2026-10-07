// Golden vectors for the match engine.
//   node scripts/engine-vectors.mjs gen      write vectors/threecushion.json
//   node scripts/engine-vectors.mjs check    replay them in Node
//   node scripts/engine-vectors.mjs jsc      replay them in JavaScriptCore (macOS)
//   node scripts/engine-vectors.mjs bench    CPU time per shot
//   node scripts/engine-vectors.mjs heavy    write vectors/threecushion-heavy.json
//   node scripts/engine-vectors.mjs stats    what the vectors cover
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FILE = "vectors/threecushion.json"
/** every discipline gets its own golden file */
const RULE_FILES = {
  threecushion: "vectors/threecushion.json",
  sagu: "vectors/sagu.json",
  nineball: "vectors/nineball.json",
  eightball: "vectors/eightball.json",
}
const POOL = ["nineball", "eightball"]
/** the discipline being generated; set by `gen` per file */
let RULE = "threecushion"
const HEAVY_FILE = "vectors/threecushion-heavy.json"
const SELFCHECK_FILE = "src/panpa/selfcheck.json"
const JSC =
  "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"

function lcg(seed) {
  let a = seed >>> 0
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
}

function randomShot(E, random) {
  const [pMin, pMax] = E.SHOT_LIMITS.power
  const r = random() * E.SHOT_LIMITS.offsetMax * 0.99
  const a = random() * 2 * Math.PI
  return {
    angle: (random() * 2 - 1) * Math.PI,
    power: pMin + random() * (pMax - pMin),
    elevation: random() < 0.8 ? 0 : random() * E.SHOT_LIMITS.elevation[1],
    offset: { x: r * Math.cos(a), y: r * Math.sin(a) },
  }
}

function newMatch(E, seed, firstSeat, overrides = {}) {
  return E.createMatch({
    ruleType: RULE,
    raceTo: 100,
    equalizingInning: true,
    tieBreak: "shootout",
    timeoutLimit: 3,
    firstSeat,
    seed,
    ...overrides,
  })
}

/** Long matches of purely random shots: broad physics coverage. */
function randomMatches(E, random, vectors, matches, shotsPerMatch) {
  for (let m = 0; m < matches; m++) {
    let state = newMatch(E, `vector-${m}`, m % 2)
    for (let i = 0; i < shotsPerMatch && state.phase === "playing"; i++) {
      const seat = state.turnSeat
      const action = {
        type: "shoot",
        shotNo: state.shotNo,
        shot: randomShot(E, random),
      }
      const result = E.applyAction(state, seat, action)
      vectors.push({ state, seat, action, expected: result })
      if (!result.ok) break
      state = result.state
    }
  }
}

/** A random shot, or with `tries` > 0 the first scoring one found. */
function findShot(E, random, state, tries, side) {
  let shot = randomShot(E, random)
  for (let n = 0; n < tries; n++) {
    const action = { type: "shoot", shotNo: state.shotNo, shot }
    if (side) action.side = side
    const r = E.applyAction(state, state.turnSeat, action)
    if (r.ok && r.events[0].outcome.points > 0) break
    shot = randomShot(E, random)
  }
  return shot
}

const RACE_CONFIGS = [
  { equalizingInning: true, tieBreak: "shootout", timeoutLimit: 3 },
  { equalizingInning: true, tieBreak: "draw", timeoutLimit: 0, extensions: 0 },
  { equalizingInning: false, tieBreak: "draw", timeoutLimit: 2 },
]

/**
 * Random shots almost never score, so also play short races to the end:
 * scoring shots mixed with misses, time fouls, time-outs, rejected actions
 * and concessions, so every branch of the rules is covered.
 */
function shortRaces(E, random, vectors, matches) {
  for (let m = 0; m < matches; m++) {
    const overrides = { raceTo: 2, ...RACE_CONFIGS[m % RACE_CONFIGS.length] }
    let state = newMatch(E, `race-${m}`, m % 2, overrides)
    const push = (seat, action) => {
      const result = E.applyAction(state, seat, action)
      vectors.push({ state, seat, action, expected: result })
      if (result.ok) state = result.state
    }
    for (let turn = 0; turn < 60 && state.phase === "playing"; turn++) {
      raceTurn(E, random, state, push)
    }
    push(state.turnSeat, { type: "timeout" })
  }
}

function raceTurn(E, random, state, push) {
  const seat = state.turnSeat
  const shotNo = state.shotNo
  const shoot = (who, no, shot, side) => {
    const action = { type: "shoot", shotNo: no, shot }
    if (side) action.side = side
    push(who, action)
  }
  const roll = random()
  if (roll < 0.14) {
    push(seat, { type: "timeout" })
  } else if (roll < 0.24) {
    const tooHard = randomShot(E, random)
    tooHard.power = E.SHOT_LIMITS.power[1] * 1.5
    shoot(seat === 0 ? 1 : 0, shotNo, randomShot(E, random))
    shoot(seat, shotNo + 1, randomShot(E, random))
    shoot(seat, shotNo, tooHard)
    push(seat, { type: "respot", shotNo })
  } else if (roll < 0.25) {
    push(seat, { type: "concede" })
  } else {
    // side is only legal on the starting position; offering it elsewhere
    // now and then records the rejection too
    const side = state.opening || random() < 0.05 ? pick(random) : undefined
    const tries = random() < 0.55 ? 2500 : 0
    shoot(seat, shotNo, findShot(E, random, state, tries, side), side)
  }
}

function pick(random) {
  return random() < 0.5 ? "left" : "right"
}

/**
 * Balls come to rest touching far too rarely for random play to cover
 * art. 27, so build those positions by hand: the cue ball against one or
 * both object balls, and against a cushion.
 */
function contactCases(E, random, vectors) {
  const t = E.tableInfo()
  const d = 2 * t.ballRadius
  const layouts = [
    // cue ball touching the red, opponent ball elsewhere
    { cue: [0.2, 0.1], opp: [-0.6, -0.3], red: [0.2 + d, 0.1] },
    // touching the opponent's ball, which sits on the top spot
    { cue: [t.spots.top.x - d, 0], opp: [t.spots.top.x, 0], red: [-0.3, 0.3] },
    // touching both
    { cue: [0, 0.2], opp: [-d, 0.2], red: [d, 0.2] },
    // cue ball against the long cushion
    { cue: [0.3, t.halfWidth], opp: [-0.5, 0], red: [0.6, -0.2] },
  ]
  layouts.forEach((layout, i) => {
    const seatFirst = i % 2
    const base = newMatch(E, `contact-${i}`, seatFirst)
    const cueBall = base.cueBallOf[base.turnSeat]
    const at = []
    at[cueBall] = layout.cue
    at[cueBall === 0 ? 1 : 0] = layout.opp
    at[2] = layout.red
    const balls = at.map((p, id) => ({
      id,
      x: Math.fround(p[0]),
      y: Math.fround(p[1]),
    }))
    const state = {
      ...base,
      balls,
      opening: false,
      frozen: E.frozenTo(balls, cueBall),
      shotNo: 5,
    }
    const push = (action) => {
      vectors.push({
        state,
        seat: state.turnSeat,
        action,
        expected: E.applyAction(state, state.turnSeat, action),
      })
    }
    push({ type: "respot", shotNo: 5 })
    for (let k = 0; k < 8; k++) {
      // straight at each neighbour and at the cushion, then random
      const shot = randomShot(E, random)
      if (k === 0) shot.angle = 0
      if (k === 1) shot.angle = Math.PI
      if (k === 2) shot.angle = Math.PI / 2
      if (k < 3) shot.elevation = 0
      push({ type: "shoot", shotNo: 5, shot })
    }
  })
}

/**
 * Pool: whole matches played with the suggester, with random answers to
 * choices, ball-in-hand placements (some illegal), calls and a sprinkling
 * of rejected actions.
 */
function poolMatches(E, random, vectors, matches) {
  for (let m = 0; m < matches; m++) {
    let state = newMatch(E, `${RULE}-${m}`, m % 2, { raceTo: 2 })
    const push = (seat, action) => {
      const result = E.applyAction(state, seat, action)
      vectors.push({ state, seat, action, expected: result })
      if (result.ok) state = result.state
      return result
    }
    for (let step = 0; step < 160 && state.phase === "playing"; step++) {
      poolStep(E, random, state, push)
    }
  }
}

function answerChoice(random, state, push) {
  const seat = state.turnSeat
  const options = state.pool.pendingChoice.options
  if (random() < 0.1) {
    push(seat, { type: "choice", shotNo: state.shotNo, option: "nonsense" })
  }
  push(seat, {
    type: "choice",
    shotNo: state.shotNo,
    option: options[Math.floor(random() * options.length)],
  })
}

/** An illegal spot now and then, then a legal one. */
function placeCueBall(random, state, push) {
  const seat = state.turnSeat
  const kitchen = state.pool.ballInHand === "kitchen"
  if (random() < 0.3) {
    push(seat, {
      type: "placeBall",
      shotNo: state.shotNo,
      pos: { x: 0.9, y: 0 },
    })
  }
  for (let k = 0; k < 60; k++) {
    const pos = kitchen
      ? { x: -1.1 + 0.3 * random(), y: 0.7 * (random() - 0.5) }
      : { x: 1.5 * (random() - 0.5), y: 0.7 * (random() - 0.5) }
    if (push(seat, { type: "placeBall", shotNo: state.shotNo, pos }).ok) break
  }
}

function poolStep(E, random, state, push) {
  if (state.pool.pendingChoice) {
    answerChoice(random, state, push)
    return
  }
  if (state.pool.ballInHand !== "none") {
    placeCueBall(random, state, push)
  }
  const seat = state.turnSeat
  const shotNo = state.shotNo
  const roll = random()
  if (roll < 0.05) {
    push(seat, { type: "timeout" })
    return
  }
  if (roll < 0.1) {
    push(seat === 0 ? 1 : 0, {
      type: "shoot",
      shotNo,
      shot: randomShot(E, random),
    })
  }
  const shot = E.suggestShot(state, seat, random, { tries: 25 })
  if (RULE === "eightball" && !state.pool.breakShot) {
    const call = E.suggestCall(state, seat, shot)
    if (random() < 0.1) push(seat, { type: "shoot", shotNo, shot })
    push(
      seat,
      call === "safety"
        ? { type: "call", shotNo, safety: true }
        : { type: "call", shotNo, ...call }
    )
  }
  const pushOut = state.pool.pushOutAvailable && random() < 0.5
  push(
    seat,
    pushOut
      ? { type: "shoot", shotNo, shot, pushOut: true }
      : { type: "shoot", shotNo, shot }
  )
}

function generate(E, matches, shotsPerMatch) {
  const random = lcg(20261005)
  const vectors = []
  if (POOL.includes(RULE)) {
    poolMatches(E, random, vectors, matches)
    return vectors
  }
  randomMatches(E, random, vectors, matches, shotsPerMatch)
  shortRaces(E, random, vectors, 30)
  contactCases(E, random, vectors)
  return vectors
}

// Runs inside Node and inside jsc: must stay plain ES2020 with no imports.
function replay(E, vectors) {
  let exact = 0
  let scoreDiffers = 0
  let maxDelta = 0
  const worst = []
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]
    const got = E.applyAction(v.state, v.seat, v.action)
    if (JSON.stringify(got) === JSON.stringify(v.expected)) {
      exact++
      continue
    }
    let delta = Infinity
    if (got.ok && v.expected.ok) {
      delta = 0
      for (let b = 0; b < got.state.balls.length; b++) {
        const g = got.state.balls[b]
        const e = v.expected.state.balls[b]
        delta = Math.max(delta, Math.hypot(g.x - e.x, g.y - e.y))
      }
      if (
        got.state.scores[0] !== v.expected.state.scores[0] ||
        got.state.scores[1] !== v.expected.state.scores[1]
      ) {
        scoreDiffers++
      }
    }
    maxDelta = Math.max(maxDelta, delta)
    worst.push({ i: i, delta: delta })
  }
  worst.sort((a, b) => b.delta - a.delta)
  return {
    total: vectors.length,
    exact: exact,
    differing: vectors.length - exact,
    scoreDiffers: scoreDiffers,
    maxDelta: maxDelta,
    worst: worst.slice(0, 5),
  }
}

function report(label, r) {
  console.log(
    `${label}: ${r.exact}/${r.total} identical` +
      (r.differing
        ? `, ${r.differing} differ (score differs in ${r.scoreDiffers}, max ball delta ${r.maxDelta})`
        : "")
  )
  return r.differing === 0
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const mode = process.argv[2]
const E = await import("../engine-dist/index.mjs")

if (mode === "gen") {
  mkdirSync("vectors", { recursive: true })
  let vectors = []
  for (const [rule, file] of Object.entries(RULE_FILES)) {
    RULE = rule
    const sizes = { threecushion: 20, sagu: 12, nineball: 6, eightball: 6 }
    const made = generate(E, sizes[rule], 15)
    writeFileSync(
      file,
      JSON.stringify({ engineVersion: E.ENGINE_VERSION, vectors: made }) + "\n"
    )
    console.log(`${made.length} ${rule} vectors -> ${file}`)
    if (rule === "threecushion") vectors = made
  }
  RULE = "threecushion"
  // A few shots for the web view to replay when it loads, proving that the
  // JS engine of that device computes what the server computes.
  const shots = vectors
    .filter((v) => v.expected.ok && v.expected.events[0].type === "shot")
    .filter((_, i) => i % 40 === 0)
    .slice(0, 10)
    .map((v) => ({
      state: v.state,
      seat: v.seat,
      action: v.action,
      stateHash: v.expected.events[0].stateHash,
    }))
  writeFileSync(SELFCHECK_FILE, JSON.stringify(shots) + "\n")
  console.log(`${shots.length} self-check shots -> ${SELFCHECK_FILE}`)
} else if (mode === "check") {
  let ok = true
  for (const file of [...Object.values(RULE_FILES), HEAVY_FILE]) {
    const { vectors } = JSON.parse(readFileSync(file, "utf8"))
    ok = report(`node ${file}`, replay(E, vectors)) && ok
  }
  process.exit(ok ? 0 : 1)
} else if (mode === "heavy") {
  // The 20 shots that cost the most CPU out of a large random sample, so a
  // server can tell a slow first call from a genuinely expensive shot.
  const sample = []
  randomMatches(E, lcg(31337), sample, 400, 50)
  const time = (v) => {
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      E.applyAction(v.state, v.seat, v.action)
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }
  for (const v of sample.slice(0, 200)) time(v)
  const timed = sample
    .filter((v) => v.expected.ok)
    .map((v) => ({ v, cpuMs: time(v) }))
    .sort((a, b) => b.cpuMs - a.cpuMs)
    .slice(0, 20)
    .map(({ v, cpuMs }) => ({
      ...v,
      cpuMs: Math.round(cpuMs * 100) / 100,
      durationMs: v.expected.events[0].durationMs,
      contacts: v.expected.events[0].outcome.events.length,
    }))
  writeFileSync(
    HEAVY_FILE,
    JSON.stringify({
      engineVersion: E.ENGINE_VERSION,
      sampled: sample.length,
      vectors: timed,
    }) + "\n"
  )
  console.log(`${timed.length} of ${sample.length} shots -> ${HEAVY_FILE}`)
  for (const t of timed) {
    console.log(
      `  ${t.cpuMs.toFixed(2)} ms  ${(t.durationMs / 1000).toFixed(1)} s  ${t.contacts} contacts`
    )
  }
} else if (mode === "jsc") {
  const script = join(tmpdir(), `engine-vectors-${process.pid}.js`)
  writeFileSync(
    script,
    readFileSync("engine-dist/index.iife.js", "utf8") +
      Object.values(RULE_FILES)
        .map((f, i) => `\nvar data${i} = ${readFileSync(f, "utf8")};\n`)
        .join("") +
      replay.toString() +
      `\nprint(JSON.stringify([${Object.values(RULE_FILES)
        .map((_, i) => `replay(BilliardsEngine, data${i}.vectors)`)
        .join(", ")}]));\n`
  )
  const out = execFileSync(JSC, [script], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  })
  const results = JSON.parse(out.trim().split("\n").pop())
  let ok = true
  Object.keys(RULE_FILES).forEach((rule, i) => {
    if (!report(`jsc ${rule}`, results[i])) {
      console.log("worst:", JSON.stringify(results[i].worst))
      ok = false
    }
  })
  if (!ok) process.exit(1)
} else if (mode === "bench") {
  const vectors = []
  randomMatches(E, lcg(7), vectors, 40, 30)
  for (const v of vectors.slice(0, 50)) E.applyAction(v.state, v.seat, v.action)
  const cpu = []
  const sim = []
  for (const v of vectors) {
    const t0 = performance.now()
    const r = E.applyAction(v.state, v.seat, v.action)
    cpu.push(performance.now() - t0)
    if (r.ok && r.events[0].type === "shot") sim.push(r.events[0].durationMs)
  }
  cpu.sort((a, b) => a - b)
  sim.sort((a, b) => a - b)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  console.log(`shots: ${cpu.length}`)
  console.log(
    `cpu ms   mean ${mean(cpu).toFixed(2)}  p50 ${percentile(cpu, 0.5).toFixed(2)}  p95 ${percentile(cpu, 0.95).toFixed(2)}  p99 ${percentile(cpu, 0.99).toFixed(2)}  max ${cpu[cpu.length - 1].toFixed(2)}`
  )
  console.log(
    `shot s   mean ${(mean(sim) / 1000).toFixed(1)}  p50 ${(percentile(sim, 0.5) / 1000).toFixed(1)}  p95 ${(percentile(sim, 0.95) / 1000).toFixed(1)}  max ${(sim[sim.length - 1] / 1000).toFixed(1)}`
  )
} else if (mode === "stats") {
  const file = RULE_FILES[process.argv[3]] ?? FILE
  const { vectors } = JSON.parse(readFileSync(file, "utf8"))
  const counts = {}
  const add = (k) => (counts[k] = (counts[k] || 0) + 1)
  for (const v of vectors) {
    if (!v.expected.ok) {
      add(`rejected ${v.expected.code}`)
      continue
    }
    for (const e of v.expected.events) {
      if (e.type === "shot") {
        add(`shot ${e.stage}`)
        if (e.outcome.points) add(`point ${e.stage}`)
        if (e.outcome.foul) add(`foul ${e.outcome.foul}`)
        if (e.outcome.rack !== undefined)
          add(`rack ${e.outcome.rack ? "won" : "lost"}`)
      } else if (e.type === "matchEnd") {
        add(`end ${e.reason}`)
      } else if (e.type === "position") {
        add(`position ${e.reason}`)
      } else if (e.type !== "turn") {
        add(e.type)
      }
    }
  }
  for (const k of Object.keys(counts).sort()) console.log(`${counts[k]}\t${k}`)
} else {
  console.error("usage: engine-vectors.mjs gen|check|jsc|bench|stats")
  process.exit(2)
}
