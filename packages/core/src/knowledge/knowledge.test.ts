import { serializeTopic, type KnowledgeRun, type Topic, type TopicSidecar } from "@owlit/protocol"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Workspace } from "../workspace/workspace.ts"
import { checkTopic, countSentences, countWords, findQuote } from "./check.ts"
import { diff, lineChange, type KnowledgeServices } from "./knowledge.ts"

const blank = (): TopicSidecar => ({ seenAt: 0, history: [], edits: {}, removed: {}, said: {}, changedAt: {} })

const PAPER = "arxiv-2005.11401"
const QUOTE = "In the RAG-Token model we can draw a different latent document for each target token and marginalize accordingly."

const topicFile = (lines: string[], extra = "") => `# Retrieval granularity

Per-token retrieval lets one answer draw on several documents.

## Understanding

${lines.join("\n")}
${extra}`

const ragLine = `- Lewis et al. 2020: RAG-Token can use a different retrieved document for each token. ^s1
  - [§2.1](owlit://library/${PAPER}#passage=rag-token)`

describe("checkTopic", () => {
  const passages = { [PAPER]: new Set(["rag-token"]) }

  it("holds a write to the caps and says by how much it is over", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `- Owlit thinks: Point number ${i + 1} about retrieval. ^s${i + 1}`)
    const { problems } = checkTopic({ before: null, content: topicFile(lines), sidecar: blank(), remove: [], passages })
    expect(problems).toContain("Understanding has 9 lines; at most 7, so 2 too many. Merge lines, or say in your answer that the topic should be split.")
    const long = `- Owlit thinks: ${"word ".repeat(35).trim()}. ^s1`
    expect(checkTopic({ before: null, content: topicFile([long]), sidecar: blank(), remove: [], passages }).problems).toEqual(["^s1 has 35 words; at most 30."])
  })

  it("wants every line to say who says it, and a passage for a paper's voice", () => {
    const content = topicFile([ragLine, "- Retrieval helps a lot. ^s2", "- Chen 2025: Retrieval adds latency. ^s3", "- The internet: Retrieval is fine. ^s4"])
    const { problems } = checkTopic({ before: null, content, sidecar: blank(), remove: [], passages })
    expect(problems).toEqual([
      "Understanding has a line that isn't “Speaker: one sentence ^id”: “- Retrieval helps a lot. ^s2”. Every line starts with who says it.",
      "^s3 speaks for Chen 2025 without a passage: cite owlit://library/<id>#passage=<name> and give that passage's quote in passages (or #abstract when only the abstract says it).",
      "“The internet” isn't a speaker. A line is said by You, Owlit, or a paper by its short cite (“Chen 2025”, “Lewis et al. 2020”).",
      "^s4 speaks for The internet without a passage: cite owlit://library/<id>#passage=<name> and give that passage's quote in passages (or #abstract when only the abstract says it).",
    ])
  })

  it("keeps the user's own lines word for word and their removals out", () => {
    const before = { ...topicOf([ragLine, "- You: Per-token retrieval is what makes multi-document answers possible. ^s2"]) }
    const sidecar: TopicSidecar = { ...blank(), edits: { s2: { text: "Per-token retrieval is what makes multi-document answers possible.", at: 1 } }, removed: { s3: { text: "Retrieval always helps.", at: 1 } } }
    const rewritten = topicFile([ragLine, "- You: Per-token retrieval makes multi-document answers possible. ^s2", "- Owlit thinks: Retrieval always helps. ^s4"])
    expect(checkTopic({ before, content: rewritten, sidecar, remove: [], passages }).problems).toEqual([
      "^s2 is the user's own wording: keep it word for word, as “You: Per-token retrieval is what makes multi-document answers possible.”.",
      "The user removed “Retrieval always helps.”; don't bring it back.",
    ])
    // An id that belonged to a removed line isn't given to another
    const reused = topicFile([ragLine, "- You: Per-token retrieval is what makes multi-document answers possible. ^s2", "- Owlit thinks: Something new. ^s3"])
    expect(checkTopic({ before, content: reused, sidecar, remove: [], passages }).problems).toEqual([
      "^s3 belonged to a line that was removed; give the new line a new id (or none, and owlit picks one).",
    ])
  })

  it("keeps the user's lines in their own voice", () => {
    const content = topicFile([ragLine, "- You: Your Related work builds on this model. ^s2", "- Owlit thinks: Your draft and this paper agree. ^s3", "- You: My Related work builds on this model. ^s4"])
    expect(checkTopic({ before: null, content, sidecar: blank(), remove: [], passages }).problems).toEqual([
      '^s2 is the user speaking, so it is in their voice, first person ("I", "my draft"), not "your": “Your Related work builds on this…”.',
    ])
  })

  it("wants a line that goes named in remove, and gives new lines fresh ids", () => {
    const before = topicOf([ragLine, "- Owlit thinks: Retrieval granularity matters. ^s2"])
    const dropped = topicFile([ragLine])
    expect(checkTopic({ before, content: dropped, sidecar: blank(), remove: [], passages }).problems).toEqual([
      "^s2 (“Retrieval granularity matters.”) is gone. Keep it, or name it in remove and say why.",
    ])
    const { topic, problems } = checkTopic({ before, content: topicFile([ragLine, "- Owlit thinks: A new thought."]), sidecar: blank(), remove: ["s2"], passages })
    expect(problems).toEqual([])
    // s2 is retired with the line it named
    expect(topic.lines.map((l) => l.id)).toEqual(["s1", "s3"])
  })

  it("lets only the user ask questions", () => {
    const content = topicFile([ragLine], "\n## Questions\n\n- Owlit: Should retrieval happen per token? ^q1\n")
    expect(checkTopic({ before: null, content, sidecar: blank(), remove: [], passages }).problems).toEqual([
      "Questions are only the user's own words, written “- You: …”: “Owlit: Should retrieval happen per token?…”.",
    ])
  })

  it("counts words and sentences the way the caps mean them", () => {
    expect(countWords("RAG-Token can use a different document.")).toBe(6)
    expect(countWords("检索增强生成可以在每个词元上换一篇文档")).toBe(10)
    expect(countSentences("Lewis et al. 2020 found it works, e.g. on QA. It is slow.")).toBe(2)
    expect(countSentences("每个词元换一篇文档。代价是更慢。")).toBe(2)
  })

  it("finds a quote in a paper's text across line breaks and hyphenation", () => {
    const text = "<!-- page 1 -->\n\nIntro.\n\n<!-- page 3 -->\n\nRAG-Token Model In the RAG-Token model we can draw a differ-\nent latent document for each target token and marginalize accordingly. This allows"
    expect(findQuote(text, QUOTE)).toBe(3)
    expect(findQuote(text, "Not in the paper at all")).toBeNull()
  })
})

