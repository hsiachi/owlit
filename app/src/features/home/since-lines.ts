import { threadDot, type ActorId, type Change, type PersonId, type ThreadRow } from "@owlit/protocol"

// One line of "Since you left": what someone else changed in one place, with the things it names
export type SinceLine =
  // A thread: made meanwhile, or the papers added to it (their titles) and how many of its other answers
  // and sentences changed
  | { kind: "thread"; key: string; id: string; made: boolean; added: string[]; changed: number; at: number }
  // Papers added to the Library, not as a thread's rows
  | { kind: "papers"; key: string; ids: string[]; at: number }
  | { kind: "doc"; key: string; path: string; actor: ActorId; did: "made" | "edited" | "removed"; at: number }
  // New comments on a doc, by whoever left the latest
  | { kind: "comments"; key: string; path: string; actor: ActorId; count: number; at: number }

// The log's entries (newest first) by anyone but me as one line per place, latest first. The person's own
// changes are never listed, nor what isn't a place to open (a paper's tags, a memory line).
export function sinceLines(changes: Change[], me: PersonId): SinceLine[] {
  const threads = new Map<string, Extract<SinceLine, { kind: "thread" }>>()
  const docs = new Map<string, Extract<SinceLine, { kind: "doc" }>>()
  const comments = new Map<string, Extract<SinceLine, { kind: "comments" }>>()
  // Paper ids with when each came, newest first
  const papers: [string, number][] = []
  const inThreads = new Set<string>()
  for (const c of changes) {
    if (c.actor === me) continue
    const { kind, path, part = "" } = c.target
    if (kind === "thread") {
      const line = threads.get(path) ?? { kind: "thread", key: `thread:${path}`, id: path, made: false, added: [], changed: 0, at: c.at }
      threads.set(path, line)
      if (!part) line.made ||= c.action === "create"
      else if (part.startsWith("row:") && c.action === "create") {
        const row = (c.after as { value?: ThreadRow } | undefined)?.value
        inThreads.add(part.slice(4))
        if (row) line.added.push(row.paper.title)
      } else if (threadDot(c)) line.changed++
    } else if (kind === "doc") {
      const line = docs.get(path)
      if (!line) docs.set(path, { kind: "doc", key: `doc:${path}`, path, actor: c.actor, did: c.action === "delete" ? "removed" : c.action === "create" ? "made" : "edited", at: c.until ?? c.at })
      else if (c.action === "create" && line.did === "edited") line.did = "made"
    } else if (kind === "comment" && c.action === "create" && !part.includes("/")) {
      const line = comments.get(path)
      if (line) line.count++
      else comments.set(path, { kind: "comments", key: `comments:${path}`, path, actor: c.actor, count: 1, at: c.at })
    } else if (kind === "paper" && c.action === "create" && !part) {
      papers.push([path, c.at])
    }
  }
  const lines: SinceLine[] = [...[...threads.values()].filter((l) => l.made || l.added.length || l.changed), ...docs.values(), ...comments.values()]
  const alone = papers.filter(([id]) => !inThreads.has(id))
  if (alone.length) lines.push({ kind: "papers", key: "papers", ids: alone.map(([id]) => id), at: alone[0]![1] })
  return lines.sort((a, b) => b.at - a.at)
}
