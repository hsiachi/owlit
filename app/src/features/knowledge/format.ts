import { isHiddenFromDocs, paperUri, parseOwlitUri, type WorkspaceFile } from "@owlit/protocol"
import { plural } from "@/lib/words"
import type { Line, TopicSidecar, Verb } from "./types"

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

// The line before Owlit's latest rewrite since `since`, shown while the change is unseen
export const wasBefore = (lineId: string, side: TopicSidecar, since: number) =>
  side.history.find((h) => h.lineId === lineId && h.at > since && h.by === "owlit" && h.before)?.before

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
