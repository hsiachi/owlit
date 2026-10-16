// Owlit's own updates through electron-updater: GitHub Releases' latest-mac.yml, the zip downloaded in
// the background, put in place by Squirrel when Owlit quits. core/updates decides when to check and
// what the window is told; this only does what it asks.
//
// Squirrel takes an update only when it is signed by the same team as the running app, so a copy that
// isn't signed with the Developer ID (ad hoc, the old self-signed certificate) is told it can't, rather
// than downloading 160 MB it can't install. Nor can a copy run from the dmg or one macOS moved aside
// (App Translocation), which can't replace itself.
//
// OWLIT_UPDATE_FEED=<url> (trying it out): a folder served over HTTP with latest-mac.yml and the zip, in
// place of GitHub, for any build, signed or not; Squirrel still refuses to install an unsigned one.

import type { UpdaterHost } from "@owlit/core"
import { app } from "electron"
import { autoUpdater } from "electron-updater"
import { execFile } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"

export const updateFeed = process.env.OWLIT_UPDATE_FEED

// The Owlit.app this process runs from
export const appBundle = () => path.resolve(app.getPath("exe"), "../../..")

// Where the app can't replace itself: a mounted dmg, or a copy macOS runs from a hidden place because it
// was opened where it was downloaded
export function cantReplaceItself(bundle = appBundle()) {
  return bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")
}

export function createUpdater(): UpdaterHost {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  // Its info lines go nowhere; what goes wrong reaches core, which logs it
  autoUpdater.logger = { info: () => undefined, warn: (message: unknown) => console.warn("[updater]", message), error: () => undefined, debug: () => undefined }
  if (updateFeed) {
    // The download reads its cache folder's name from this file, as a release reads it from the
    // app-update.yml electron-builder writes into the app
    const config = path.join(app.getPath("userData"), "trial-app-update.yml")
    writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(updateFeed)}\nupdaterCacheDirName: owlit-updater-trial\n`)
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = config
  }
  return {
    blocked: async () => {
      if (cantReplaceItself()) return "location"
      if (!updateFeed && !(await teamSigned(appBundle()))) return "unsigned"
      return undefined
    },
    check: async () => {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) return undefined
      // The download's failure also comes as an error event, which core hears
      result.downloadPromise?.catch(() => undefined)
      return result.updateInfo.version
    },
    onProgress: (listener) => void autoUpdater.on("download-progress", (info) => listener(info.percent)),
    onDownloaded: (listener) => void autoUpdater.on("update-downloaded", (info) => listener(info.version)),
    onError: (listener) => void autoUpdater.on("error", listener),
    install: () => autoUpdater.quitAndInstall(),
  }
}

// Signed with a Developer ID: codesign names its team ("TeamIdentifier=not set" for ad hoc and
// self-signed certificates)
function teamSigned(bundle: string) {
  return new Promise<boolean>((resolve) =>
    execFile("codesign", ["-dv", "--verbose=2", bundle], (error, _out, err) => {
      const team = /^TeamIdentifier=(.+)$/m.exec(err)?.[1]
      resolve(!error && !!team && team !== "not set")
    }),
  )
}
