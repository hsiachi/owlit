// node scripts/icons.mjs (macOS): the extension's icons in public/icons, taken from the app icon's own
// renderings in apps/desktop/resources/icon.icns, which draw the feather heavier at small sizes (see
// apps/desktop/scripts/icon.mjs). Run it again after the app icon changes.
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "public/icons")
const scratch = mkdtempSync(path.join(os.tmpdir(), "owlit-extension-icons-"))
const set = path.join(scratch, "icon.iconset")
execFileSync("iconutil", ["-c", "iconset", path.join(root, "../desktop/resources/icon.icns"), "-o", set])
copyFileSync(path.join(set, "icon_16x16.png"), path.join(out, "16.png"))
copyFileSync(path.join(set, "icon_16x16@2x.png"), path.join(out, "32.png"))
copyFileSync(path.join(set, "icon_128x128.png"), path.join(out, "128.png"))
// 48px has no rendering of its own: the 32pt one at twice the size (64px), scaled down
execFileSync("sips", ["-z", "48", "48", path.join(set, "icon_32x32@2x.png"), "--out", path.join(out, "48.png")], { stdio: "ignore" })
rmSync(scratch, { recursive: true, force: true })
