// node scripts/icon.mjs: Owlit's app icon, written into resources/. icon.svg is the vector source; icon.png is
// the 1024px icon the dev Dock shows; icon.icns is what the packaged app carries, rendered per size with
// iconutil. There is one icon for both appearances: a deep green tile holds up in a light Dock and a dark one.
// Icons change rarely, so sharp is not a dependency: point SHARP_PATH at any installed copy.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const sharp = require(process.env.SHARP_PATH ?? "sharp")
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "../resources")
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "owlit-icon-"))
const FEATHER = "M 53 225 C 55 167 85 93 136 58 C 164 39 199 32 211 45 C 228 64 191 96 155 111 C 128 122 107 137 91 154 C 108 140 126 128 146 124 C 171 117 176 128 159 145 C 146 158 124 164 111 169 C 134 163 143 177 125 190 C 114 198 101 201 91 201"
// Forest tile, warm-white feather, two green bars under the lower curls (a highlighted passage).
const T = { top: "#1d4a35", bottom: "#123325", feather: "#f6f5f0", bars: "#589a70", shadow: 0.4, edgeOp: 0.1, lineOp: 0.06 }
const BARS = [[106, 127, 96, 30], [106, 171, 74, 28]]
// Line weight in feather units by the point size it is drawn for: 14.5 at full size, heavier when small so
// the line keeps about a pixel.
const strokeFor = (pt) => (pt <= 16 ? 26 : pt <= 32 ? 22 : pt <= 64 ? 18 : pt <= 128 ? 16 : 14.5)
// Below 64pt the bars blur into a smudge behind the feather, so the small sizes are the feather alone.
const barsAt = (pt) => pt >= 64
// Above 128pt the feather sits a little above the tile, with a soft shadow under it; smaller, the shadow is mud.
const reliefAt = (pt) => pt >= 128
const TILE = `x="100" y="100" width="824" height="824" rx="185"`
// part: "all" (the vector source), "shadow" (the tile's drop shadow only), "mask" (the tile shape), "over"
// (edges, bars and feather on a transparent tile).
function svg(pt = 1024, part = "all") {
  const sw = strokeFor(pt), relief = reliefAt(pt)
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`
  if (part === "mask") return `${head}<rect ${TILE} fill="#fff"/></svg>`
  const defs = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.top}"/><stop offset="1" stop-color="${T.bottom}"/></linearGradient>
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="${T.shadow}"/></filter>${relief ? `
    <filter id="relief" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.4" flood-color="#000" flood-opacity="0.35"/></filter>` : ""}
    <clipPath id="outside"><path d="M0 0H1024V1024H0Z M100 285 A185 185 0 0 1 285 100 H739 A185 185 0 0 1 924 285 V739 A185 185 0 0 1 739 924 H285 A185 185 0 0 1 100 739 Z" clip-rule="evenodd"/></clipPath>
  </defs>`
  const shadow = `<rect ${TILE} fill="${T.bottom}" filter="url(#shadow)"${part === "shadow" ? ` clip-path="url(#outside)"` : ""}/>`
  const bars = barsAt(pt) ? BARS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${T.bars}"/>`).join("") : ""
  const over = `
  <rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="#ffffff" stroke-opacity="${T.edgeOp}" stroke-width="3"/>
  <rect ${TILE} fill="none" stroke="#ffffff" stroke-opacity="${T.lineOp}" stroke-width="2"/>
  <g transform="translate(136.38 143.24) scale(2.8)">${bars}<path d="${FEATHER}" fill="none" stroke="${T.feather}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${relief ? ` filter="url(#relief)"` : ""}/></g>`
  if (part === "shadow") return `${head}${defs}\n  ${shadow}\n</svg>\n`
  if (part === "over") return `${head}${defs}${over}\n</svg>\n`
  return `${head}\n  <title>Owlit</title>${defs}\n  <rect ${TILE} fill="url(#tile)" filter="url(#shadow)"/>${over}\n</svg>\n`
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
// The tile's gradient is drawn here in full precision with dithering: in 8 bits its channels step on
// different rows and the bands flicker in hue, most visibly on a dark tile at large sizes.
async function render(pt, px) {
  const top = hex(T.top), bot = hex(T.bottom)
  const raster = (s) => sharp(Buffer.from(s), { density: (72 * px) / 1024 * 2 }).resize(px, px).ensureAlpha().raw().toBuffer()
  const mask = await raster(svg(pt, "mask"))
  const tile = Buffer.alloc(px * px * 4)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < px; y++) {
    const k = Math.min(1, Math.max(0, (((y + 0.5) * 1024) / px - 100) / 824))
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4, d = rnd() + rnd() - 1
      for (let c = 0; c < 3; c++) tile[i + c] = Math.round(top[c] + (bot[c] - top[c]) * k + d)
      tile[i + 3] = mask[i + 3]
    }
  }
  const raw = { raw: { width: px, height: px, channels: 4 } }
  const [shadow, over] = await Promise.all([raster(svg(pt, "shadow")), raster(svg(pt, "over"))])
  return sharp(shadow, raw).composite([{ input: tile, ...raw }, { input: over, ...raw }]).png().toBuffer()
}
fs.writeFileSync(path.join(out, "icon.svg"), svg())
fs.writeFileSync(path.join(out, "icon.png"), await render(1024, 1024))
const set = path.join(scratch, "Owlit.iconset")
fs.mkdirSync(set)
// A @2x file is the retina rendering of the smaller point size, so it takes that size's line weight.
for (const [pt, px] of [[16, 16], [16, 32], [32, 32], [32, 64], [128, 128], [128, 256], [256, 256], [256, 512], [512, 512], [512, 1024]])
  fs.writeFileSync(path.join(set, `icon_${pt}x${pt}${px === pt ? "" : "@2x"}.png`), await render(pt, px))
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(out, "icon.icns")])
fs.rmSync(scratch, { recursive: true, force: true })
