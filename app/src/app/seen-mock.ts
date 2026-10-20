import { itemId, QUESTION_COLUMN, type Change, type ChangedPassage, type Proposal, type SeenMarks, type Thread } from "@owlit/protocol"
import { seedComments, seedFiles } from "@/features/docs/mocks/seed"
import { seedThreads } from "@/features/threads/mocks/seed"
import { WEB_OWLIT } from "@/lib/actors"
import { DAY, HOUR } from "@/lib/time"

// What the browser preview has instead of core's log and seen marks: the Library's tool-reading thread
// with two rows, a sentence and an answer read again in full that Owlit changed since the person looked,
// an answer of the venue thread read again in full, a paragraph Owlit wrote in Related work and its last
// comment there, and a note Owlit wrote whole

const now = Date.now()
const threads = seedThreads()
const reading = threads["reading-support-tools"]!
const venue = threads["uist-2026-papers"]!
const relatedWork = seedFiles.find((f) => f.path === "writing/Related work.md")!
const retrieval = relatedWork.content!.split("\n\n").find((p) => p.startsWith("Retrieval is the oldest"))!.trim()
const hunch = seedFiles.find((f) => f.path === "notes/Maybe retrieval and tool use are the same problem.md")!

let n = 0
const change = (at: number, target: Change["target"], extra: Partial<Change> = {}): Change => ({ id: `mock-${n++}`, at, actor: WEB_OWLIT, action: "update", target, origin: { via: "tool" }, ...extra })

// A cell Owlit answered again from the full text: the entry holds the cell on each side, as core's does
const reread = (thread: Thread, paper: string, column: string, at: number, was: string, from: "abstract" | "title") => {
  const cell = thread.rows.find((r) => r.id === paper)!.cells[column]!
  return change(at, { kind: "thread", path: thread.id, part: itemId.cell(paper, column) }, { before: { value: { text: was, depth: from, at: thread.createdAt } }, after: { value: { ...cell, at } } })
}

export const MOCK_CHANGES: Change[] = [
  ...reading.rows
    .filter((r) => r.addedAt > reading.createdAt)
    .map((r) => change(r.addedAt, { kind: "thread", path: reading.id, part: itemId.row(r.id) }, { action: "create", after: { value: r } })),
  change(now - 30 * 60_000, { kind: "thread", path: reading.id, part: itemId.memo("s3") }),
  reread(reading, "p15", QUESTION_COLUMN, now - 25 * 60_000, "Highlights a paper's objective, method and result sentences in different colours to guide skimming.", "abstract"),
  reread(venue, "u1", QUESTION_COLUMN, now - 3 * HOUR, "Seems to show citation context inline while reading.", "title"),
  change(now - 2 * HOUR, { kind: "doc", path: relatedWork.path }),
  change(hunch.createdAt, { kind: "doc", path: hunch.path }, { action: "create" }),
  ...(seedComments.d1 ?? [])
    .filter((c) => c.id === "n1")
    .map((c) => change(c.createdAt, { kind: "comment", path: relatedWork.path, part: c.id }, { action: "create" })),
].sort((a, b) => b.at - a.at)

// Every mock thread looked at once, before Owlit's latest changes; Related work last on screen before
// Owlit's paragraph
export const MOCK_MARKS: SeenMarks = {
  since: now - 30 * DAY,
  docs: { [relatedWork.path]: { hash: "mock", at: now - 3 * HOUR } },
  threads: Object.fromEntries(Object.values(threads).map((c) => [c.id, { [c.id]: c.createdAt + 60_000 }])),
  chats: {},
  comments: { [relatedWork.path]: now - 3 * DAY },
  digests: {},
}

export const MOCK_PASSAGES: Record<string, ChangedPassage[]> = { [relatedWork.path]: [{ text: retrieval, actor: WEB_OWLIT, at: now - 2 * HOUR }] }

// The same paragraph as the passage Owlit's edit landed, with the words either side as core gives them;
// the mock agent adds to this as it edits (chat/agent/mock-client.ts)
const at = relatedWork.content!.indexOf(retrieval)
export const MOCK_PROPOSALS: Record<string, Proposal[]> = {
  // A doc Owlit wrote whole: one line above it, no marks
  [hunch.path]: [{ id: "mock-made", at: hunch.createdAt, actor: WEB_OWLIT, hunks: [], whole: { also: [] } }],
  [relatedWork.path]: [{ id: "mock-proposal", at: now - 2 * HOUR, actor: WEB_OWLIT, hunks: [{ insert: retrieval, removed: "", before: relatedWork.content!.slice(at - 24, at), after: relatedWork.content!.slice(at + retrieval.length, at + retrieval.length + 24) }] }],
}
