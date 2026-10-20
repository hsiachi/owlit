// node scripts/icons.mjs: the extension's icons in public/icons, drawn with apps/desktop/scripts/icon-draw.mjs
// (which says where sharp comes from). Run it again after the app icon changes.
//
// The toolbar button's icon is one tile for every toolbar, light or dark: the feather in white on a flat
// rounded square in owlit's green, feather-<size>.png at 16, 32 and 48 px. A flat tile, not the app icon's:
// at a toolbar's size its gradient, highlight and bars only blur, and a flat square sits beside the other
// buttons' shapes. The feather's box is centred and three quarters of the tile's side, the corners a
// quarter of it. As in the app icon, the line is heavier at the small sizes, so it keeps about a pixel
// and a half at 16 px.
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
// oklch(0.56 0.14 155), as sRGB: one step livelier than the app icon's forest green, which beside other
// extensions' saturated icons reads as the dark one
const GREEN = "#008b4e"
const WHITE = "#ffffff"
// Line weight in the feather's units by the pixel size
const strokeFor = (px) => (px <= 16 ? 24 : 18)

const tile = (px) => {
  const box = px * 0.75, at = (px - box) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><rect width="${px}" height="${px}" rx="${px / 4}" fill="${GREEN}"/><svg x="${at}" y="${at}" width="${box}" height="${box}" viewBox="${VIEW}"><path d="${FEATHER}" fill="none" stroke="${WHITE}" stroke-width="${strokeFor(px)}" stroke-linecap="round" stroke-linejoin="round"/></svg></svg>`
}

// Drawn at eight times the size and scaled down, for smooth edges
for (const px of [16, 32, 48]) await sharp(Buffer.from(tile(px)), { density: 72 * 8 }).resize(px, px).png().toFile(path.join(out, `feather-${px}.png`))

for (const [pt, px] of [[16, 16], [16, 32], [48, 48], [32, 64], [48, 96], [128, 128]])
  writeFileSync(path.join(out, `${px}.png`), await render(OWLIT, pt, px))
