// Builds the web view bundle into panpa-dist/.
//   node scripts/build-panpa.mjs            bundle + dev host (dev.html)
//   node scripts/build-panpa.mjs --release  bundle only, as it is published
// manifest.json lists every published file with its size and sha256; the
// dev host is never listed.
import { build } from "esbuild"
import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

const release = process.argv.includes("--release")
const out = "panpa-dist"
rmSync(out, { recursive: true, force: true })
mkdirSync(out)

const common = {
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
}
await build({
  ...common,
  entryPoints: ["src/panpa/index.ts"],
  outfile: `${out}/app.js`,
})
cpSync("panpa/index.html", `${out}/index.html`)
cpSync("panpa/app.css", `${out}/app.css`)
cpSync("dist/sounds", `${out}/sounds`, { recursive: true })

function walk(dir, base = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name
    return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [rel]
  })
}

const constant = (file, name) =>
  new RegExp(`${name} = "?([^"\\n]+?)"?\\n`).exec(readFileSync(file, "utf8"))[1]
const files = walk(out)
  .sort()
  .map((path) => ({
    path,
    size: statSync(join(out, path)).size,
    sha256: createHash("sha256")
      .update(readFileSync(join(out, path)))
      .digest("hex"),
  }))
const manifest = {
  bundleVersion: constant("src/panpa/protocol.ts", "BUNDLE_VERSION"),
  engineVersion: constant("src/engine/match.ts", "ENGINE_VERSION"),
  bridgeVersion: Number(constant("src/panpa/protocol.ts", "BRIDGE_VERSION")),
  entry: "index.html",
  totalSize: files.reduce((sum, f) => sum + f.size, 0),
  files,
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n")

if (!release) {
  await build({
    ...common,
    minify: false,
    entryPoints: ["src/panpa/dev.ts"],
    outfile: `${out}/dev.js`,
  })
  cpSync("panpa/dev.html", `${out}/dev.html`)
  cpSync("panpa/dev.css", `${out}/dev.css`)
}

console.log(
  `panpa bundle ${manifest.bundleVersion} (engine ${manifest.engineVersion}) -> ${out}/`
)
for (const f of files) {
  console.log(`  ${String(f.size).padStart(8)}  ${f.path}`)
}
console.log(`  ${String(manifest.totalSize).padStart(8)}  total`)