describe("the history of a line", () => {
  const line = { id: "s1", speaker: "Jacovi et al. 2025", text: "Three prompted judges reduce bias.", sources: [{ label: "§3.1", uri: `owlit://library/${PAPER}#passage=judges` }] }

  it("keeps the old words only when the words changed", () => {
    expect(lineChange(line, { ...line, text: "Three judges reduce bias." })).toEqual({ what: "Rewritten", before: "Three prompted judges reduce bias." })
    // Spacing isn't a rewrite
    expect(lineChange(line, { ...line, text: " Three prompted  judges\nreduce bias. " })).toBeNull()
    expect(lineChange(line, { ...line, condition: "Factuality is the mean of the three judges." })).toEqual({ what: "Source changed" })
    expect(lineChange(line, { ...line, sources: [{ label: "§3.2", uri: `owlit://library/${PAPER}#passage=other` }] })).toEqual({ what: "Source changed" })
    expect(lineChange(line, { ...line, speaker: "Owlit" })).toEqual({ what: "Speaker changed" })
  })

  it("records a write's changes line by line", () => {
    const before = topicOf([ragLine, "- Owlit thinks: Retrieval granularity matters. ^s2"])
    const next = topicOf([ragLine, "- Owlit thinks: Retrieval granularity matters. ^s2\n  - Only for multi-hop questions."])
    expect(diff(before, next)).toEqual([{ lineId: "s2", what: "Source changed" }])
    expect(diff(before, before)).toEqual([])
  })
})

function topicOf(lines: string[]): Topic {
  const content = topicFile(lines)
  const t = checkTopic({ before: null, content, sidecar: blank(), remove: [], passages: { [PAPER]: new Set(["rag-token"]) } }).topic
  return { ...t, id: "retrieval-granularity", path: "knowledge/Retrieval granularity.md", updatedAt: 0 }
}

// ---- A workspace with Knowledge ----

const open: Workspace[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((w) => w.dispose()))
})

