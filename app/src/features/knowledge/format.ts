import { isHiddenFromDocs, paperUri, parseOwlitUri, sameWords, type WorkspaceFile } from "@owlit/protocol"
import { plural } from "@/lib/words"
import type { Change, Line, TopicSidecar, Verb } from "./types"

// Topic files are read and written by @owlit/protocol's parseTopic and serializeTopic, shared with core
export { parseTopic, serializeTopic, topicPath, topicSlug, topicUri } from "@owlit/protocol"

// Text as one line: runs of whitespace become one space, and none at the ends
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

// A line or question inside its topic: "when-to-call/s3"
export const lineKey = (topicId: string, lineId: string) => `${topicId}/${lineId}`

// What the person has left on a paper, as the Knowledge page and a paper's Knowledge tab both say it:
// "1 highlight, a note", "3 highlights", "a note"; "" when nothing
export const touchedWords = (highlights: number, hasNote: boolean) => [highlights > 0 && plural(highlights, "highlight"), hasNote && "a note"].filter(Boolean).join(", ")

// ---- Reading a line ----

export const isYou = (l: Pick<Line, "speaker">) => l.speaker === "You"
export const isOwlit = (l: Pick<Line, "speaker">) => l.speaker === "Owlit"

// A paper line Owlit could not anchor to a passage: its only paper source is the abstract
export const isAbstractOnly = (l: Line) => !isYou(l) && !isOwlit(l) && l.sources.some((r) => r.uri.endsWith("#abstract")) && !l.sources.some((r) => r.uri.includes("#passage="))

// The opening words of a line, the way the change log and the chat name it: “Retrieval and tool use may…”
export function firstWords(text: string, n = 5) {
  const words = oneLine(text).split(" ")
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ")
}

// The verb the line reads with, when the file doesn't name one
export function verbOf(l: Line): Verb {
  if (l.verb) return l.verb
  if (isOwlit(l)) return "thinks"
  if (isYou(l)) return l.sources[0] && parseOwlitUri(l.sources[0].uri)?.kind === "chat" ? "said" : "wrote"
  return isAbstractOnly(l) ? "says" : "found"
}

// The line as the person last saw it, before Owlit's rewrites since `since`, shown while the change is
// unseen. Given the line's words now, nothing is shown when they read the same: older histories recorded a
// change to a line's sources or condition as a rewrite, with the unchanged words as `before`.
export function wasBefore(lineId: string, side: TopicSidecar, since: number, now?: string) {
  const before = side.history.findLast((h) => h.lineId === lineId && h.at > since && h.by === "owlit" && h.before)?.before
  return before !== undefined && now !== undefined && sameWords(before, now) ? undefined : before
}

// How the history shows one change: its words, and the line before it only when the words differ from what
// the change left. `after` is the line's words right after the change (see wordsAfter). An old "Rewritten"
// whose words stayed the same changed the line's sources or condition.
export function shownChange(h: Change, after: string | undefined): { what: string; was?: string } {
  if (!h.before || after === undefined || !h.lineId || !sameWords(h.before, after)) return { what: h.what, was: h.before }
  return { what: h.what === "Rewritten" ? "Source changed" : h.what }
}

// Each change's line as it read right after the change, by change id: the words the next change to that
// line found, or the line as it is now. History is newest first.
export function wordsAfter(history: Change[], now: (lineId: string) => string | undefined) {
  const after = new Map<string, string | undefined>()
  const latest = new Map<string, string | undefined>()
  for (const h of history) {
    if (!h.lineId) continue
    const words = latest.has(h.lineId) ? latest.get(h.lineId) : now(h.lineId)
    after.set(h.id, words)
    // A question's change keeps its status, not its words, so only lines carry words back
    latest.set(h.lineId, h.before !== undefined && !h.what.startsWith("Question") ? h.before : words)
  }
  return after
}

// The change log's groups: changes Owlit made together, from one write or one run, share their reason and
// are shown under it once. Newest first, like the history; each group's changes in the order they were made.
export function changeGroups(history: Change[]): Change[][] {
  const groups: Change[][] = []
  for (const h of history) {
    const last = groups.at(-1)?.[0]
    if (last && h.by === "owlit" && last.by === "owlit" && h.why === last.why && shortDay(h.at) === shortDay(last.at)) groups.at(-1)!.push(h)
    else groups.push([h])
  }
  return groups.map((g) => g.reverse())
}

