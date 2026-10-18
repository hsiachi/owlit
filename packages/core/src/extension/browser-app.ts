import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

// The browser an extension's request came from, as macOS knows the app: its bundle id and its name
export interface BrowserApp {
  id: string
  name: string
}

// The app holding the other end of a connection to this process, from the port it came from. An
// extension can only guess its browser's name (Dia and Arc call themselves Chromium), while the system
// knows which program made the request: lsof names the process, and its executable sits inside the
// browser's .app (a Chromium browser's requests come from a helper app nested in its own). macOS only;
// undefined wherever it can't tell.
export async function browserAppOf(remotePort: number): Promise<BrowserApp | undefined> {
  if (process.platform !== "darwin") return undefined
  // Exits 1 when nothing matches; -w leaves out warnings about file systems it can't read
  const listed = await run("lsof", ["-nP", "-w", `-iTCP@127.0.0.1:${remotePort}`, "-sTCP:ESTABLISHED", "-Fp"]).catch(() => undefined)
  const pid = listed && peerPid(listed.stdout, process.pid)
  if (!pid) return undefined
  const executable = (await run("ps", ["-o", "comm=", "-p", String(pid)]).catch(() => undefined))?.stdout.trim()
  const app = executable && outerApp(executable)
  if (!app) return undefined
  const info = path.join(app, "Contents", "Info.plist")
  const read = async (key: string) => (await run("plutil", ["-extract", key, "raw", "-o", "-", info]).catch(() => undefined))?.stdout.trim() || undefined
  const id = await read("CFBundleIdentifier")
  if (!id) return undefined
  return { id, name: (await read("CFBundleDisplayName")) ?? (await read("CFBundleName")) ?? path.basename(app, ".app") }
}

// The process on the other end, from lsof -Fp: both ends of a connection within this machine match the
// port, and this process holds one of them
export function peerPid(lsofOutput: string, self: number): number | undefined {
  for (const line of lsofOutput.split("\n")) {
    if (!line.startsWith("p")) continue
    const pid = Number(line.slice(1))
    if (Number.isInteger(pid) && pid > 0 && pid !== self) return pid
  }
  return undefined
}

// The outermost .app an executable is in: /Applications/Dia.app for Dia's nested Browser Helper
export function outerApp(executable: string): string | undefined {
  const at = executable.indexOf(".app/")
  return at < 0 ? undefined : executable.slice(0, at + ".app".length)
}
