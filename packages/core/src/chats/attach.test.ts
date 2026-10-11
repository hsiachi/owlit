import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { makePdf, paragraph } from "../library/text/make-pdf.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-attach-")))
  const root = path.join(base, "ws")
  const outside = path.join(base, "Downloads")
  mkdirSync(root)
  mkdirSync(outside)
  const opened: string[] = []
  const open = async () => {
    const fetch = (async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch
    const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch, openPath: async (file) => void opened.push(file) }, retryBaseMs: 1 })
    cores.push(core)
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { core, call }
  }
  const put = (dir: string, name: string, data: string | Buffer) => {
    const at = path.join(dir, name)
    mkdirSync(path.dirname(at), { recursive: true })
    writeFileSync(at, data)
    return at
  }
  return { root, outside, open, put, opened }
}

const summary = (id: string) => ({ id, title: "New chat", createdAt: 1, updatedAt: 1, pinned: false, connectorId: "claude-code" })

const pdf = makePdf([[{ x: 120, y: 100, size: 18, text: "Notes Toward a Theory of Margins" }, ...paragraph(72, 180, ["A workshop paper no service has heard of."])]])

describe("files attached in chat", () => {
  it("copies a file from outside the workspace into the chat's folder, under its own name", async () => {
    const { root, outside, open, put } = await setup()
    const { call } = await open()
    const source = put(outside, "Reviewer comments.docx", "first")
    const first = await call("chats.attach", { chatId: "c1", path: source, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    expect(first.kind).toBe("file")
    expect(first.file).toMatchObject({ name: "Reviewer comments.docx", size: 5, path: ".owlit/chats/c1/files/Reviewer comments.docx" })
    // The same name again is kept beside it; the original is never touched
    writeFileSync(source, "second")
    const second = await call("chats.attach", { chatId: "c1", path: source })
    expect(second.file.path).toBe(".owlit/chats/c1/files/Reviewer comments 2.docx")
    expect(readFileSync(path.join(root, first.file.path), "utf8")).toBe("first")
    expect(readFileSync(source, "utf8")).toBe("second")
  })

  it("keeps a pasted file's bytes, and refuses a folder", async () => {
    const { root, outside, open } = await setup()
    const { call } = await open()
    const pasted = await call("chats.attach", { chatId: "c1", name: "image.png", mimeType: "image/png", data: Buffer.from("png bytes").toString("base64") })
    expect(pasted.file).toMatchObject({ name: "image.png", size: 9, mimeType: "image/png", path: ".owlit/chats/c1/files/image.png" })
    expect(readFileSync(path.join(root, pasted.file.path), "utf8")).toBe("png bytes")
    await expect(call("chats.attach", { chatId: "c1", path: outside })).rejects.toThrow("Folders can't be attached yet.")
  })

  it("makes a file in the workspace a doc, and a PDF the Library has that paper", async () => {
    const { root, outside, open, put } = await setup()
    const { call } = await open()
    put(root, "drafts/plan.md", "# Plan")
    put(root, "data/table.csv", "a,b")
    expect(await call("chats.attach", { chatId: "c1", path: path.join(root, "drafts/plan.md") })).toEqual({ kind: "doc", path: "drafts/plan.md" })
    expect(await call("chats.attach", { chatId: "c1", path: path.join(root, "data/table.csv") })).toEqual({ kind: "doc", path: "data/table.csv" })

    const { paper } = await call("library.importPdf", { path: put(outside, "margins.pdf", pdf) })
    // The same bytes under another name, anywhere, are that paper
    const again = put(outside, "copy of margins.pdf", pdf)
    expect(await call("chats.attach", { chatId: "c1", path: again, mimeType: "application/pdf" })).toEqual({ kind: "paper", paperId: paper.id })
    // A different PDF is a file
    const other = await call("chats.attach", { chatId: "c1", path: put(outside, "other.pdf", makePdf([[...paragraph(72, 100, ["Something else entirely."])]])) })
    expect(other.kind).toBe("file")
    expect(readdirSync(path.join(root, ".owlit/chats/c1/files"))).toEqual(["other.pdf"])
  })

  it("takes back a copy whose chip was removed, but not one a sent message has", async () => {
    const { root, outside, open, put } = await setup()
    const { call } = await open()
    await call("chats.create", { chat: summary("c1") })
    const kept = (await call("chats.attach", { chatId: "c1", path: put(outside, "a.txt", "a") })).file
    const dropped = (await call("chats.attach", { chatId: "c1", path: put(outside, "b.txt", "b") })).file
    await call("chats.appendMessage", { id: "c1", message: { id: "u1", role: "user", createdAt: 2, parts: [], attachments: [kept] } })
    await call("chats.detach", { chatId: "c1", path: dropped.path })
    await call("chats.detach", { chatId: "c1", path: kept.path })
    expect(readdirSync(path.join(root, ".owlit/chats/c1/files"))).toEqual(["a.txt"])
    await expect(call("chats.detach", { chatId: "c1", path: ".owlit/chats/c2/files/a.txt" })).rejects.toThrow("isn't a file of this chat")
    await expect(call("chats.detach", { chatId: "c1", path: ".owlit/chats/c1/files/../../c1.json" })).rejects.toThrow()
  })

  it("moves a deleted chat's files to the trash with it, and Undo brings both back", async () => {
    const { root, outside, open, put } = await setup()
    const { call } = await open()
    await call("chats.create", { chat: summary("c1") })
    const file = (await call("chats.attach", { chatId: "c1", path: put(outside, "a.txt", "a") })).file
    await call("chats.appendMessage", { id: "c1", message: { id: "u1", role: "user", createdAt: 2, parts: [], attachments: [file] } })
    await call("chats.delete", { id: "c1" })
    expect(existsSync(path.join(root, ".owlit/chats/c1"))).toBe(false)
    const [entry] = readdirSync(path.join(root, ".owlit/trash"))
    expect(entry).toMatch(/^\d+-chat-c1$/)
    expect(readdirSync(path.join(root, ".owlit/trash", entry)).sort()).toEqual(["chat.json", "files"])

    const restored = await call("chats.restore", { id: "c1" })
    expect(restored.messages[0].attachments[0].path).toBe(file.path)
    expect(readFileSync(path.join(root, file.path), "utf8")).toBe("a")
    expect((await call("chats.list")).map((c: any) => c.id)).toEqual(["c1"])
    expect(readdirSync(path.join(root, ".owlit/trash"))).toEqual([])
    await expect(call("chats.restore", { id: "c1" })).rejects.toThrow("already in the workspace")
  })

  it("clears the folder of a chat that never started, once it is a day old", async () => {
    const { root, outside, open, put } = await setup()
    const first = await open()
    await first.call("chats.create", { chat: summary("c1") })
    await first.call("chats.attach", { chatId: "c1", path: put(outside, "a.txt", "a") })
    await first.call("chats.attach", { chatId: "never", path: put(outside, "b.txt", "b") })
    await first.call("chats.attach", { chatId: "recent", path: put(outside, "c.txt", "c") })
    await first.core.dispose()
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    for (const id of ["c1", "never"]) utimesSync(path.join(root, ".owlit/chats", id), old, old)

    const second = await open()
    await second.call("chats.list")
    expect(existsSync(path.join(root, ".owlit/chats/c1/files/a.txt"))).toBe(true)
    expect(existsSync(path.join(root, ".owlit/chats/never"))).toBe(false)
    expect(existsSync(path.join(root, ".owlit/chats/recent/files/c.txt"))).toBe(true)
  })

  it("opens a copy in its app, and nothing else of .owlit", async () => {
    const { root, outside, open, put, opened } = await setup()
    const { call } = await open()
    const file = (await call("chats.attach", { chatId: "c1", path: put(outside, "a.txt", "a") })).file
    await call("chats.openFile", { path: file.path })
    expect(opened).toEqual([path.join(root, ".owlit/chats/c1/files/a.txt")])
    await expect(call("chats.openFile", { path: ".owlit/workspace.json" })).rejects.toThrow("isn't a file attached to a chat")
  })

  it("lets docs_read's PDF reading reach attached PDFs, and no other PDF in .owlit", async () => {
    const { root, outside, open, put } = await setup()
    const { call } = await open()
    const file = (await call("chats.attach", { chatId: "c1", path: put(outside, "margins.pdf", pdf) })).file
    expect((await call("docs.readPdf", { path: file.path })).text).toContain("<!-- page 1 -->")
    expect((await call("docs.readPdf", { path: path.join(root, file.path) })).text).toContain("Theory of Margins")
    put(root, ".owlit/trash/1-docs/old.pdf", pdf)
    await expect(call("docs.readPdf", { path: ".owlit/trash/1-docs/old.pdf" })).rejects.toThrow("owlit's own state")
  })
})
