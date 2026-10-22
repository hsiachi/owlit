import type { ReadFrom } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { LibraryRead } from "../agents/read-from.ts"
import { ChangeLog } from "../changes/log.ts"
import { newWriteId, Recorder } from "../changes/record.ts"
import { WINDOW, type Caller } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { Citations, type CitationServices } from "./citations.ts"

const TEXT = [
  "<!-- page 1 -->",
  "We study agents. Agents help novices most. Experts gain less.",
  "## 1 Introduction",
  "Reicherts et al. (2021) define proactive help as acting before being asked.",
  "<!-- page 4 -->",
  "## 4 Results",
  "Completion rose from 62% to 86% with the agent. The effect held for novices.",
].join("\n\n")
const ABSTRACT = "We study agents. Agents help novices most. Experts gain less."

const link = (id: string, quote?: string, page?: number) => `[Kim 2024](owlit://library/${id}${page ? `#p${page}` : ""}${quote ? ` "${quote}"` : ""})`

function setup({ reads = [] as LibraryRead[], answered = [] as ReadFrom[], answering = true } = {}) {
  const owlit = mkdtempSync(path.join(tmpdir(), "owlit-citations-"))
  let clock = 1_000
  const services: CitationServices = {
    reads: () => reads,
    answering: () => answering,
    answered: async () => answered,
    // "kim" is in the Library with its text; "lee" with its abstract only; "gone" isn't there
    canonical: async (id) => (id === "doi-kim" ? "kim" : ["kim", "lee"].includes(id) ? id : undefined),
    paper: async (id) => ({ abstract: id === "kim" ? ABSTRACT : "Lee studies typing.", hasText: id === "kim", text: async () => (id === "kim" ? TEXT : null) }),
  }
  const citations = new Citations(owlit, services)
  const log = new ChangeLog(owlit)
  const recorder = new Recorder(log, { profile: async () => ({ id: "me" }), now: () => (clock += 1_000), written: (change, before, after) => citations.written(change, before, after) })
  const owlitCaller: Caller = { kind: "owlit", chatId: "c1" }
  const states = async (rel: string, text: string) => {
    await citations.idle
    return (await citations.of(rel, text)).citations.map((c) => [c.by, c.state])
  }
  return { owlit, citations, recorder, owlitCaller, states, tick: (ms: number) => (clock += ms) }
}

