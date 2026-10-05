// Builds the headless match engine into engine-dist/ as a dependency-free
// package: ESM for Node, an IIFE for bare JS shells, and type declarations.
import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const out = "engine-dist"
rmSync(out, { recursive: true, force: true })
mkdirSync(out)

const common = {
  entryPoints: ["src/engine/index.ts"],
  bundle: true,
  target: "es2020",
  // no DOM on the server: lets the bundler drop meshes, cue and other view code
  define: { document: "undefined" },
  minifySyntax: true,
  treeShaking: true,
  legalComments: "none",
}
await build({
  ...common,
  format: "esm",
  platform: "node",
  outfile: `${out}/index.mjs`,
})
await build({
  ...common,
  format: "iife",
  globalName: "BilliardsEngine",
  platform: "neutral",
  outfile: `${out}/index.iife.js`,
})

const tmp = `${out}/.types`
execFileSync(
  "npx",
  [
    "tsc",
    "-p",
    "tsconfig.json",
    "--declaration",
    "--emitDeclarationOnly",
    "--rootDir",
    "src",
    "--outDir",
    tmp,
  ],
  { stdio: "inherit" }
)
// only the engine's own declarations are public; they import nothing else
cpSync(`${tmp}/engine`, `${out}/types`, { recursive: true })
rmSync(tmp, { recursive: true, force: true })

const version = /ENGINE_VERSION = "([^"]+)"/.exec(
  readFileSync("src/engine/match.ts", "utf8")
)[1]
writeFileSync(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: "billiards-engine",
      version,
      description: "Headless billiards match engine (physics + rules)",
      license: "GPL-3.0",
      type: "module",
      main: "./index.mjs",
      types: "./types/index.d.ts",
      exports: {
        ".": { types: "./types/index.d.ts", default: "./index.mjs" },
        "./iife": "./index.iife.js",
      },
      engines: { node: ">=22" },
      sideEffects: false,
    },
    null,
    2
  ) + "\n"
)
console.log(`billiards-engine ${version} -> ${out}/`)
