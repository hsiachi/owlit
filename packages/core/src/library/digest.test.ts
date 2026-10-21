import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Chat, RpcNotification } from "@owlit/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { TRY_AGAIN } from "../chats/chats.ts"
import { Core } from "../core.ts"
import { until, testSearchPath } from "../test-util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { makePdf, paragraph } from "./text/make-pdf.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  delete process.env.FAKE_ACP_LIMIT
  delete process.env.FAKE_ACP_SLOW_MS
})

// A workspace whose agent for owlit's own work is the fake one, and papers with their text read. With the
// socket up (tools), the fake agent writes the digest with owlit's tool, as owlit-mcp lets an agent.
async function setup({ tools = true } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-digest-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  // A short folder: a Unix socket's path has to fit in about a hundred bytes
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: path.join(base, "userData"), ...(tools ? { socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: ["--socket-dir", socketDir] } } : {}), searchPath: testSearchPath })
  cores.push(core)
  const heard: RpcNotification[] = []
  core.onNotify((n) => heard.push(n))
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const addPaper = async (id: string, text = true) => {
    await call("library.add", { paper: { id, title: `Paper ${id}`, authors: ["A. Author"], ids: { doi: `10.1/${id}` } } })
    if (text) writeFileSync(path.join(root, "library/papers", id, "text.md"), "<!-- page 1 -->\n\nThe paper's text.\n")
  }
  // The chat writing the digest, once its turn has ended
  const ended = (chatId: string) =>
    until(
      async () => {
        const chat: Chat = await call("chats.get", { id: chatId })
        const reply = chat.messages.at(-1)
        return reply?.role === "assistant" && reply.status !== "streaming" && !(await call("agents.running")).some((t: { chatId: string }) => t.chatId === chatId) ? chat : undefined
      },
      { what: `the chat ${chatId}` },
    )
  const ask = async (id: string, rewrite?: boolean) => {
    const asked = await call("library.requestDigest", { id, ...(rewrite ? { rewrite } : {}) })
    expect(asked).toEqual({ chatId: expect.any(String) })
    return ended(asked.chatId)
  }
  return { root, call, workspace, addPaper, ask, ended, heard }
}

