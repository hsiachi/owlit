import { Core, socketPaths as corePaths } from "@owlit/core"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { eventually } from "../../core/src/test-util.ts"
import { connect, OwlitNotRunning, socketPaths } from "./index.ts"

const FAKE_AGENT = path.join(import.meta.dirname, "../../core/src/agents/fake-acp.ts")
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

  it("takes the chat a connection works for from the session secret core gave, never from what the client says", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-sock-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    const dir = realpathSync(mkdtempSync("/tmp/ows-"))
    const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir }, mcp: { command: "owlit-mcp", args: [] } })
    cores.push(core)
    const window = (method: string, params: unknown) => core.handle({ jsonrpc: "2.0", id: 1, method, params })
    await window("workspace.open", { path: root })
    await window("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
    await window("library.add", { paper: { id: "doi-10.9-a", title: "A", authors: [], ids: { doi: "10.9/a" } } })
    const star = { id: "doi-10.9-a", patch: { starred: true } }
    // Naming the chat isn't enough: the client is a program with no chat, which can't star the user's paper
    const named = await connect(root, { dir, as: { chatId: "c1" } })
    await expect(named.call("library.update", star)).rejects.toThrow(/^Not done: From outside owlit/)
    named.close()
    // The secret core handed owlit-mcp for the chat's session makes it the chat's Assistant
    const session = core.mcpServers(root, "c1")[0]!.env.find((e) => e.name === "OWLIT_SESSION")!.value
    const granted = await connect(root, { dir, session })
    await expect(granted.call("library.update", star)).resolves.toMatchObject({ starred: true })
    granted.close()
  })

  it("stops taking a session's secret as its chat once the session ends", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-sock-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    const dir = realpathSync(mkdtempSync("/tmp/ows-"))
    const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir }, mcp: { command: "owlit-mcp", args: [] } })
    cores.push(core)
    // The secrets core gives the chat's sessions
    const secrets: string[] = []
    const grant = core.mcpServers.bind(core)
    core.mcpServers = (at, chatId) => {
      const servers = grant(at, chatId)
      secrets.push(...servers.flatMap((s) => s.env.filter((e) => e.name === "OWLIT_SESSION").map((e) => e.value)))
      return servers
    }
    const window = async (method: string, params: unknown) => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw new Error(response.error.message)
      return response.result as any
    }
    await window("workspace.open", { path: root })
    const agent = await window("agents.add", { name: "Fake", command: `"${process.execPath}" "${FAKE_AGENT}"` })
    await window("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
    await window("library.add", { paper: { id: "doi-10.9-a", title: "A", authors: [], ids: { doi: "10.9/a" } } })
    await window("agents.prompt", { chatId: "c1", connectorId: agent.id, input: { text: "hello", mentions: [], attachments: [] }, userMessage: { id: "u1", role: "user", createdAt: 1, parts: [{ type: "text", text: "hello" }] }, assistantMessageId: "a1" })
    expect(secrets).toHaveLength(1)
    const star = { id: "doi-10.9-a", patch: { starred: true } }
    const granted = await connect(root, { dir, session: secrets[0] })
    await expect(granted.call("library.update", star)).resolves.toMatchObject({ starred: true })
    // The chat is deleted: its session ends, the program on its secret is cut off, and the secret names no chat
    await window("chats.delete", { id: "c1" })
    await expect(granted.call("core.ping")).rejects.toThrow()
    const again = await connect(root, { dir, session: secrets[0] })
    await expect(again.call("library.update", { ...star, patch: { starred: false } })).rejects.toThrow(/^Not done: From outside owlit/)
    again.close()
  })

  it("passes errors on in a sentence", async () => {
    const { root, dir } = await running()
    const client = await connect(root, { dir })
    await expect(client.call("library.nothing" as never)).rejects.toMatchObject({ code: -32601 })
    client.close()
  })

  it("sends notifications to every client that listens", async () => {
    const { core, root, dir } = await running()
    const a = await connect(root, { dir })
    const b = await connect(root, { dir })
    const heard: string[] = []
    a.on("settings.changed", () => heard.push("a"))
    b.on("settings.changed", () => heard.push("b"))
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
