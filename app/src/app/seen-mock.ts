import { itemId, type Absence, type Change, type ChangedPassage, type SeenMarks } from "@owlit/protocol"
import { seedComments, seedFiles } from "@/features/docs/mocks/seed"
import { seedThreads } from "@/features/threads/mocks/seed"
import { WEB_OWLIT } from "@/lib/actors"
import { DAY, HOUR } from "@/lib/time"

// What the browser preview has instead of core's log and seen marks: the person away four days, the
// Library's tool-reading thread with two rows and a sentence Owlit added since they looked, a paragraph
// Owlit wrote in Related work and its last comment there

const now = Date.now()
const threads = seedThreads()
const reading = threads["reading-support-tools"]!
const relatedWork = seedFiles.find((f) => f.path === "writing/Related work.md")!
const retrieval = relatedWork.content!.split("\n\n").find((p) => p.startsWith("Retrieval is the oldest"))!.trim()

let n = 0
const change = (at: number, target: Change["target"], extra: Partial<Change> = {}): Change => ({ id: `mock-${n++}`, at, actor: WEB_OWLIT, action: "update", target, origin: { via: "tool" }, ...extra })

export const MOCK_AWAY: Absence = { from: now - 4 * DAY, to: now }

export const MOCK_CHANGES: Change[] = [
  ...reading.rows
    .filter((r) => r.addedAt > reading.createdAt)
    .map((r) => change(r.addedAt, { kind: "thread", path: reading.id, part: itemId.row(r.id) }, { action: "create", after: { value: r } })),
  change(now - 30 * 60_000, { kind: "thread", path: reading.id, part: itemId.memo("s3") }),
  change(now - 2 * HOUR, { kind: "doc", path: relatedWork.path }),
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
