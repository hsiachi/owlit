// electron scripts/dmg-background.cjs: renders resources/dmg/background.svg into the dmg window's
// background, at 2x (background@2x.png) and 1x (background.png). Run again only when the SVG changes.
const { app, BrowserWindow } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const dir = path.join(__dirname, "../resources/dmg")
app.dock?.hide()
app.whenReady().then(async () => {
  try {
    // One offscreen page at twice the window's size, drawn at zoom 2
    const win = new BrowserWindow({ show: false, width: 1080, height: 760, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 2 } })
    // The SVG inline, so the page fetches nothing
    const svg = fs.readFileSync(path.join(dir, "background.svg")).toString("base64")
    await win.loadURL(`data:text/html,<style>html,body{margin:0;overflow:hidden}</style><img src="data:image/svg+xml;base64,${svg}" width="540" height="380">`)
    await new Promise((r) => setTimeout(r, 500))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dir, "background@2x.png"), image.resize({ width: 1080, height: 760, quality: "best" }).toPNG())
    fs.writeFileSync(path.join(dir, "background.png"), image.resize({ width: 540, height: 380, quality: "best" }).toPNG())
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
  app.quit()
})