describe("digests", () => {
  it("are written when asked, in a chat about the paper that no chat list shows; opening or starring a paper asks for nothing", async () => {
    const { root, call, workspace, addPaper, ask } = await setup()
    await addPaper("doi-10.1-opened")
    await addPaper("doi-10.1-starred")
    await addPaper("doi-10.1-a")
    await call("activity.emit", { event: { kind: "paper.opened", at: Date.now(), paperId: "doi-10.1-opened" } })
    await call("library.update", { id: "doi-10.1-starred", patch: { starred: true } })
    const chat = await ask("doi-10.1-a")
    expect(chat).toMatchObject({ startedBy: "owlit", about: { kind: "paper", id: "doi-10.1-a" }, role: "reviewer", title: "Digest of “Paper doi-10.1-a”" })
    // The recipe, and where the paper's text came from rather than the text itself
    const asked = chat.messages[0]!.parts[0]
    expect(asked).toMatchObject({ type: "text", text: expect.stringContaining("library_write_digest, id doi-10.1-a") })
    expect(asked).toMatchObject({ text: expect.stringContaining("(The paper's full text, from library/papers/doi-10.1-a/text.md, followed here.)") })
    expect(asked).not.toMatchObject({ text: expect.stringContaining("The paper's text.") })
    expect(chat.messages[1]).toMatchObject({ role: "assistant", status: "done" })
    expect(chat.messages[1]!.parts).toContainEqual(expect.objectContaining({ type: "tool_call", title: "mcp__owlit__library_write_digest", status: "completed" }))

    const digest = readFileSync(path.join(root, "library/papers/doi-10.1-a/digest.md"), "utf8")
    // Unset, the language is the system's; a test host has none, so English
    expect(digest).toMatch(/^# Paper doi-10\.1-a\n\n## Summary\n\n- \*\*Background\*\*: Written in English, having seen 0 pictures\./)
    expect(digest).toContain("## Details")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1-a/digest.json"), "utf8"))).toMatchObject({ format: 3, language: "en", by: expect.stringMatching(/^custom-/), pictures: 0 })
    expect((await call("library.list")).papers.find((p: { id: string }) => p.id === "doi-10.1-a")).toMatchObject({ hasDigest: true, digestAt: expect.any(Number) })
    expect(await call("chats.list")).toEqual([])
    // Only the paper asked about has a chat
    expect((await workspace.chats.started()).map((c) => c.about?.id)).toEqual(["doi-10.1-a"])
    expect(await call("library.digestSource", { id: "doi-10.1-a" })).toEqual({ pictures: 0, language: "en", textPages: 1 })
  })

  it("writes in the language Settings asks for, and says when a note is in another", async () => {
    const { root, call, addPaper, ask } = await setup()
    // A word typed before the setting was a list means the listed language
    await call("settings.update", { patch: { library: { digestLanguage: "中文" } } })
    expect((await call("settings.get")).library).toMatchObject({ digestLanguage: "zh-Hans", digestLanguageSystem: "en" })
    await addPaper("doi-10.1-zh")
    await ask("doi-10.1-zh")
    expect(readFileSync(path.join(root, "library/papers/doi-10.1-zh/digest.md"), "utf8")).toContain("Written in Simplified Chinese (简体中文)")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1-zh/digest.json"), "utf8"))).toMatchObject({ language: "zh-Hans" })

    await call("settings.update", { patch: { library: { digestLanguage: "ja" } } })
    expect((await call("library.list")).papers[0].digestOutdated).toBe("language")
  })

  it("writes none over a note that is there unless asked to, and none for a paper with nothing to read", async () => {
    const { root, call, addPaper, ask } = await setup()
    await addPaper("doi-10.1-kept")
    const note = path.join(root, "library/papers/doi-10.1-kept/digest.md")
    writeFileSync(note, "# From pitta\n\nKept as it is.\n")
    expect(await call("library.requestDigest", { id: "doi-10.1-kept" })).toEqual({ heldBack: "has-digest" })
    expect(readFileSync(note, "utf8")).toBe("# From pitta\n\nKept as it is.\n")
    // Written another way than owlit writes notes now: the page offers to rewrite it
    const paper = async () => (await call("library.list")).papers.find((p: { id: string }) => p.id === "doi-10.1-kept")
    expect((await paper()).digestOutdated).toBe("format")
    await ask("doi-10.1-kept", true)
    expect(readFileSync(note, "utf8")).toMatch(/^# Paper doi-10\.1-kept\n\n## Summary/)
    expect((await paper()).digestOutdated).toBeUndefined()

    await addPaper("doi-10.1-none", false)
    expect(await call("library.requestDigest", { id: "doi-10.1-none" })).toEqual({ heldBack: "nothing-to-read" })
    expect(existsSync(path.join(root, "library/papers/doi-10.1-none/digest.md"))).toBe(false)
  })

  it("shows the agent the paper's figures as attached pictures, and lists them", async () => {
    const { root, addPaper, ask } = await setup()
    await addPaper("doi-10.1-fig")
    const dir = path.join(root, "library/papers/doi-10.1-fig")
    // As paper.figures leaves them; a PDF so the figures count as the paper's
    writeFileSync(path.join(dir, "paper.pdf"), "%PDF-1.4\n%%EOF\n")
    mkdirSync(path.join(dir, "figures"))
    writeFileSync(path.join(dir, "figures/figure-1.png"), "png bytes")
    writeFileSync(
      path.join(dir, "figures.json"),
      JSON.stringify({ version: 1, source: "layout", at: Date.now(), figures: [{ id: "figure-1", kind: "figure", label: "Figure 1", caption: "Figure 1: A chart.", page: 0, rect: { x: 1, y: 2, w: 3, h: 4 }, file: "figure-1.png" }] }),
    )
    const chat = await ask("doi-10.1-fig")
    expect(chat.messages[0]!.attachments).toEqual([expect.objectContaining({ name: "figure-1.png", mimeType: "image/png", path: expect.stringMatching(/^\.owlit\/chats\/.+\/files\/figure-1\.png$/) })])
    const digest = readFileSync(path.join(dir, "digest.md"), "utf8")
    expect(digest).toContain("having seen 1 pictures")
    expect(digest).toContain("![Figure](figure-1)")
    expect(JSON.parse(readFileSync(path.join(dir, "digest.json"), "utf8"))).toMatchObject({ pictures: 1 })
  })

  it("says why it failed on the chat's reply, and Retry is a new turn in that chat", async () => {
    process.env.FAKE_ACP_LIMIT = "You've hit your session limit · resets 2:20am (Asia/Shanghai)"
    const { root, addPaper, ask } = await setup()
    await addPaper("doi-10.1-limit")
    const failed = await ask("doi-10.1-limit")
    expect(failed.messages.at(-1)).toMatchObject({ status: "error", error: "Fake's usage limit is reached; it resets at 2:20." })
    expect(existsSync(path.join(root, "library/papers/doi-10.1-limit/digest.md"))).toBe(false)

    // Still at its limit: what matters here is where the second try goes
    const retried = await ask("doi-10.1-limit")
    expect(retried.id).toBe(failed.id)
    expect(retried.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(retried.messages[2]!.parts).toEqual([{ type: "text", text: TRY_AGAIN }])
  })

  it("says so when the agent ended without writing it", async () => {
    const { call, addPaper, ask } = await setup({ tools: false })
    await addPaper("doi-10.1-silent")
    const { id } = await ask("doi-10.1-silent")
    const chat: Chat = await until(async () => {
      const c: Chat = await call("chats.get", { id })
      return c.messages.at(-1)?.status === "error" ? c : undefined
    })
    expect(chat.messages.at(-1)).toMatchObject({ status: "error", error: "Owlit finished without writing the digest." })
  })

  it("is one chat however often it is asked for while it is written, and stops with that chat", async () => {
    // Long enough to be stopped while it reads
    process.env.FAKE_ACP_SLOW_MS = "60000"
    const { call, addPaper, ended } = await setup()
    await addPaper("doi-10.1-once")
    const [a, b] = await Promise.all([call("library.requestDigest", { id: "doi-10.1-once" }), call("library.requestDigest", { id: "doi-10.1-once" })])
    expect(b.chatId).toBe(a.chatId)
    await call("agents.cancel", { chatId: a.chatId })
    const chat = await ended(a.chatId)
    expect(chat.messages.at(-1)).toMatchObject({ status: "cancelled" })
  })

  it("answers at once while the paper's text is read, and starts the chat once it is", async () => {
    const { root, call, workspace, addPaper, ended } = await setup()
    await addPaper("doi-10.1-pdf", false)
    // Put there by hand, so nothing has read it yet
    writeFileSync(path.join(root, "library/papers/doi-10.1-pdf/paper.pdf"), makePdf([paragraph(72, 100, ["The text the digest is written from, long enough to count."])]))
    expect(await call("library.requestDigest", { id: "doi-10.1-pdf" })).toEqual({ gettingText: true })
    // The chat starts only once the PDF is read (pdfium, behind the text task's queue): as patient as the
    // test below, which waits on the same read
    const started = await until(async () => (await workspace.chats.latestAbout({ kind: "paper", id: "doi-10.1-pdf" }))?.id, { timeout: 60_000, what: "the digest's chat to start" })
    expect((await ended(started)).messages.at(-1)).toMatchObject({ status: "done" })
    expect(readFileSync(path.join(root, "library/papers/doi-10.1-pdf/text.md"), "utf8")).toContain("The text the digest is written from")
    expect(existsSync(path.join(root, "library/papers/doi-10.1-pdf/digest.md"))).toBe(true)
  }, 70_000)

  it("tells every window when the chat can't start once the text is read", async () => {
    const { root, call, workspace, addPaper, heard } = await setup()
    await addPaper("doi-10.1-broken", false)
    writeFileSync(path.join(root, "library/papers/doi-10.1-broken/paper.pdf"), "%PDF-1.4\n%%EOF\n")
    expect(await call("library.requestDigest", { id: "doi-10.1-broken" })).toEqual({ gettingText: true })
    const told = await until(() => heard.find((n) => n.method === "chats.notStarted"), { timeout: 60_000, what: "the chat not starting" })
    expect(told.params).toEqual({ about: { kind: "paper", id: "doi-10.1-broken" }, error: "Owlit couldn't get this paper's text to read." })
    expect(await workspace.chats.latestAbout({ kind: "paper", id: "doi-10.1-broken" })).toBeUndefined()
  }, 70_000)

  it("starts a new chat on Retry when the language changed since the one that broke", async () => {
    process.env.FAKE_ACP_LIMIT = "You've hit your session limit · resets 2:20am (Asia/Shanghai)"
    const { call, addPaper, ask } = await setup()
    await addPaper("doi-10.1-lang")
    const failed = await ask("doi-10.1-lang")
    await call("settings.update", { patch: { library: { digestLanguage: "ja" } } })
    const again = await ask("doi-10.1-lang")
    expect(again.id).not.toBe(failed.id)
    expect(again.messages[0]!.parts[0]).toMatchObject({ text: expect.stringContaining("Japanese") })
  })
})
