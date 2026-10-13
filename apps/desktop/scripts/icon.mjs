// node scripts/icon.mjs: Owlit's app icon, written into resources/. icon.svg and icon-dark.svg are the vector
// sources (the dark one waits for an Icon Composer file, which needs Xcode); icon.png is the 1024px light icon
// the dev Dock shows; icon.icns is what the packaged app carries, rendered per size with iconutil.
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
const T = {
  light: { top: "#fbfaf6", bottom: "#ecebe4", feather: "#1e7546", shadow: 0.16, edgeOp: 0.75, line: "#25211e", lineOp: 0.085, grain: 0.16 },
  dark: { top: "#2e3330", bottom: "#1d211f", feather: "#8fd5aa", shadow: 0.45, edgeOp: 0.1, line: "#ffffff", lineOp: 0.06, grain: 0.1 },
}
// Line weight in feather units by the point size it is drawn for: 14.5 at full size, heavier when small so
// the line keeps about a pixel.
const strokeFor = (pt) => (pt <= 16 ? 26 : pt <= 32 ? 22 : pt <= 64 ? 18 : pt <= 128 ? 16 : 14.5)
const TILE = `x="100" y="100" width="824" height="824" rx="185"`
// part: "all" (the vector source), "shadow" (the tile's drop shadow only), "mask" (the tile shape), "over"
// (edges and feather on a transparent tile).
function svg(theme, pt = 1024, part = "all") {
  const t = T[theme], sw = strokeFor(pt), grain = pt >= 256
  const p = (stroke, w) => `<path d="${FEATHER}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`
  if (part === "mask") return `${head}<rect ${TILE} fill="#fff"/></svg>`
  const defs = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.top}"/><stop offset="1" stop-color="${t.bottom}"/></linearGradient>
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="${t.shadow}"/></filter>${grain ? `
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.5"/></filter>
    <mask id="line" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="300">${p("#fff", sw)}</mask>` : ""}
    <clipPath id="outside"><path d="M0 0H1024V1024H0Z M100 285 A185 185 0 0 1 285 100 H739 A185 185 0 0 1 924 285 V739 A185 185 0 0 1 739 924 H285 A185 185 0 0 1 100 739 Z" clip-rule="evenodd"/></clipPath>
  </defs>`
  const shadow = `<rect ${TILE} fill="${t.bottom}" filter="url(#shadow)"${part === "shadow" ? ` clip-path="url(#outside)"` : ""}/>`
  const over = `
  <rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="#ffffff" stroke-opacity="${t.edgeOp}" stroke-width="3"/>
  <rect ${TILE} fill="none" stroke="${t.line}" stroke-opacity="${t.lineOp}" stroke-width="2"/>
  <g transform="translate(136.38 143.24) scale(2.8)">${p(t.feather, sw)}${grain ? `<g mask="url(#line)"><rect width="300" height="300" filter="url(#grain)" opacity="${t.grain}"/></g>` : ""}</g>`
  if (part === "shadow") return `${head}${defs}\n  ${shadow}\n</svg>\n`
  if (part === "over") return `${head}${defs}${over}\n</svg>\n`
  return `${head}\n  <title>Owlit</title>${defs}\n  <rect ${TILE} fill="url(#tile)" filter="url(#shadow)"/>${over}\n</svg>\n`
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
// The tile's gradient is drawn here in full precision with dithering: in 8 bits its channels step on
// different rows and the bands flicker in hue, most visibly on the dark tile at large sizes.
async function render(theme, pt, px) {
  const t = T[theme], top = hex(t.top), bot = hex(t.bottom)
  const raster = (s) => sharp(Buffer.from(s), { density: (72 * px) / 1024 * 2 }).resize(px, px).ensureAlpha().raw().toBuffer()
  const mask = await raster(svg(theme, pt, "mask"))
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
  const [shadow, over] = await Promise.all([raster(svg(theme, pt, "shadow")), raster(svg(theme, pt, "over"))])
  return sharp(shadow, raw).composite([{ input: tile, ...raw }, { input: over, ...raw }]).png().toBuffer()
}
fs.writeFileSync(path.join(out, "icon.svg"), svg("light"))
fs.writeFileSync(path.join(out, "icon-dark.svg"), svg("dark"))
fs.writeFileSync(path.join(out, "icon.png"), await render("light", 1024, 1024))
const set = path.join(scratch, "Owlit.iconset")
fs.mkdirSync(set)
// A @2x file is the retina rendering of the smaller point size, so it takes that size's line weight.
for (const [pt, px] of [[16, 16], [16, 32], [32, 32], [32, 64], [128, 128], [128, 256], [256, 256], [256, 512], [512, 512], [512, 1024]])
  fs.writeFileSync(path.join(set, `icon_${pt}x${pt}${px === pt ? "" : "@2x"}.png`), await render("light", pt, px))
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(out, "icon.icns")])
fs.rmSync(scratch, { recursive: true, force: true })
