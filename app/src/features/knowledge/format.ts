import { plural, t } from "@lingui/core/macro"
import { intlLocale } from "@owlit/i18n"
import { isHiddenFromDocs, paperUri, parseOwlitUri, sameWords, type WorkspaceFile } from "@owlit/protocol"
import type { Change, Line, TopicSidecar, Verb } from "./types"

// Topic files are read and written by @owlit/protocol's parseTopic and serializeTopic, shared with core
export { parseTopic, serializeTopic, topicPath, topicSlug, topicUri } from "@owlit/protocol"

// Text as one line: runs of whitespace become one space, and none at the ends
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

// A line or question inside its topic: "when-to-call/s3"
export const lineKey = (topicId: string, lineId: string) => `${topicId}/${lineId}`

// What the person has left on a paper, as the Knowledge page and a paper's Knowledge tab both say it:
// "1 highlight, a note", "3 highlights", "a note"; "" when nothing. Inside a sentence ("You have 1 highlight
// and a note here") the two are joined with "and".
export function touchedWords(highlights: number, hasNote: boolean, { inSentence = false } = {}) {
  if (highlights > 0 && hasNote)
    return inSentence
      ? plural(highlights, { one: "# highlight and a note", other: "# highlights and a note" })
      : plural(highlights, { one: "# highlight, a note", other: "# highlights, a note" })
  if (highlights > 0) return plural(highlights, { one: "# highlight", other: "# highlights" })
  return hasNote ? t`a note` : ""
}

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

// The speaker as the page names it: "You" in the interface language, anyone else by the name the file gives
export const speakerName = (l: Pick<Line, "speaker">) => (isYou(l) ? t({ message: "You", comment: "the speaker of a topic's line: You wrote, You said" }) : l.speaker)