const shortDay = (t: number) => new Date(t).toDateString()

// ---- Lines named in prose ----

// Owlit may name a topic's lines by their block ids in what it writes (a question's status, a line's
// condition, why it changed): "(^s3, ^s6)". On screen each becomes a mention of that line; an id no line
// holds any more is left out, with its brackets when none in them are left.
export type ProsePart = string | { id: string }

const NAMED = /(\s*)\((\^[a-z]+\d+(?:\s*(?:,|;|and)\s*\^[a-z]+\d+)*)\)|(\s*)\^([a-z]+\d+)\b/g

export function namedLines(text: string, has: (id: string) => boolean): ProsePart[] {
  const out: ProsePart[] = []
  const put = (p: ProsePart) => {
    if (typeof p === "string" && typeof out.at(-1) === "string") out[out.length - 1] += p
    else if (p) out.push(p)
  }
  let from = 0
  for (const m of text.matchAll(NAMED)) {
    const [all, groupSpace, group, bareSpace, bare] = m
    put(text.slice(from, m.index))
    from = m.index + all.length
    const ids = (group ? [...group.matchAll(/\^([a-z]+\d+)/g)].map((x) => x[1]) : [bare]).filter(has)
    if (!ids.length) continue
    put(`${group ? groupSpace : bareSpace}${group ? "(" : ""}`)
    ids.forEach((id, i) => {
      if (i) put(", ")
      put({ id })
    })
    if (group) put(")")
  }
  put(text.slice(from))
  return out.filter((p) => p !== "")
}

// Whether Owlit added or rewrote the line since `seenBefore`; a line the user rewrote is theirs either way
export function freshness(lineId: string, side: TopicSidecar, seenBefore: number): "new" | "changed" | null {
  if ((side.changedAt[lineId] ?? 0) <= seenBefore || side.edits[lineId]) return null
  return side.history.some((h) => h.lineId === lineId && h.at > seenBefore && h.what !== "Added") ? "changed" : "new"
}

// owlit://library/p6#passage=tf-filter → { kind: "paper", id: "p6", passage: "tf-filter" }
export function paperRef(uri: string) {
  const u = parseOwlitUri(uri)
  return u?.kind === "paper" ? u : null
}

export const isoDay = (t: number) => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- Docs that cite papers ----

// A paper keeps the ids it had before it moved (a local file given its DOI); mentions under any of them count
export function withAliases(ids: string[], aliases: Record<string, string>) {
  const current = new Set(ids.map((id) => aliases[id] ?? id))
  return [...current, ...Object.keys(aliases).filter((old) => current.has(aliases[old]))]
}

// Where a doc first links to one of the papers or a passage of them, -1 if it doesn't. Kept per version of a
// file, so a save scans only the doc that changed.
const citedAt = new WeakMap<WorkspaceFile, Map<string, number>>()
function firstCitation(file: WorkspaceFile, uris: string[]) {
  const key = uris.join(" ")
  let known = citedAt.get(file)
  if (!known) citedAt.set(file, (known = new Map()))
  let at = known.get(key)
  if (at === undefined) {
    at = -1
    for (const uri of uris)
      for (const end of [")", "#"]) {
        const i = file.content!.indexOf(uri + end)
        if (i >= 0 && (at < 0 || i < at)) at = i
      }
    known.set(key, at)
  }
  return at
}

// The docs citing any of the papers, newest first, each with the heading its first citation sits under:
// "Related work"
export function citingDocs(files: Record<string, WorkspaceFile>, paperIds: string[]) {
  const uris = paperIds.map((id) => paperUri(id))
  return Object.values(files)
    .flatMap((file) => {
      if (!file.content || isHiddenFromDocs(file.path)) return []
      const at = firstCitation(file, uris)
      if (at < 0) return []
      return [{ file, heading: [...file.content.slice(0, at).matchAll(/^#{2,}\s+(.+)$/gm)].at(-1)?.[1] }]
    })
    .sort((a, b) => b.file.modifiedAt - a.file.modifiedAt)
}