async function setup(knowledge: (ws: () => Workspace) => KnowledgeServices = () => ({})) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-knowledge-")))
  const root = path.join(base, "ws")
  mkdirSync(path.join(root, "library/papers", PAPER), { recursive: true })
  writeFileSync(path.join(root, "library/papers", PAPER, "paper.json"), JSON.stringify({ id: PAPER, title: "Retrieval-Augmented Generation", authors: ["Patrick Lewis"], year: 2020, ids: { arxiv: "2005.11401" } }))
  writeFileSync(path.join(root, "library/papers", PAPER, "text.md"), `<!-- page 1 -->\n\nIntro.\n\n<!-- page 3 -->\n\nRAG-Token Model ${QUOTE} This allows the generator.\n`)
  let ws: Workspace | undefined
  const workspace = await Workspace.open(root, path.join(base, "userData"), {
    knowledge: knowledge(() => ws!),
    tasks: { definitions: (w) => [...w.knowledge.tasks(), ...w.search.tasks()] },
  })
  ws = workspace
  open.push(workspace)
  const journal = (...entries: object[]) => appendFileSync(path.join(root, ".owlit/journal.jsonl"), entries.map((e) => JSON.stringify({ actor: "user", at: Date.now(), ...e }) + "\n").join(""))
  const settled = async (n = 1) => {
    for (let i = 0; i < 400; i++) {
      const done = workspace.tasks.list().filter((t) => t.kind === "knowledge.update" && ["done", "failed", "cancelled"].includes(t.state))
      if (done.length >= n) return done
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error("no knowledge run finished")
  }
  return { root, workspace, journal, settled }
}

const firstTopic = topicFile([ragLine], `\n## Sources\n\n- 2026-10-09 · [Lewis et al. 2020](owlit://library/${PAPER}) · you highlighted §2.1\n`)

