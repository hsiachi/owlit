import type { Change, DocComment, JournalEntry, Paper, PersonId, Project } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { LIVE_SESSIONS, SESSION_GAP_MS, sessionStarts, summarize, type SummaryServices } from "./summary.ts"

const ME: PersonId = "p_00000001"
const OTHER: PersonId = "p_00000002"
const DAY = 86_400_000
const NOW = 100 * DAY

const project = (path: string, over: Partial<Project> = {}): Project => ({ path, mark: `${path}/project.md`, name: path, parents: [], currentDrafts: [], ...over })
const edit = (path: string, at: number, actor: PersonId = ME): JournalEntry => ({ kind: "doc.edited", path, at, actor })
// One working session of the person's somewhere else, at a time
const elsewhere = (at: number): JournalEntry => ({ kind: "paper.opened", paperId: "x", at, actor: ME })
// The person left a chat they wrote in
const chatted = (chatId: string, at: number): JournalEntry => ({ kind: "chat.ended", chatId, at, actor: ME })
const owlitEdit = (path: string, at: number, chatId?: string): Change => ({ id: `${at}`, at, actor: "o_00000001", action: "update", target: { kind: "doc", path }, origin: { via: "tool", ...(chatId ? { chatId } : {}) } })
const comment = (id: string, over: Partial<DocComment> = {}): DocComment => ({ id, quote: "q", prefix: "", suffix: "", entries: [], createdAt: 1, ...over })

function services(over: Partial<SummaryServices> & { docs?: string[] } = {}): SummaryServices {
  const docs = over.docs ?? []
  return {
    projects: async () => [],
    files: async () => docs.map((path) => ({ path, modifiedAt: 1 })),
    journal: async () => [],
    comments: async () => [],
    read: async () => "",
    proposals: async () => 0,
    paper: async () => undefined,
    unseen: async () => [],
    changes: async () => [],
    chatStartedBy: async () => "person",
    chatWork: async () => ({ projects: [], docs: [] }),
    ...over,
  }
}

describe("sessionStarts", () => {
  it("starts a session after a gap longer than SESSION_GAP_MS, in any order of events", () => {
    expect(sessionStarts([SESSION_GAP_MS + 11, 0, 10, 5])).toEqual([0, SESSION_GAP_MS + 11])
    expect(sessionStarts([0, SESSION_GAP_MS])).toEqual([0])
    expect(sessionStarts([])).toEqual([])
  })
})

