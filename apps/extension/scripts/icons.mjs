// node scripts/icons.mjs: the extension's icons in public/icons, drawn with apps/desktop/scripts/icon-draw.mjs
// (which says where sharp comes from). Run it again after the app icon changes.
//
// The toolbar button's icon is the feather alone, with no tile: feather-<size>.png in ink for light
// toolbars and feather-light-<size>.png for dark ones, at 16, 32 and 48 px. As the app icon does, the line
// is heavier at the small sizes, so it keeps about a pixel and a half.
//
// The store's and the extensions page's icons are the app icon itself, each drawn for the point size of
// its slot, as the app's own icon files are: 32 is the 16 slot at 2x, 64 the 32 slot and 96 the 48 slot,
// which the extensions page asks for on a 2x display. Those keep the small sizes' heavier line and no
// bars; without them the browser would scale 128, the large style, and show it soft.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { FEATHER, OWLIT, render, sharp } from "../../desktop/scripts/icon-draw.mjs"

const out = path.resolve(import.meta.dirname, "../public/icons")

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

for (const [pt, px] of [[16, 16], [16, 32], [48, 48], [32, 64], [48, 96], [128, 128]])
  writeFileSync(path.join(out, `${px}.png`), await render(OWLIT, pt, px))