// A line's verb as the page says it after the speaker: "You wrote", "Schick 2023 found", "Owlit thinks".
// The file keeps the English verb.
export function verbWords(verb: Verb) {
  switch (verb) {
    case "wrote":
      return t({ message: "wrote", comment: "after a speaker in a topic: You wrote" })
    case "said":
      return t({ message: "said", comment: "after a speaker in a topic: You said (in a chat)" })
    case "reported":
      return t({ message: "reported", comment: "after a speaker in a topic: Schick 2023 reported" })
    case "rewrote":
      return t({ message: "rewrote", comment: "after a speaker in a topic: You rewrote (the line)" })
    case "found":
      return t({ message: "found", comment: "after a paper in a topic: Schick 2023 found" })
    case "says":
      return t({ message: "says", comment: "after a paper in a topic: Schick 2023 says (in its abstract)" })
    case "thinks":
      return t({ message: "thinks", comment: "after a speaker in a topic: Owlit thinks" })
  }
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

// ---- A change in the interface language ----

// The history keeps its words in English, as core and the app write them ("Added", "You rewrote it",
// "Renamed from “Drafts”"), and the code matches on them; they are said in the interface language only
// where they are shown. `after` is the form that follows a line's opening words in the change log
// ("“Retrieval and tool use may…” rewritten"). A change this doesn't know is shown as written.
export function changeWords(what: string, after = false): string {
  switch (what) {
    case "Added":
      return after ? t({ message: "added", comment: "after a line's opening words in a topic's change log" }) : t`Added`
    case "Rewritten":
      return after ? t({ message: "rewritten", comment: "after a line's opening words in a topic's change log" }) : t`Rewritten`
    case "Removed":
      return after ? t({ message: "removed", comment: "after a line's opening words in a topic's change log" }) : t`Removed`
    case "Speaker changed":
      return after ? t({ message: "speaker changed", comment: "after a line's opening words in a topic's change log" }) : t`Speaker changed`
    case "Source changed":
      return after ? t({ message: "source changed", comment: "after a line's opening words in a topic's change log" }) : t`Source changed`
    case "Question added":
      return after ? t({ message: "question added", comment: "after a question's opening words in a topic's change log" }) : t`Question added`
    case "Question updated":
      return after ? t({ message: "question updated", comment: "after a question's opening words in a topic's change log" }) : t`Question updated`
    case "Question removed":
      return after ? t({ message: "question removed", comment: "after a question's opening words in a topic's change log" }) : t`Question removed`
    case "You rewrote it":
      return after ? t({ message: "you rewrote it", comment: "after a line's opening words in a topic's change log" }) : t`You rewrote it`
    case "You removed it":
      return after ? t({ message: "you removed it", comment: "after a line's opening words in a topic's change log" }) : t`You removed it`
    case "You added a condition":
      return after ? t({ message: "you added a condition", comment: "after a line's opening words in a topic's change log" }) : t`You added a condition`
    case "Anchored to its passage":
      return after ? t({ message: "anchored to its passage", comment: "after a line's opening words in a topic's change log" }) : t`Anchored to its passage`
    case "Started":
    case "Topic started":
      return t({ message: "Started", comment: "a topic's first change: it started" })
    case "Summary rewritten":
      return t`Summary rewritten`
  }
  const named = /^(Renamed from|Merged in|Split from) “(.*)”$/.exec(what)
  if (named) {
    const name = named[2]
    if (named[1] === "Renamed from") return t`Renamed from “${name}”`
    if (named[1] === "Merged in") return t`Merged in “${name}”`
    return t`Split from “${name}”`
  }
  const moved = /^(\d+) lines? moved to “(.*)”$/.exec(what)
  if (moved) {
    const name = moved[2]
    return plural(Number(moved[1]), { one: `# line moved to “${name}”`, other: `# lines moved to “${name}”` })
  }
  return after ? what.charAt(0).toLowerCase() + what.slice(1) : what
}

// Why a change was made. Owlit's reasons are its own words and stay as written; the few the app writes for
// the user's own changes are said in the interface language.
export function whyWords(h: Pick<Change, "why">): string {
  switch (h.why) {
    case "edited on the topic page":
      return t`edited on the topic page`
    case "it won’t come back on an update":
      return t`it won’t come back on an update`
    case "you renamed it":
      return t`you renamed it`
    case "you merged the two topics":
      return t`you merged the two topics`
    case "you split the topic":
      return t`you split the topic`
    case "what you said in chat":
      return t`what you said in chat`
  }
  const highlighted = /^you highlighted it in (.+)$/.exec(h.why)
  if (highlighted) {
    const paper = highlighted[1]
    return t`you highlighted it in ${paper}`
  }
  return h.why
}

// Owlit's changes to a topic counted, as a run and Home's "Since you left" say them: "2 lines added, 1
// rewritten", "1 question added". The first count names what it counts; the rest follow it.
export function changeCounts(counts: [what: string, n: number][]) {
  const parts = counts.map(([what, n], i) => {
    const first = i === 0
    switch (what) {
      case "Added":
        return first ? plural(n, { one: "# line added", other: "# lines added" }) : plural(n, { one: "# added", other: "# added" })
      case "Rewritten":
        return first ? plural(n, { one: "# line rewritten", other: "# lines rewritten" }) : plural(n, { one: "# rewritten", other: "# rewritten" })
      case "Removed":
        return first ? plural(n, { one: "# line removed", other: "# lines removed" }) : plural(n, { one: "# removed", other: "# removed" })
      case "Source changed":
        return first ? plural(n, { one: "# line’s source changed", other: "# lines’ sources changed" }) : plural(n, { one: "# source changed", other: "# sources changed" })
      case "Speaker changed":
        return first ? plural(n, { one: "# line’s speaker changed", other: "# lines’ speakers changed" }) : plural(n, { one: "# speaker changed", other: "# speakers changed" })
      case "Anchored to its passage":
        return first ? plural(n, { one: "# line anchored to its passage", other: "# lines anchored to their passages" }) : plural(n, { one: "# anchored", other: "# anchored" })
      // A question's change counts questions, not lines
      case "Question added":
        return plural(n, { one: "# question added", other: "# questions added" })
      case "Question updated":
        return plural(n, { one: "# question updated", other: "# questions updated" })
      case "Question removed":
        return plural(n, { one: "# question removed", other: "# questions removed" })
    }
    // A change this doesn't know, as written
    return `${n} ${changeWords(what, true)}`
  })
  // "a, b, c" the interface language's way
  return new Intl.ListFormat(intlLocale(), { type: "conjunction", style: "narrow" }).format(parts)
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
