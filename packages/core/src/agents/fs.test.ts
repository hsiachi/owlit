import type { RpcNotification, UiRequest } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-agentfs-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "a.md"), "on disk")
  const core = new Core({
    userDataDir: path.join(base, "userData"),
    host: { trash: async (p) => renameSync(p, path.join(base, `trashed-${path.basename(p)}`)) },
  })
  cores.push(core)
  const heard: RpcNotification[] = []
  core.onNotify((n) => heard.push(n))
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  await call("docs.list")
  const journal = () =>
    readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
  const of = (method: string) => heard.filter((n) => n.method === method).map((n) => n.params as any)
  return { core, root, call, heard, journal, of }
}

describe("agent fs", () => {
  it("keeps the file as it was, journals the write as the agent's, and tells windows", async () => {
    const { core, root, journal, of } = await setup()
    await core.fs.write(path.join(root, "a.md"), "agent text", "chat-1")
    await core.dispose()
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("agent text")
    const [entry] = journal()
    expect(entry).toMatchObject({ kind: "agent.wrote", actor: "agent", path: "a.md", chatId: "chat-1" })
    expect(readFileSync(path.join(root, ".owlit/versions", entry.versionId), "utf8")).toBe("on disk")
    expect(of("agent.wrote")).toEqual([{ path: "a.md", versionId: entry.versionId, chatId: "chat-1" }])
    expect(of("docs.changed")).toHaveLength(1)
  })

  it("restores the version, unless the file changed since", async () => {
    const { core, root, call, journal } = await setup()
    await core.fs.write(path.join(root, "a.md"), "agent text")
    const { versionId } = journal()[0] ?? (await new Promise((r) => setTimeout(r, 50)), journal()[0])
    expect(await call("versions.restore", { id: versionId })).toEqual({ path: "a.md" })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    await core.fs.write(path.join(root, "a.md"), "second")
    await new Promise((r) => setTimeout(r, 50))
    const second = journal().at(-1).versionId
    writeFileSync(path.join(root, "a.md"), "the user typed more")
    const error = await call("versions.restore", { id: second }).catch((e) => e)
    expect(error.message).toBe("a.md changed after the agent's edit, so owlit left it as it is.")
  })

  it("undoes a file the agent created by moving it to the Trash", async () => {
    const { core, root, call, journal } = await setup()
    await core.fs.write(path.join(root, "notes/new.md"), "made by the agent")
    await new Promise((r) => setTimeout(r, 50))
    await call("versions.restore", { id: journal()[0].versionId })
    expect(existsSync(path.join(root, "notes/new.md"))).toBe(false)
  })

  it("reads and writes an open doc through the window that has it", async () => {
    const { core, root, call, of } = await setup()
    const asked: UiRequest[] = []
    core.onNotify((n) => {
      if (n.method !== "ui.request") return
      const req = n.params as UiRequest
      asked.push(req)
      const result = req.method === "fs.read" ? { content: "typed in the editor" } : { applied: true }
      void call("ui.respond", { requestId: req.requestId, result })
    })
    await call("ui.setOpenDocs", { clientId: "w1", paths: ["a.md"] })
    expect(await core.fs.read(path.join(root, "a.md"))).toEqual({ content: "typed in the editor" })
    await core.fs.write(path.join(root, "a.md"), "agent text", "c")
    expect(asked.map((r) => r.method)).toEqual(["fs.read", "fs.read", "fs.write"])
    expect(asked[2]).toMatchObject({ clientId: "w1", params: { path: "a.md", content: "agent text" } })
    // The window applied it: core left the disk alone and offered no Undo of its own
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    expect(of("agent.wrote")).toEqual([])
    const versionId = (asked[2].params as { versionId: string }).versionId
    expect(readFileSync(path.join(root, ".owlit/versions", versionId), "utf8")).toBe("typed in the editor")
  })

  it("refuses paths outside the workspace and inside .owlit", async () => {
    const { core, root } = await setup()
    await expect(core.fs.read("/etc/passwd")).rejects.toThrow("outside the workspace")
    await expect(core.fs.read(path.join(root, "../../../etc/passwd"))).rejects.toThrow("outside the workspace")
    await expect(core.fs.write(path.join(root, ".owlit/workspace.json"), "{}")).rejects.toThrow("inside .owlit")
  })
})