describe("Knowledge", () => {
  it("writes a checked topic, records each change and keeps the passage it cites", async () => {
    const changed: unknown[] = []
    const { root, workspace } = await setup(() => ({ changed: (c) => changed.push(c) }))
    await expect(workspace.knowledge.write({ topic: "Retrieval granularity", content: firstTopic, why: "you highlighted §2.1" })).rejects.toThrow(
      "^s1 speaks for Lewis et al. 2020 without a passage",
    )
    await expect(
      workspace.knowledge.write({ topic: "Retrieval granularity", content: firstTopic, why: "x", passages: [{ id: "rag-token", paper: PAPER, quote: "Something the paper never says" }] }),
    ).rejects.toThrow("The passage “rag-token” isn't in arxiv-2005.11401 word for word")

    const done = await workspace.knowledge.write({ topic: "Retrieval granularity", content: firstTopic, why: "you highlighted §2.1", passages: [{ id: "rag-token", paper: PAPER, quote: QUOTE, section: "§2.1" }] })
    expect(done).toEqual({ id: "retrieval-granularity", path: "knowledge/Retrieval granularity.md", name: "Retrieval granularity", changes: ["Started", "Added ^s1"] })
    const file = readFileSync(path.join(root, done.path), "utf8")
    expect(file).toMatch(/^---\nid: retrieval-granularity\n---\n# Retrieval granularity\n/)
    const side = JSON.parse(readFileSync(path.join(root, ".owlit/knowledge/topics/retrieval-granularity.json"), "utf8")) as TopicSidecar
    expect(side.history.map((h) => [h.what, h.lineId, h.why])).toEqual([
      ["Added", "s1", "you highlighted §2.1"],
      ["Started", undefined, "you highlighted §2.1"],
    ])
    expect(side.changedAt.s1).toBeGreaterThan(0)
    const paper = JSON.parse(readFileSync(path.join(root, `.owlit/knowledge/papers/${PAPER}.json`), "utf8"))
    expect(paper.passages["rag-token"]).toMatchObject({ section: "§2.1", page: 2, start: "In the RAG-Token model we can draw a" })
    expect(readFileSync(path.join(root, ".owlit/knowledge/changes.jsonl"), "utf8").trim().split("\n")).toHaveLength(2)
    expect(changed).toMatchObject([{ topics: { "retrieval-granularity": { changedAt: { s1: expect.any(Number) } } }, papers: { [PAPER]: {} } }])

    // A topic the user paused is left alone
    writeFileSync(path.join(root, ".owlit/knowledge/topics/retrieval-granularity.json"), JSON.stringify({ ...side, paused: true }))
    await expect(workspace.knowledge.write({ topic: "retrieval-granularity", content: firstTopic, why: "x" })).rejects.toThrow("The user paused updates")
  })

  it("runs from the journal, snapshots knowledge/ first, and can be reverted", async () => {
    const prompts: string[] = []
    const updated: KnowledgeRun[] = []
    const { root, workspace, journal, settled } = await setup((ws) => ({
      agent: async (prompt) => {
        prompts.push(prompt)
        await ws().knowledge.write({ topic: "Retrieval granularity", content: firstTopic, why: "you highlighted §2.1", passages: [{ id: "rag-token", paper: PAPER, quote: QUOTE }] })
        return { text: "Retrieval granularity: one line added.", connectorId: "fake" }
      },
      updated: (run) => updated.push(run),
    }))
    // Nothing the user did yet: a run reads the journal and stops
    workspace.knowledge.update()
    await settled(1)
    expect(prompts).toEqual([])

    journal({ kind: "highlight.added", paperId: PAPER, highlightId: "h1" }, { kind: "highlight.added", paperId: PAPER, highlightId: "h2" }, { kind: "doc.edited", path: "Related work.md" })
    journal({ kind: "agent.wrote", actor: "agent", path: "Other.md", versionId: "v" })
    workspace.knowledge.update()
    await settled(2)
    expect(prompts[0]).toContain("- Wrote in the doc Related work.md (docs_read)")
    expect(prompts[0]).toContain(`- Read “Retrieval-Augmented Generation” (${PAPER}): 2 new highlights (library_highlights)`)
    expect(prompts[0]).not.toContain("Other.md")
    expect(updated.at(-1)).toMatchObject({ items: [{ topicId: "retrieval-granularity", what: "One line added" }] })
    const versionId = updated.at(-1)!.versionId!
    // The snapshot is of knowledge/ before the run: empty
    expect(readdirSync(path.join(root, ".owlit/knowledge/versions", versionId))).toEqual(["version.json"])
    const run = JSON.parse(readFileSync(path.join(root, ".owlit/knowledge/run.json"), "utf8"))
    expect(run.cursor).toBe(readFileSync(path.join(root, ".owlit/journal.jsonl")).length)

    // The journal is read from where the last run stopped
    workspace.knowledge.update()
    await settled(3)
    expect(prompts).toHaveLength(1)

    const back = await workspace.knowledge.revert(versionId)
    expect(back.files).toEqual([])
    expect(existsSync(path.join(root, "knowledge/Retrieval granularity.md"))).toBe(false)
    // And the revert itself can be undone
    await workspace.knowledge.revert(back.versionId)
    expect(readFileSync(path.join(root, "knowledge/Retrieval granularity.md"), "utf8")).toBe(serializeTopic({ ...topicOf([ragLine]), id: "retrieval-granularity", sources: [{ date: "2026-10-09", ref: { label: "Lewis et al. 2020", uri: `owlit://library/${PAPER}` }, how: "you highlighted §2.1" }] }))
  })

  it("waits for quiet, and runs at most once in the minimum gap however long the user keeps editing", async () => {
    let runs = 0
    const { workspace, journal, settled } = await setup((ws) => ({
      agent: async () => {
        runs++
        await ws().knowledge.write({ topic: `Topic ${runs}`, content: `# Topic ${runs}\n\n## Understanding\n\n- Owlit thinks: Thought ${runs}.\n`, why: "you wrote" })
        return { text: "ok", connectorId: "fake" }
      },
      timings: { delays: { "doc.edited": 60, "knowledge.edited": 0 }, minGap: 400 },
    }))
    // Typing for a second, a pause every 20ms
    const started = Date.now()
    while (Date.now() - started < 1000) {
      journal({ kind: "doc.edited", path: "a.md" })
      workspace.knowledge.heard({ kind: "doc.edited", at: Date.now(), path: "a.md" })
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(runs).toBe(0)
    await settled(1)
    expect(runs).toBe(1)
    // Update now doesn't wait for quiet
    journal({ kind: "doc.edited", path: "a.md" })
    workspace.knowledge.heard({ kind: "doc.edited", at: Date.now(), path: "a.md" })
    workspace.knowledge.update()
    await settled(2)
    expect(runs).toBe(2)
    // More editing right after a run waits out the gap
    journal({ kind: "doc.edited", path: "a.md" })
    workspace.knowledge.heard({ kind: "doc.edited", at: Date.now(), path: "a.md" })
    await new Promise((r) => setTimeout(r, 200))
    expect(runs).toBe(2)
    await settled(3)
    expect(runs).toBe(3)
  })
})
