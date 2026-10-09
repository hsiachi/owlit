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
    const undone = await call("versions.restore", { id: versionId })
    expect(undone).toMatchObject({ path: "a.md", kind: "file" })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    // The undo can be undone, and that too
    const redone = await call("versions.restore", { id: undone.redoId })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("agent text")
    await call("versions.restore", { id: redone.redoId })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    await core.fs.write(path.join(root, "a.md"), "second")
    await new Promise((r) => setTimeout(r, 50))
    const second = journal().at(-1).versionId
    writeFileSync(path.join(root, "a.md"), "the user typed more")
    const error = await call("versions.restore", { id: second }).catch((e) => e)
    expect(error.message).toBe("a.md changed after the agent's edit, so owlit left it as it is.")
    // A restore the user chose from the doc's versions goes ahead, keeping what was there
    const forced = await call("versions.restore", { id: second, force: true })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    await call("versions.restore", { id: forced.redoId, force: true })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("the user typed more")
    // Every change and every undo is listed, newest first
    const listed = await call("versions.list", { path: "a.md" })
    expect(listed.map((v: { by: string }) => v.by)).toEqual(["undo", "undo", "agent", "undo", "undo", "undo", "agent"])
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

  it("writes a paper's note through the library, tells windows, and undoes it", async () => {
    const { core, root, call, journal, of } = await setup()
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: { id, title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    await call("library.setNote", { paperId: id, content: "Mine. Long and repeated." })
    const file = path.join(root, `.owlit/papers/${id}/note.md`)
    await core.fs.write(file, "Mine.", "chat-1")
    expect(readFileSync(file, "utf8")).toBe("Mine.")
    // The window's own save is not news; the agent's edit is
    expect(of("library.noteChanged")).toEqual([{ paperId: id, note: expect.objectContaining({ paperId: id, content: "Mine." }) }])
    const entry = journal().find((e) => e.kind === "agent.wrote")
    expect(entry).toMatchObject({ path: `.owlit/papers/${id}/note.md`, chatId: "chat-1" })
    expect(of("agent.wrote")).toEqual([{ path: `.owlit/papers/${id}/note.md`, versionId: entry.versionId, chatId: "chat-1" }])
    await call("versions.restore", { id: entry.versionId })
    expect(readFileSync(file, "utf8")).toBe("Mine. Long and repeated.")
    expect(of("library.noteChanged").at(-1)).toEqual({ paperId: id, note: expect.objectContaining({ content: "Mine. Long and repeated." }) })
    // Nothing else inside .owlit/papers is writable
    await expect(core.fs.write(path.join(root, `.owlit/papers/${id}/state.json`), "{}")).rejects.toThrow("inside .owlit")
  })

  it("keeps a note an agent wrote on disk itself as the agent's, while its tool call names the file", async () => {
    const { core, root, call, journal, of } = await setup()
    const id = "arxiv-1706.03762"
    const rel = `.owlit/papers/${id}/note.md`
    await call("library.add", { paper: { id, title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    await call("library.setNote", { paperId: id, content: "Mine. Long and repeated." })
    // Claude Code edits files itself; owlit only sees its tool call claim the path
    ;(core as any).turns.claims.set(rel, { chatId: "chat-2", until: Infinity })
    writeFileSync(path.join(root, rel), "Mine.")
    await new Promise((r) => setTimeout(r, 600))
    expect(of("library.noteChanged")).toEqual([{ paperId: id, note: expect.objectContaining({ content: "Mine." }) }])
    const entry = journal().find((e) => e.kind === "agent.wrote")
    expect(entry).toMatchObject({ path: rel, chatId: "chat-2" })
    expect(of("agent.wrote")).toEqual([{ path: rel, versionId: entry.versionId, chatId: "chat-2" }])
    await call("versions.restore", { id: entry.versionId })
    expect(readFileSync(path.join(root, rel), "utf8")).toBe("Mine. Long and repeated.")
    // The undo is owlit's own write: not recorded again as the agent's
    await new Promise((r) => setTimeout(r, 400))
    expect(of("agent.wrote")).toHaveLength(1)
  })
})