describe("a citation's state", () => {
  it("comes from what Owlit read: the page, a section, the whole text", async () => {
    const reads: LibraryRead[] = [
      { asker: "chat:c1", paperId: "doi-kim", part: "text", pages: "4", at: 0 },
    ]
    const { recorder, owlitCaller, states } = setup({ reads })
    const doc = [link("kim", "Completion rose from 62% to 86% with the agent."), link("kim", "Reicherts et al. (2021) define proactive help as acting before being asked."), link("kim")].join(" ")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    expect(await states("a.md", doc)).toEqual([
      ["owlit", "read"],
      ["owlit", "in-paper"],
      ["owlit", "whole"],
    ])
  })

  it("says read for a sentence under a section Owlit asked for, and gives where it sits", async () => {
    const { recorder, owlitCaller, citations } = setup({ reads: [{ asker: "chat:c1", paperId: "kim", part: "text", section: "introduction", at: 0 }] })
    const doc = link("kim", "Reicherts et al. (2021) define proactive help as acting before being asked.")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    await citations.idle
    const [c] = (await citations.of("a.md", doc)).citations
    expect(c).toMatchObject({
      state: "read",
      libraryId: "kim",
      hasText: true,
      passage: { page: 1, section: "1 Introduction" },
      owlitRead: { depth: "part" },
      citesOther: [{ marker: "Reicherts et al. (2021)" }],
      chatId: "c1",
      from: 0,
      to: doc.length,
    })
  })

  it("puts the abstract first, and tells a missing sentence from a paper without text", async () => {
    const { recorder, owlitCaller, states } = setup({ reads: [{ asker: "chat:c1", paperId: "kim", part: "text", at: 0 }] })
    const doc = [link("kim", "Agents help novices most."), link("kim", "Nobody used the agent."), link("lee", "Lee finds typing slows."), link("lee", "Lee studies typing.")].join("\n")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    expect(await states("a.md", doc)).toEqual([
      ["owlit", "abstract"],
      ["owlit", "not-found"],
      ["owlit", "no-text"],
      ["owlit", "abstract"],
    ])
  })

  it("takes page runs that together name every page as the whole text", async () => {
    // A long paper comes in runs that each know its page count; read to the end, the paper was read in full
    const runs: LibraryRead[] = [
      { asker: "chat:c1", paperId: "kim", part: "text", pages: "1", of: 2, at: 0 },
      { asker: "chat:c1", paperId: "kim", part: "text", pages: "2", of: 2, at: 1 },
    ]
    const { recorder, owlitCaller, citations } = setup({ reads: runs })
    const doc = [link("kim", "Completion rose from 62% to 86% with the agent."), link("kim", "Nobody used the agent.")].join("\n")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    await citations.idle
    const all = (await citations.of("a.md", doc)).citations
    expect(all.map((c) => c.state)).toEqual(["read", "not-found"])
    expect(all[0]!.owlitRead).toEqual({ depth: "full" })
  })

  it("says not read for a bare citation of a paper Owlit read nothing of, and counts what wasn't read", async () => {
    const { recorder, owlitCaller, citations } = setup({ reads: [{ asker: "chat:c1", paperId: "kim", part: "text", pages: "4", at: 0 }] })
    const doc = [link("lee"), link("kim", "Completion rose from 62% to 86% with the agent."), link("kim", "Agents help novices most."), link("gone")].join("\n")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    await citations.idle
    const { citations: all, counts } = await citations.of("a.md", doc)
    expect(all.map((c) => c.state)).toEqual(["not-read", "read", "abstract", "not-read"])
    expect(counts).toMatchObject({ total: 4, read: 1, abstract: 1, notRead: 2, notReadInPaper: 3 })
  })

  it("takes what the chat's earlier answers recorded, and never turns lost reads into not read", async () => {
    const earlier = setup({ answered: [{ paperId: "kim", depth: "part", pages: "3–5" }], answering: false })
    const doc = [link("kim", "Completion rose from 62% to 86% with the agent."), link("lee")].join("\n")
    await earlier.recorder.doc(earlier.owlitCaller, "a.md", null, doc)
    expect(await earlier.states("a.md", doc)).toEqual([
      ["owlit", "read"],
      ["owlit", "bare"],
    ])
  })

  it("has no Owlit state for the person's own, and none known for what was there before", async () => {
    const { recorder, owlitCaller, states } = setup()
    const old = link("kim", "Agents help novices most.")
    // A doc from before owlit kept citations: no record of its first citation
    const theirs = `${old}\n${link("lee")}`
    await recorder.saved(WINDOW, "a.md", old, theirs)
    const mine = `${theirs}\n${link("kim")}`
    await recorder.doc(owlitCaller, "a.md", theirs, mine)
    expect(await states("a.md", mine)).toEqual([
      ["unknown", "abstract"],
      ["person", null],
      ["owlit", "not-read"],
    ])
    expect(await states("a.md", `${mine}\n${link("lee", "Lee studies typing.")}`)).toEqual([
      ["unknown", "abstract"],
      ["person", null],
      ["owlit", "not-read"],
      ["unknown", "abstract"],
    ])
  })

  it("says read once Owlit gives an old bare link the sentence from a page its turn read", async () => {
    const { recorder, owlitCaller, states } = setup({ reads: [{ asker: "chat:c1", paperId: "kim", part: "text", pages: "4", at: 0 }] })
    const bare = `Completion rose ${link("kim")}.`
    await recorder.saved(WINDOW, "a.md", bare, bare + " ")
    expect(await states("a.md", bare)).toEqual([["unknown", "bare"]])
    const titled = `Completion rose ${link("kim", "Completion rose from 62% to 86% with the agent.", 4)}.`
    await recorder.doc(owlitCaller, "a.md", bare, titled)
    expect(await states("a.md", titled)).toEqual([["owlit", "read"]])
  })

  it("says bare for a citation another program wrote", async () => {
    const { recorder, states } = setup()
    const doc = link("kim")
    await recorder.doc({ kind: "socket" }, "a.md", null, doc)
    expect(await states("a.md", doc)).toEqual([["other", "bare"]])
  })
})

