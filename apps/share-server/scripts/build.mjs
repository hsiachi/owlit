import { build } from "esbuild"
import path from "node:path"

// One file to copy to the server: dist/server.mjs runs with plain Node (22.13 or later, for node:sqlite)
const root = path.resolve(import.meta.dirname, "..")
await build({
  entryPoints: [path.join(root, "src/main.ts")],
  outfile: path.join(root, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
})
