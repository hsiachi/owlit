// node scripts/icons.mjs: the extension's icons in public/icons, one drawing at every size: the feather in
// white on a flat rounded square in owlit's green, <size>.png at 16, 32, 48, 64, 96 and 128 px. The toolbar
// button takes 16, 32 and 48; the extensions page and the store take all six (64 and 96 are the 32 and 48
// slots on a 2x display, which the extensions page asks for: without them the browser scales 128 and shows
// it soft).
//
// One tile everywhere, not the app icon in the store and on the extensions page beside a tile on the
// button: the same extension then looks the same wherever the browser shows it, and the app icon wears
// badly there. At a toolbar's size its gradient, highlight and bars only blur, and on a dark extensions
// page its finish and deep forest green sat dim beside other extensions' saturated icons. The feather's
// box is centred and three quarters of the tile's side, the corners a quarter of it. As in the app icon,
// the line is heavier at the small sizes, about a pixel and a half at 16 px, and thins as the tile grows.
// sharp comes from apps/desktop/scripts/icon-draw.mjs, which says where.
import path from "node:path"
import { FEATHER, sharp } from "../../desktop/scripts/icon-draw.mjs"

const out = path.resolve(import.meta.dirname, "../public/icons")

// The feather's own box with room for the widest line, square
const VIEW = "28 22 216 216"
// oklch(0.56 0.14 155), as sRGB (sharp's SVG renderer takes no oklch): one step livelier than the app
// icon's forest green, which beside other extensions' saturated icons reads as the dark one
const GREEN = "#008b4e"
const WHITE = "#ffffff"
// Line weight in the feather's units by the pixel size; a unit is px / 288 pixels, the box being three
// quarters of the tile. Heavier when small so the line holds, thinner as it grows so the feather stays
// a line and not a blot: 1.3 px at 16, 2 at 32, 3 at 48, 6.4 at 128.
const strokeFor = (px) => (px <= 16 ? 24 : px <= 32 ? 18 : px <= 48 ? 17 : px <= 64 ? 16 : px <= 96 ? 15 : 14.5)

const tile = (px) => {
  const box = px * 0.75, at = (px - box) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><rect width="${px}" height="${px}" rx="${px / 4}" fill="${GREEN}"/><svg x="${at}" y="${at}" width="${box}" height="${box}" viewBox="${VIEW}"><path d="${FEATHER}" fill="none" stroke="${WHITE}" stroke-width="${strokeFor(px)}" stroke-linecap="round" stroke-linejoin="round"/></svg></svg>`
}

// Drawn at eight times the size and scaled down, for smooth edges
for (const px of [16, 32, 48, 64, 96, 128]) await sharp(Buffer.from(tile(px)), { density: 72 * 8 }).resize(px, px).png().toFile(path.join(out, `${px}.png`))
