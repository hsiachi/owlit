// node scripts/icon.mjs: Owlit's app icon, written into resources/. icon.svg is the vector source; icon.png is
// the 1024px icon the dev Dock shows; icon.icns is what the packaged app carries, rendered per size with
// iconutil. There is one icon for both appearances: a deep green tile holds up in a light Dock and a dark one.
// icon-dev.png and icon-dev.icns are the same drawing on a graphite tile, for Owlit Dev (pnpm dev, pnpm try).
// The drawing itself is icon-draw.mjs, shared with the extension's icons.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { DEV, OWLIT, render, svg } from "./icon-draw.mjs"
const out = path.join(import.meta.dirname, "../resources")
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "owlit-icon-"))
fs.writeFileSync(path.join(out, "icon.svg"), svg(OWLIT))
for (const [name, T] of [["icon", OWLIT], ["icon-dev", DEV]]) {
  fs.writeFileSync(path.join(out, `${name}.png`), await render(T, 1024, 1024))
  const set = path.join(scratch, `${name}.iconset`)
  fs.mkdirSync(set)
  for (const [pt, px] of [[16, 16], [16, 32], [32, 32], [32, 64], [128, 128], [128, 256], [256, 256], [256, 512], [512, 512], [512, 1024]])
    fs.writeFileSync(path.join(set, `icon_${pt}x${pt}${px === pt ? "" : "@2x"}.png`), await render(T, pt, px))
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(out, `${name}.icns`)])
}
fs.rmSync(scratch, { recursive: true, force: true })
