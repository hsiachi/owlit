import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { citationsIn } from "./wear.ts"

describe("citationsIn", () => {
  it("reads the paper, the page and the sentence given as the link's title", () => {
    const text = `Vague times mean no decision yet ([Rong et al. 2017](owlit://library/doi-10.1145-1#p4 "Participants often left the time open because they had not decided.")), see also [Lam 2024](owlit://library/arxiv-2401.1).`
    expect(citationsIn(text)).toEqual([
      { paperId: "doi-10.1145-1", page: 4, quote: "Participants often left the time open because they had not decided." },
      { paperId: "arxiv-2401.1" },
    ])
  })

  it("unescapes quotes in the title and folds its whitespace", () => {
    expect(citationsIn(`[A](owlit://library/p1#p2 "the \\"best\\"\n  result")`)).toEqual([{ paperId: "p1", page: 2, quote: `the "best" result` }])
  })

  it("leaves out links to docs and other places", () => {
    expect(citationsIn(`[d](owlit://docs/a.md "x") [c](owlit://chat/c1 "y") [w](https://example.org "z")`)).toEqual([])
  })
})

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function open() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-wear-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  return { call, root }
}

const answer = (id: string, at: number, text: string, role = "assistant") => ({ id, role, createdAt: at, parts: [{ type: "text", text }] })

describe("library.wear", () => {
  it("gathers the sentences answers cited of a paper, and the pages the person stayed on", async () => {
    const { call, root } = await open()
    await call("chats.create", { chat: { id: "c1", title: "Vague plans", createdAt: 1, updatedAt: 1, pinned: false } })
    await call("chats.appendMessage", { id: "c1", message: answer("u1", 10, `Is [Rong](owlit://library/p1#p4 "a sentence the user typed") right?`, "user") })
    await call("chats.appendMessage", {
      id: "c1",
      message: answer("a1", 20, `[Rong](owlit://library/p1#p4 "People leave times open.") and again [Rong](owlit://library/p1#p4 "People leave times open."); [Other](owlit://library/p2#p1 "Not this paper.") [Rong](owlit://library/p1)`),
    })
    await call("chats.create", { chat: { id: "c2", title: "Later", createdAt: 2, updatedAt: 2, pinned: false } })
    await call("chats.appendMessage", { id: "c2", message: answer("a2", 30, `[Rong](owlit://library/p1 "Reminders were seen as paternalistic.")`) })
    writeFileSync(
      path.join(root, ".owlit/journal.jsonl"),
      [
        { kind: "paper.dwell", at: 1, paperId: "p1", page: 4, seconds: 30, actor: "user" },
        { kind: "paper.dwell", at: 2, paperId: "p1", page: 4, seconds: 12, actor: "user" },
        { kind: "paper.dwell", at: 3, paperId: "p2", page: 1, seconds: 9, actor: "user" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    )

    const wear = await call("library.wear", { id: "p1" })
    expect(wear.cited).toEqual([
      { quote: "People leave times open.", page: 4, chatId: "c1", chatTitle: "Vague plans", messageId: "a1", at: 20 },
      { quote: "Reminders were seen as paternalistic.", chatId: "c2", chatTitle: "Later", messageId: "a2", at: 30 },
    ])
    expect(wear.pages).toEqual({ 4: 42 })
  })

  it("follows an answer that changed and a chat that was deleted", async () => {
    const { call } = await open()
    await call("chats.create", { chat: { id: "c1", title: "T", createdAt: 1, updatedAt: 1, pinned: false } })
    await call("chats.appendMessage", { id: "c1", message: answer("a1", 20, `[R](owlit://library/p1 "First.")`) })
    expect((await call("library.wear", { id: "p1" })).cited.map((c: any) => c.quote)).toEqual(["First."])
    await call("chats.patchMessage", { id: "c1", message: answer("a1", 25, `[R](owlit://library/p1 "Second.")`), final: true })
    expect((await call("library.wear", { id: "p1" })).cited.map((c: any) => c.quote)).toEqual(["Second."])
    await call("chats.delete", { id: "c1" })
    expect(await call("library.wear", { id: "p1" })).toEqual({ cited: [], pages: {} })
  })
})