describe("what is kept", () => {
  it("keeps who wrote a citation through an undo that brings it back, and through a move", async () => {
    const { recorder, owlitCaller, states, owlit } = setup()
    const doc = `Intro ${link("kim")}`
    await recorder.doc(owlitCaller, "a.md", null, doc)
    // The person deletes the line, then takes the delete back
    await recorder.saved(WINDOW, "a.md", doc, "Intro")
    await recorder.doc(WINDOW, "a.md", "Intro", doc)
    expect(await states("a.md", doc)).toEqual([["owlit", "not-read"]])
    // Moved: the same write leaves a.md and arrives at b.md
    const writeId = newWriteId()
    await recorder.doc(WINDOW, "a.md", doc, null, { origin: { writeId } })
    await recorder.doc(WINDOW, "b.md", null, doc, { origin: { writeId } })
    expect(await states("b.md", doc)).toEqual([["owlit", "not-read"]])
    const kept = JSON.parse(await readFile(path.join(owlit, "citations.json"), "utf8"))
    expect(Object.keys(kept.docs)).toEqual(["b.md"])
  })

  it("forgets a citation a month after it left the doc", async () => {
    const { recorder, owlitCaller, states, tick } = setup()
    const doc = link("kim")
    await recorder.doc(owlitCaller, "a.md", null, doc)
    await recorder.saved(WINDOW, "a.md", doc, "")
    tick(31 * 24 * 3_600_000)
    await recorder.doc({ kind: "socket" }, "b.md", null, "other doc")
    expect(await states("a.md", doc)).toEqual([["unknown", "bare"]])
  })

  it("reads what another core kept", async () => {
    const first = setup()
    const doc = link("kim")
    await first.recorder.doc(first.owlitCaller, "a.md", null, doc)
    await first.citations.idle
    const again = new Citations(first.owlit, { reads: () => [], answering: () => false, answered: async () => [], canonical: async (id) => id, paper: async () => ({ hasText: false, text: async () => null }) })
    expect((await again.of("a.md", doc)).citations.map((c) => [c.by, c.state])).toEqual([["owlit", "not-read"]])
  })
})

describe("through core", () => {
  const cores: Core[] = []
  afterEach(async () => {
    await Promise.all(cores.splice(0).map((c) => c.dispose()))
  })

  it("serves a doc's citations from the reads core saw, and a sentence's place for the card", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-citations-core-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch } })
    cores.push(core)
    const call = async (method: string, params: unknown, caller?: Caller): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    await call("library.add", { paper: { id: "doi-10.9999-k", title: "K", authors: [], ids: { doi: "10.9999/k" }, abstract: ABSTRACT } })
    writeFileSync(path.join(root, "library/papers/doi-10.9999-k/text.md"), TEXT)
    await call("library.read", { id: "doi-10.9999-k", part: "text", pages: "4", asker: "chat:c1" })
    const doc = [link("doi-10.9999-k", "Completion rose from 62% to 86% with the agent."), link("doi-10.9999-k", "Agents help novices most.")].join("\n")
    // An agent's write for chat c1, as the change log records it
    const ws = (core as unknown as { workspace: Workspace }).workspace
    writeFileSync(path.join(root, "a.md"), doc)
    await ws.recorder.doc({ kind: "owlit", chatId: "c1" }, "a.md", null, doc)
    // Asked after the write, answered after it is kept: the two take turns
    expect((await call("docs.citations", { path: "a.md" })).counts).toMatchObject({ total: 2, read: 1, abstract: 1, notReadInPaper: 1 })
    // The window's text, ahead of the disk: a citation it holds that no write brought yet
    const ahead = await call("docs.citations", { path: "a.md", text: `${doc}\n${link("doi-10.9999-k")}` })
    expect(ahead.citations.map((c: { by: string; state: string }) => [c.by, c.state])).toEqual([
      ["owlit", "read"],
      ["owlit", "abstract"],
      ["unknown", "bare"],
    ])
    expect(await call("library.passage", { id: "doi-10.9999-k", quote: "Reicherts et al. (2021) define proactive help as acting before being asked." })).toEqual({
      passage: { page: 1, section: "1 Introduction" },
      citesOther: [{ marker: "Reicherts et al. (2021)" }],
    })
    expect(await call("library.passage", { id: "doi-10.9999-k", quote: "Nothing like it." })).toBeNull()
  })
})
