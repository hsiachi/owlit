// The owlit command (packages/cli) for Terminal. A script in the app data folder runs the bundled
// owlit.cjs with this app's own binary as plain Node; it is written at every launch, so it follows the app
// when it moves. Install Command Line Tool… links /usr/local/bin/owlit to it once.

import { t } from "@lingui/core/macro"
import { app, BrowserWindow, dialog } from "electron"
import { execFile } from "node:child_process"
import { lstat, mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const LINK = "/usr/local/bin/owlit"

const scriptPath = () => path.join(app.getPath("userData"), "bin", "owlit")

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// entry: the bundled owlit.cjs. OWLIT_APP tells the command which app `owlit open` should start.
export async function writeCliScript(entry: string) {
  const bundle = app.isPackaged ? path.resolve(app.getPath("exe"), "../../..") : ""
  const script = [
    "#!/bin/sh",
    "# owlit's command line tool, written by the app at each launch. See owlit --help.",
    `ELECTRON_RUN_AS_NODE=1 OWLIT_APP=${shellQuote(bundle)} exec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"`,
    "",
  ].join("\n")
  await mkdir(path.dirname(scriptPath()), { recursive: true })
  await writeFile(scriptPath(), script, { mode: 0o755 })
}

export async function installCliTool() {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const show = (options: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  const target = scriptPath()
  const linked = await readlink(LINK).catch(() => null)
  const installed = {
    message: t`The owlit command is installed`,
    detail: t`Run “owlit --help” in Terminal to see what it can do.`,
    buttons: [t`OK`],
  }
  if (linked === target) return void (await show(installed))

  // Something else is called owlit there already (another copy of the app, or not owlit at all)
  if (linked !== null || (await lstat(LINK).then(() => true, () => false))) {
    const { response } = await show({
      type: "question",
      message: t`Replace the owlit command?`,
      detail: t`${LINK} already exists. Replacing it makes it run this copy of Owlit.`,
      buttons: [t`Replace`, t`Cancel`],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return
  }

  try {
    await mkdir(path.dirname(LINK), { recursive: true })
    await unlink(LINK).catch(() => undefined)
    await symlink(target, LINK)
  } catch {
    // /usr/local/bin belongs to the administrator on most Macs: macOS asks for the password
    const failure = await asAdministrator(`mkdir -p /usr/local/bin && ln -sfn ${shellQuote(target)} ${LINK}`)
    if (failure === "cancelled") return
    if (failure) return void (await show({ type: "warning", message: t`The owlit command couldn't be installed`, detail: failure, buttons: [t`OK`] }))
  }
  await show(installed)
}

// Runs a shell command with the administrator's rights, after macOS asks for the password. Returns null
// when it ran, "cancelled" when the user said no, or what went wrong.
function asAdministrator(command: string): Promise<string | null> {
  const literal = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return new Promise((resolve) =>
    execFile("osascript", ["-e", `do shell script "${literal}" with administrator privileges`], (error, _out, stderr) => {
      if (!error) resolve(null)
      else resolve(/-128/.test(stderr) ? "cancelled" : stderr.trim() || error.message)
    }),
  )
}
