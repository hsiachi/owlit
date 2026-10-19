import { Core, socketPaths as corePaths } from "@owlit/core"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { eventually } from "../../core/src/test-util.ts"
import { connect, OwlitNotRunning, socketPaths } from "./index.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

// A core serving its workspace on a socket in a short temp folder of the test's own
async function running() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-sock-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const dir = realpathSync(mkdtempSync("/tmp/ows-"))
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir } })
  cores.push(core)
  await core.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
  return { core, root, dir }
}

describe("the workspace socket", () => {
  it("answers a client that has the token, and no one else", async () => {
    const { root, dir } = await running()
    const client = await connect(root, { dir })
    expect(await client.call("core.ping")).toEqual({ ok: true })
    expect(await client.rpc.workspace.current()).toMatchObject({ path: root })
    client.close()

    const raw = net.connect(socketPaths(root, dir).socket)
    raw.setEncoding("utf8")
    const answer = await new Promise<string>((resolve) => {
      raw.once("data", (d: string) => resolve(d))
      raw.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "core.ping" }) + "\n")
    })
    expect(JSON.parse(answer)).toMatchObject({ error: { message: "owlit didn't recognise this client." } })
    raw.destroy()
  })

  it("passes errors on in a sentence", async () => {
    const { root, dir } = await running()
    const client = await connect(root, { dir })
    await expect(client.call("library.get" as never)).rejects.toMatchObject({ code: -32601 })
    client.close()
  })

  it("sends notifications to every client that listens", async () => {
    const { core, root, dir } = await running()
    const a = await connect(root, { dir })
    const b = await connect(root, { dir })
    const heard: string[] = []
    a.on("activity.status", () => heard.push("a"))
    b.on("activity.status", () => heard.push("b"))
    // Each client's subscribe went out before this call on the same connection, so is in by its reply
    await Promise.all([a.call("core.ping"), b.call("core.ping")])
    // The settings are the person's: changed from the window, heard on the socket
    await core.handle({ jsonrpc: "2.0", id: 2, method: "activity.setEnabled", params: { enabled: false } })
    await eventually(() => expect(heard.sort()).toEqual(["a", "b"]))
    a.close()
    b.close()
  })

  it("leaves nothing behind when owlit closes, and takes over a stale socket", async () => {
    const { core, root, dir } = await running()
    const paths = socketPaths(root, dir)
    expect(existsSync(paths.socket)).toBe(true)
    await core.dispose()
    expect(existsSync(paths.socket)).toBe(false)
    expect(existsSync(paths.pointer)).toBe(false)
    await expect(connect(root, { dir })).rejects.toBeInstanceOf(OwlitNotRunning)

    // What a killed owlit leaves: a socket file nobody listens on, and its pointer
    writeFileSync(paths.socket, "")
    writeFileSync(paths.pointer, JSON.stringify({ socket: paths.socket, token: "x", pid: 999_999 }))
    await expect(connect(root, { dir })).rejects.toThrow(/isn't open with ws/)
    const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), socket: { dir } })
    cores.push(again)
    await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const client = await connect(root, { dir })
    expect(await client.call("core.ping")).toEqual({ ok: true })
    client.close()
  })

  it("names the socket as core does", () => {
    expect(socketPaths("/Users/x/Research", "/tmp")).toEqual(corePaths("/Users/x/Research", "/tmp"))
  })
})
