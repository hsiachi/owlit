// node scripts/icons.mjs (macOS): the extension's icons in public/icons.
//
// The toolbar button's icon is the feather alone, with no tile: feather-<size>.png in ink for light
// toolbars and feather-light-<size>.png for dark ones, at 16, 32 and 48 px. They are drawn here from the
// feather's path (local/brand/owlit-icon.svg, the same path as apps/desktop/scripts/icon.mjs) with sharp,
// which isn't a dependency: SHARP_PATH points at any installed copy, else the one in the workspace's
// node_modules/.pnpm is used. As the app icon does, the line is heavier at the small sizes, so it keeps
// about a pixel and a half.
//
// The store's and the extensions page's icons (16, 32, 48, 128.png) are the app icon itself, taken from its
// own renderings in apps/desktop/resources/icon.icns. Run this again after either changes.
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "public/icons")

function loadSharp() {
  const require = createRequire(import.meta.url)
  if (process.env.SHARP_PATH) return require(process.env.SHARP_PATH)
  const store = path.join(root, "../../node_modules/.pnpm")
  const found = readdirSync(store).find((name) => /^sharp@/.test(name))
  if (!found) throw new Error("No sharp to draw with: set SHARP_PATH to an installed copy")
  return require(path.join(store, found, "node_modules/sharp"))
}
const sharp = loadSharp()

const FEATHER = "M 53 225 C 55 167 85 93 136 58 C 164 39 199 32 211 45 C 228 64 191 96 155 111 C 128 122 107 137 91 154 C 108 140 126 128 146 124 C 171 117 176 128 159 145 C 146 158 124 164 111 169 C 134 163 143 177 125 190 C 114 198 101 201 91 201"
// The feather's own box with room for the widest line, square
const VIEW = "28 22 216 216"
// The app's foreground ink (DESIGN.md), and its dark mode's foreground for a dark toolbar
const INK = "#25211e"
const LIGHT = "#ecebe7"
// Line weight in the feather's units by the pixel size
const strokeFor = (px) => (px <= 16 ? 20 : px <= 32 ? 16 : 14)

const svg = (px, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}" width="${px}" height="${px}"><path d="${FEATHER}" fill="none" stroke="${color}" stroke-width="${strokeFor(px)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`

for (const px of [16, 32, 48]) {
  // Drawn at eight times the size and scaled down, for smooth edges
  const draw = (color, file) => sharp(Buffer.from(svg(px, color)), { density: 72 * 8 }).resize(px, px).png().toFile(path.join(out, file))
  await draw(INK, `feather-${px}.png`)
  await draw(LIGHT, `feather-light-${px}.png`)
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "owlit-extension-icons-"))
const set = path.join(scratch, "icon.iconset")
execFileSync("iconutil", ["-c", "iconset", path.join(root, "../desktop/resources/icon.icns"), "-o", set])
copyFileSync(path.join(set, "icon_16x16.png"), path.join(out, "16.png"))
copyFileSync(path.join(set, "icon_16x16@2x.png"), path.join(out, "32.png"))
copyFileSync(path.join(set, "icon_128x128.png"), path.join(out, "128.png"))
// 48px has no rendering of its own: the 32pt one at twice the size (64px), scaled down
execFileSync("sips", ["-z", "48", "48", path.join(set, "icon_32x32@2x.png"), "--out", path.join(out, "48.png")], { stdio: "ignore" })
rmSync(scratch, { recursive: true, force: true })