describe("summarize", () => {
  it("counts live in the person's sessions, not in days", async () => {
    // A edited three weeks ago, and the person hasn't worked since but for two sittings
    const quietSince = NOW - 21 * DAY
    const a = await summarize(
      services({
        docs: ["A/draft.md", "B/draft.md"],
        projects: async () => [project("A"), project("B")],
        journal: async () => [edit("B/draft.md", quietSince - 5 * DAY), edit("A/draft.md", quietSince), elsewhere(NOW - 2 * DAY), elsewhere(NOW - DAY)],
      }),
      ME,
    )
    expect(a.sessions).toBe(4)
    expect(a.projects.map((p) => [p.path, p.live])).toEqual([
      ["A", true],
      ["B", true],
    ])

    // A edited yesterday, then LIVE_SESSIONS sittings elsewhere since
    const after = Array.from({ length: LIVE_SESSIONS }, (_, i) => elsewhere(NOW - DAY + (i + 1) * 2 * SESSION_GAP_MS))
    const b = await summarize(
      services({ docs: ["A/draft.md"], projects: async () => [project("A")], journal: async () => [edit("A/draft.md", NOW - DAY), ...after] }),
      ME,
    )
    expect(b.projects[0]).toMatchObject({ path: "A", live: false, lastWorked: { path: "A/draft.md", at: NOW - DAY } })
  })

  it("takes no edit to a mark for work on its project", async () => {
    const s = await summarize(services({ docs: ["A/d.md"], projects: async () => [project("A")], journal: async () => [edit("A/project.md", NOW)], changes: async () => [owlitEdit("A/project.md", NOW, "c1")] }), ME)
    expect(s.projects[0]!.live).toBe(false)
    expect(s.projects[0]!.workedAt).toBeUndefined()
  })

  it("reads only the person's own events", async () => {
    const s = await summarize(services({ docs: ["A/d.md"], projects: async () => [project("A")], journal: async () => [edit("A/d.md", NOW, OTHER)] }), ME)
    expect(s.sessions).toBe(0)
    expect(s.projects[0]!.live).toBe(false)
  })

  it("folds a done project however lately it was worked on", async () => {
    const s = await summarize(services({ docs: ["A/d.md"], projects: async () => [project("A", { status: "done" })], journal: async () => [edit("A/d.md", NOW)] }), ME)
    expect(s.projects[0]).toMatchObject({ status: "done", live: false, lastWorked: { path: "A/d.md", at: NOW } })
  })

  it("puts a doc in its nearest project, and falls back to the newest current draft for lastWorked", async () => {
    const drafts = [{ kind: "Paper", path: "A/Paper v2.md", modifiedAt: 50 }]
    const s = await summarize(
      services({
        docs: ["A/Paper v2.md", "A/sub/notes.md"],
        projects: async () => [project("A", { currentDrafts: drafts }), project("A/sub", { parents: ["A"] })],
        journal: async () => [edit("A/sub/notes.md", NOW), edit("gone/old.md", NOW + 1)],
      }),
      ME,
    )
    expect(s.projects.find((p) => p.path === "A")).toEqual(expect.objectContaining({ live: false, lastWorked: { path: "A/Paper v2.md", at: 50, draft: true } }))
    expect(s.projects.find((p) => p.path === "A/sub")).toMatchObject({ live: true, lastWorked: { path: "A/sub/notes.md", at: NOW } })
  })

  it("counts what waits on the current drafts: open comments, Owlit's proposals, cited papers owlit gave up on", async () => {
    const drafts = [
      { kind: "Intro", path: "A/Intro v3.md", modifiedAt: 3 },
      { kind: "Method", path: "A/Method.md", modifiedAt: 2 },
    ]
    const texts: Record<string, string> = {
      "A/Intro v3.md": "See [Lee](owlit://library/p1 \"a\") and [Kim](owlit://library/p2).",
      "A/Method.md": "Again [Lee](owlit://library/doi-p1) and [Wu](owlit://library/p3) and [gone](owlit://library/p4).",
    }
    const papers: Record<string, Pick<Paper, "id" | "pdf" | "pdfState">> = {
      p1: { id: "p1", pdfState: { state: "no-pdf", tried: [] } },
      // The same paper by another id counts once
      "doi-p1": { id: "p1", pdfState: { state: "no-pdf", tried: [] } },
      // Still being looked for
      p2: { id: "p2", pdfState: { state: "finding", tried: [] } },
      p3: { id: "p3", pdf: { url: "owlit-file://workspace/p3.pdf" } },
    }
    const s = await summarize(
      services({
        docs: ["A/Intro v3.md", "A/Method.md", "A/old.md"],
        projects: async () => [project("A", { currentDrafts: drafts })],
        comments: async (rel) => (rel === "A/Method.md" ? [comment("c1"), comment("c2", { resolvedAt: 5 }), comment("c3", { foldedAt: 5 }), comment("c4")] : []),
        read: async (rel) => texts[rel] ?? null,
        proposals: async (rel) => (rel === "A/Intro v3.md" ? 2 : 0),
        paper: async (id) => papers[id],
      }),
      ME,
    )
    expect(s.projects[0]!.waits).toEqual({ comments: 2, commentsIn: "A/Method.md", proposals: 2, proposalsIn: "A/Intro v3.md", noPdf: 1 })
  })

  it("counts the docs others changed since the person looked, the newest first", async () => {
    const change = (path: string, at: number, actor: Change["actor"] = "o_00000001"): Change => ({ id: `${at}`, at, actor, action: "update", target: { kind: "doc", path }, origin: { via: "tool" } })
    const s = await summarize(
      services({
        docs: ["A/a.md", "A/b.md", "B/c.md"],
        projects: async () => [project("A")],
        unseen: async () => [change("A/a.md", 5), change("A/b.md", 9), change("A/a.md", 7), change("B/c.md", 10), change("A/deleted.md", 11)],
      }),
      ME,
    )
    expect(s.projects[0]).toMatchObject({ changed: 2, changedIn: "A/b.md" })
  })

  it("counts the person's chats in a project as work on it, without naming a doc", async () => {
    const drafts = [{ kind: "Paper", path: "A/Paper.md", modifiedAt: 50 }]
    const s = await summarize(
      services({
        docs: ["A/Paper.md"],
        projects: async () => [project("A", { currentDrafts: drafts }), project("B")],
        journal: async () => [chatted("c1", NOW), chatted("c2", NOW + DAY)],
        chatWork: async (id) => ({ projects: id === "c1" ? [project("A")] : [], docs: [] }),
      }),
      ME,
    )
    expect(s.projects.find((p) => p.path === "A")).toEqual(expect.objectContaining({ live: true, workedAt: NOW, lastWorked: { path: "A/Paper.md", at: 50, draft: true } }))
    expect(s.projects.find((p) => p.path === "B")).toMatchObject({ live: false })
    expect(s.projects.find((p) => p.path === "B")!.workedAt).toBeUndefined()
  })

  it("counts Owlit's edits in a chat the person started, not in one owlit started on its own", async () => {
    const s = await summarize(
      services({
        docs: ["A/Intro.md", "A/Method.md", "B/Notes.md"],
        projects: async () => [project("A"), project("B")],
        journal: async () => [edit("A/Method.md", NOW), elsewhere(NOW + 3 * SESSION_GAP_MS)],
        changes: async () => [owlitEdit("A/Intro.md", NOW + 2 * SESSION_GAP_MS, "mine"), owlitEdit("B/Notes.md", NOW + 4 * SESSION_GAP_MS, "owlits"), owlitEdit("B/Notes.md", NOW + 5 * SESSION_GAP_MS)],
        chatStartedBy: async (id) => (id === "mine" ? "person" : "owlit"),
      }),
      ME,
    )
    expect(s.projects.find((p) => p.path === "A")).toMatchObject({ live: true, lastWorked: { path: "A/Intro.md", at: NOW + 2 * SESSION_GAP_MS, by: "owlit" }, workedAt: NOW + 2 * SESSION_GAP_MS })
    expect(s.projects.find((p) => p.path === "B")).toMatchObject({ live: false })
  })

  it("keeps a paper live that the person writes through chats, its last typed edit long gone", async () => {
    // A typed edit, then a chat in each of more than LIVE_SESSIONS sittings, a day apart
    const days = Array.from({ length: LIVE_SESSIONS + 2 }, (_, i) => chatted(i % 2 ? "c1" : "c2", NOW + (i + 1) * DAY))
    const s = await summarize(
      services({
        docs: ["A/Story v3.md"],
        projects: async () => [project("A")],
        journal: async () => [edit("A/Story v3.md", NOW), ...days],
        chatWork: async () => ({ projects: [project("A")], docs: ["A/Story v3.md"] }),
      }),
      ME,
    )
    expect(s.projects[0]).toMatchObject({ live: true, lastWorked: { path: "A/Story v3.md", at: NOW }, workedAt: NOW + (LIVE_SESSIONS + 2) * DAY })
  })

  it("offers a loose folder the person worked in through a chat or Owlit's edits", async () => {
    const s = await summarize(
      services({
        docs: ["Talk/slides.md", "Grant/aims.md", "A/d.md"],
        projects: async () => [project("A")],
        journal: async () => [chatted("c1", NOW)],
        chatWork: async () => ({ projects: [], docs: ["Talk/slides.md", "A/d.md", "gone.md"] }),
        changes: async () => [owlitEdit("Grant/aims.md", NOW + 1, "c1")],
      }),
      ME,
    )
    expect(s.folders).toEqual([
      { path: "Grant", doc: "Grant/aims.md", lastWorked: NOW + 1 },
      { path: "Talk", doc: "Talk/slides.md", lastWorked: NOW },
    ])
  })

  it("offers the top folder of docs edited lately in no project, once each, newest first", async () => {
    const old = Array.from({ length: LIVE_SESSIONS }, (_, i) => elsewhere(NOW + (i + 1) * 2 * SESSION_GAP_MS))
    const s = await summarize(
      services({
        docs: ["Review/5110/Final Review.md", "Review/notes.md", "Reading/list.md", "Stale/x.md", "root.md", "A/d.md"],
        projects: async () => [project("A")],
        journal: async () => [
          edit("Stale/x.md", NOW - DAY),
          edit("Reading/list.md", NOW),
          ...old,
          edit("Review/notes.md", NOW + 20 * SESSION_GAP_MS),
          edit("Review/5110/Final Review.md", NOW + 21 * SESSION_GAP_MS),
          edit("root.md", NOW + 22 * SESSION_GAP_MS),
          edit("A/d.md", NOW + 23 * SESSION_GAP_MS),
        ],
      }),
      ME,
    )
    // Reading's and Stale's edits are more than LIVE_SESSIONS sessions back; root.md is in no folder
    expect(s.folders).toEqual([{ path: "Review", doc: "Review/5110/Final Review.md", lastWorked: NOW + 21 * SESSION_GAP_MS }])
  })
})
