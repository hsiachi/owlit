import type { Change, RpcNotification, UiRequest } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { eventually, until } from "../test-util.ts"

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
  const of = (method: string) => heard.filter((n) => n.method === method).map((n) => n.params as any)
  // The changes windows were told of, Owlit's and the undos
  const added = (): Change[] => of("changes.added").map((n) => n.change)
  // Every change kept for a path, oldest first
  const log = async (rel: string): Promise<Change[]> => (await call("changes.list", { path: rel })).reverse()
  return { core, root, call, heard, of, added, log }
}

describe("agent fs", () => {
  it("keeps the file as it was, records the write as Owlit's, and tells windows", async () => {
    const { core, root, of, added, log } = await setup()
    await core.fs.write(path.join(root, "a.md"), "agent text", { chatId: "chat-1" })
    const [entry] = await log("a.md")
    await core.dispose()
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("agent text")
    expect(entry).toMatchObject({ actor: expect.stringMatching(/^o_/), action: "update", target: { kind: "doc", path: "a.md" }, origin: { via: "tool", chatId: "chat-1" } })
    expect(readFileSync(path.join(root, ".owlit/versions", entry.id), "utf8")).toBe("on disk")
    expect(added()).toEqual([entry])
    expect(of("docs.changed")).toHaveLength(1)
  })

  it("says how much a reply's writes to a file changed it, from before the first to after the last", async () => {
    const { core, root, call, added } = await setup()
    await core.fs.write(path.join(root, "a.md"), "on disk and more", { chatId: "chat-1" })
    await core.fs.write(path.join(root, "a.md"), "on paper and more words", { chatId: "chat-1" })
    const [first, second] = added().map((c) => c.id)
    // "on disk" → "on paper and more words": the net change, not the two writes added up
    expect(await call("changes.stats", { ids: [first, second] })).toEqual({ unit: "words", added: 4, removed: 1, rewritten: false })
    // The first write alone ends where the second began
    expect(await call("changes.stats", { ids: [first] })).toEqual({ unit: "words", added: 2, removed: 0, rewritten: false })
  })

  it("reads and writes an open doc through the window that has it", async () => {
    const { core, root, call, added } = await setup()
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
    await core.fs.write(path.join(root, "a.md"), "agent text", { chatId: "c" })
    expect(asked.map((r) => r.method)).toEqual(["fs.read", "fs.read", "fs.write"])
    expect(asked[2]).toMatchObject({ clientId: "w1", params: { path: "a.md", content: "agent text" } })
    // The window applied it: core left the disk alone, and says the change once
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("on disk")
    const changeId = (asked[2].params as { changeId: string }).changeId
    expect(added().map((c) => c.id)).toEqual([changeId])
    expect(readFileSync(path.join(root, ".owlit/versions", changeId), "utf8")).toBe("typed in the editor")
  })

  it("tells windows of a doc it renamed, as the same doc at its new path, and makes no second folder", async () => {
    const { core, root, call, of } = await setup()
    mkdirSync(path.join(root, "Proactive Support"))
    writeFileSync(path.join(root, "Proactive Support/研究故事.md"), "story")
    const before = await call("docs.list")
    const { id } = before.files.find((f: { path: string }) => f.path === "Proactive Support/研究故事.md")
    const told = of("docs.changed").length
    expect(await core.fs.move("Proactive Support/研究故事.md", "Proactive Support/研究故事-v1.md", { kind: "socket", chatId: "chat-1" })).toBe("Proactive Support/研究故事-v1.md")
    const changes = of("docs.changed").slice(told)
    expect(changes.flatMap((c) => c.changed).map((f) => [f.id, f.path, f.content])).toEqual([[id, "Proactive Support/研究故事-v1.md", "story"]])
    expect(changes.flatMap((c) => c.deleted)).toEqual([])
    expect(changes.flatMap((c) => c.folders.created)).toEqual([])
    const after = await call("docs.list")
    expect(after.folders.filter((f: string) => f.startsWith("Proactive Support")).sort()).toEqual(["Proactive Support"])
  })

  it("tells windows of a folder a move made and of a doc it deleted", async () => {
    const { core, call, of, added } = await setup()
    const agent = { kind: "socket" as const, chatId: "chat-1" }
    const { id } = (await call("docs.list")).files.find((f: { path: string }) => f.path === "a.md")
    let told = of("docs.changed").length
    await core.fs.move("a.md", "new/deeper/a.md", agent)
    let changes = of("docs.changed").slice(told)
    expect(changes.flatMap((c) => c.folders.created)).toEqual(["new", "new/deeper"])
    expect(changes.flatMap((c) => c.changed).map((f) => [f.id, f.path])).toEqual([[id, "new/deeper/a.md"]])
    told = of("docs.changed").length
    await core.fs.remove(["new/deeper/a.md"], agent)
    changes = of("docs.changed").slice(told)
    expect(changes.flatMap((c) => c.deleted)).toEqual([{ id, path: "new/deeper/a.md" }])
    // A move is a delete and a create, one write; the removal another
    const [left, arrived, removed] = added()
    expect([left, arrived, removed].map((c) => [c.action, c.target.path])).toEqual([
      ["delete", "a.md"],
      ["create", "new/deeper/a.md"],
      ["delete", "new/deeper/a.md"],
    ])
    expect(arrived.origin.writeId).toBe(left.origin.writeId)
    expect(removed.origin.writeId).not.toBe(left.origin.writeId)
  })

  it("refuses paths outside the workspace and owlit's own, as written or through a link", async () => {
    const { core, root } = await setup()
    await expect(core.fs.read("/etc/passwd")).rejects.toThrow("outside the workspace")
    await expect(core.fs.read(path.join(root, "../../../etc/passwd"))).rejects.toThrow("outside the workspace")
    await expect(core.fs.write(path.join(root, ".owlit/workspace.json"), "{}")).rejects.toThrow("That file isn't one of the user's docs.")
    // macOS takes .OWLIT for .owlit and Library for library
    await expect(core.fs.write(path.join(root, ".OWLIT/workspace.json"), "{}")).rejects.toThrow("That file isn't one of the user's docs.")
    await expect(core.fs.write(path.join(root, "Library/papers/x/paper.json"), "{}")).rejects.toThrow("That file isn't one of the user's docs.")
    symlinkSync(path.join(root, ".owlit"), path.join(root, "state"))
    await expect(core.fs.write(path.join(root, "state/workspace.json"), "{}")).rejects.toThrow("That file isn't one of the user's docs.")
    // An agent's delete is the policy's to refuse, on the same target (agents.deleteDocs)
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "agents.deleteDocs", params: { paths: ["state"] } }, { kind: "socket", chatId: "c1" })
    expect(response).toMatchObject({ error: { message: "Not done: That file isn't one of the user's docs." } })
    // A symlink in the folder doesn't lead outside it
    const outside = mkdtempSync(path.join(tmpdir(), "owlit-outside-"))
    writeFileSync(path.join(outside, "secret.txt"), "secret")
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "notes.md"))
    symlinkSync(outside, path.join(root, "away"))
    await expect(core.fs.read(path.join(root, "notes.md"))).rejects.toThrow("leads outside the workspace")
    await expect(core.fs.write(path.join(root, "away/new.md"), "x")).rejects.toThrow("leads outside the workspace")
  })

  it("writes a paper's note through the library, tells windows, and undoes it", async () => {
    const { core, root, call, of, added } = await setup()
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: { id, title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    await call("library.setNote", { paperId: id, content: "Mine. Long and repeated." })
    const file = path.join(root, `library/papers/${id}/note.md`)
    await core.fs.write(file, "Mine.", { chatId: "chat-1" })
    expect(readFileSync(file, "utf8")).toBe("Mine.")
    // The window's own save is not news; the agent's edit is
    expect(of("library.noteChanged")).toEqual([{ paperId: id, note: expect.objectContaining({ paperId: id, content: "Mine." }) }])
    const [entry] = added()
    expect(entry).toMatchObject({ target: { kind: "doc", path: `library/papers/${id}/note.md` }, origin: { chatId: "chat-1" } })
    await call("changes.undo", { id: entry.id })
    expect(readFileSync(file, "utf8")).toBe("Mine. Long and repeated.")
    expect(of("library.noteChanged").at(-1)).toEqual({ paperId: id, note: expect.objectContaining({ content: "Mine. Long and repeated." }) })
    // The machine state inside .owlit/papers isn't writable
    await expect(core.fs.write(path.join(root, `.owlit/papers/${id}/state.json`), "{}")).rejects.toThrow("That file isn't one of the user's docs.")
  })

  it("keeps a note an agent wrote on disk itself as the agent's, while its tool call names the file", async () => {
    const { core, root, call, of, added } = await setup()
    const id = "arxiv-1706.03762"
    const rel = `library/papers/${id}/note.md`
    await call("library.add", { paper: { id, title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    await call("library.setNote", { paperId: id, content: "Mine. Long and repeated." })
    // Claude Code edits files itself; owlit only sees its tool call claim the path
    ;(core as any).turns.claims.set(rel, { chatId: "chat-2", toolCallId: "t2", until: Infinity })
    // A watcher only just started can miss a write (FSEvents on macOS, on a busy machine): the agent
    // writes again until core hears it. The same content is news only once.
    await vi.waitFor(
      () => {
        if (!of("library.noteChanged").length) writeFileSync(path.join(root, rel), "Mine.")
        expect(of("library.noteChanged")).not.toHaveLength(0)
      },
      { timeout: 4000, interval: 500 },
    )
    expect(of("library.noteChanged")).toEqual([{ paperId: id, note: expect.objectContaining({ content: "Mine." }) }])
    // Recorded just after windows hear of it
    const entry = await until(() => added()[0], { what: "the change in the log" })
    expect(entry).toMatchObject({ actor: expect.stringMatching(/^o_/), target: { kind: "doc", path: rel }, origin: { via: "watcher", chatId: "chat-2", toolCallId: "t2" } })
    await call("changes.undo", { id: entry.id })
    expect(readFileSync(path.join(root, rel), "utf8")).toBe("Mine. Long and repeated.")
    // The undo is owlit's own write: not recorded again as the agent's. An agent's write to another file,
    // heard the same way after it, is the sentinel: once it is in, the undo's turn has passed.
    ;(core as any).turns.claims.set("a.md", { chatId: "chat-3", toolCallId: "t3", until: Infinity })
    const owlits = () => added().filter((c) => c.actor.startsWith("o_"))
    await eventually(() => {
      if (!owlits().some((c) => c.target.path === "a.md")) writeFileSync(path.join(root, "a.md"), "the agent's sentinel")
      expect(owlits().map((c) => c.target.path)).toContain("a.md")
    }, 5_000)
    expect(owlits().map((c) => c.target.path)).toEqual([rel, "a.md"])
  })
})
