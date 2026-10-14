import { parseTopic, type Line, type Passage, type Question, type Topic, type TopicSidecar } from "@owlit/protocol"

// What core holds an agent's topic write to: the parts of Knowledge's rules (the prompt in knowledge.ts)
// that a program can check. A write that breaks one is refused with every problem in a sentence the agent
// can act on; the judgement calls (what counts as the user's view, when to open a topic) stay in the prompt.

export const LIMITS = { summarySentences: 2, lines: 7, lineWords: 30, questions: 5 }

export interface TopicWrite {
  // The topic as it is now; null for a new one
  before: Topic | null
  // What the agent wants the file to say
  content: string
  sidecar: TopicSidecar
  // Ids the agent removes on purpose
  remove: string[]
  // Passage ids each paper can be cited at (known before plus given with this write), by paper id
  passages: Record<string, Set<string>>
}

export interface CheckedTopic {
  topic: Omit<Topic, "path" | "updatedAt">
  problems: string[]
}

const ITEM_START = /^- \S/
const SUB = /^\s+- /
const ID_AT_END = / \^([a-z]+\d+)$/
const SHORT_CITE = /^\p{Lu}[\p{L}'’-]+(?: (?:and|&) \p{Lu}[\p{L}'’-]+| et al\.)? \d{4}[a-z]?$/u

export const isPaperVoice = (speaker: string) => speaker !== "You" && speaker !== "Owlit"

// Words, the way the 30-word cap counts them: a Chinese or Japanese character is half a word
export function countWords(text: string) {
  const han = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const rest = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ")
  const words = rest.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.length ?? 0
  return words + Math.ceil(han / 2)
}

const ABBREVIATIONS = /(?:\b(?:al|e\.g|i\.e|vs|cf|Fig|Figs|Eq|Sec|Tab|No|approx|resp)|\b\p{Lu})\.$/u

export function countSentences(text: string) {
  let n = 0
  let start = 0
  const t = text.trim()
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if ("。！？".includes(c)) {
      n++
      start = i + 1
      continue
    }
    if (!".!?".includes(c)) continue
    const next = t[i + 1]
    if (next !== undefined && !/\s/.test(next)) continue
    if (c === "." && ABBREVIATIONS.test(t.slice(start, i + 1))) continue
    n++
    start = i + 1
  }
  return n + (t.slice(start).trim() ? 1 : 0)
}

const opening = (text: string) => {
  const words = text.trim().split(/\s+/)
  return `“${words.slice(0, 6).join(" ")}${words.length > 6 ? "…" : ""}”`
}

const normal = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

// The section each raw line of the file sits in, for finding lines the parser would drop
function strayLines(content: string) {
  const stray: { section: string; text: string; notYou?: boolean }[] = []
  let section = ""
  let afterItem = false
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "")
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd()
    if (line.startsWith("# ")) section = "summary"
    else if (line.startsWith("## ")) {
      section = line.slice(3).trim()
      afterItem = false
    } else if (section === "Understanding" || section === "Questions") {
      if (!line.trim()) continue
      if (SUB.test(line) && afterItem) continue
      if (ITEM_START.test(line) && /^- [^:]+?: \S/.test(line)) {
        afterItem = true
        if (section === "Questions" && !line.startsWith("- You: ")) stray.push({ section, text: line.trim(), notYou: true })
        continue
      }
      stray.push({ section, text: line.trim() })
    }
  }
  return stray
}

// Ids written in the file, so a line without one gets a fresh id rather than the parser's s<n>
function writtenIds(content: string) {
  const ids = new Set<string>()
  for (const raw of content.split("\n")) {
    const m = ITEM_START.test(raw) ? ID_AT_END.exec(raw.trimEnd()) : null
    if (m) ids.add(m[1])
  }
  return ids
}

function freshId(prefix: string, used: Set<string>) {
  let n = 1
  while (used.has(`${prefix}${n}`)) n++
  used.add(`${prefix}${n}`)
  return `${prefix}${n}`
}

export function checkTopic(write: TopicWrite): CheckedTopic {
  const { before, sidecar } = write
  const parsed = parseTopic("", write.content, 0)
  const problems: string[] = []
  if (!parsed.name) problems.push("The topic needs a name: start the file with “# Name”.")
  for (const s of strayLines(write.content))
    problems.push(
      s.notYou
        ? `Questions are only the user's own words, written “- You: …”: ${opening(s.text.replace(/^- /, ""))}.`
        : `${s.section} has a line that isn't “Speaker: one sentence ^id”: ${opening(s.text)}. Every line starts with who says it.`,
    )

  // Ids: what the file wrote, fresh ones for lines without, never one a line had before it was removed
  const written = writtenIds(write.content)
  const retired = new Set([...Object.keys(sidecar.removed), ...sidecar.history.flatMap((h) => (h.lineId ? [h.lineId] : []))])
  for (const l of before?.lines ?? []) retired.delete(l.id)
  for (const q of before?.questions ?? []) retired.delete(q.id)
  // Nor one a line had that this write removes
  const used = new Set([...written, ...retired, ...(before?.lines ?? []).map((l) => l.id), ...(before?.questions ?? []).map((q) => q.id)])
  // Whether this item's own line wrote its id: a line without one is given s<n> by the parser, which may
  // be an id another line wrote
  const raw = write.content.split("\n").map((l) => l.trimEnd())
  const wroteId = (item: Line | Question) => written.has(item.id) && raw.some((l) => ITEM_START.test(l) && l.endsWith(` ^${item.id}`) && l.includes(item.text))
  const assign = <T extends Line | Question>(items: T[], prefix: string) => {
    const seen = new Set<string>()
    for (const item of items) {
      if (!wroteId(item) || seen.has(item.id)) {
        if (seen.has(item.id)) problems.push(`^${item.id} is on two lines; each line keeps its own id.`)
        item.id = freshId(prefix, used)
      } else if (retired.has(item.id)) problems.push(`^${item.id} belonged to a line that was removed; give the new line a new id (or none, and owlit picks one).`)
      seen.add(item.id)
    }
  }
  assign(parsed.lines, "s")
  assign(parsed.questions, "q")

  // Caps
  const sentences = countSentences(parsed.summary)
  if (sentences > LIMITS.summarySentences) problems.push(`The summary has ${sentences} sentences; at most ${LIMITS.summarySentences}.`)
  if (parsed.lines.length > LIMITS.lines)
    problems.push(`Understanding has ${parsed.lines.length} lines; at most ${LIMITS.lines}, so ${parsed.lines.length - LIMITS.lines} too many. Merge lines, or say in your answer that the topic should be split.`)
  if (parsed.questions.length > LIMITS.questions) problems.push(`Questions has ${parsed.questions.length} entries; at most ${LIMITS.questions}.`)
  for (const l of parsed.lines) {
    const words = countWords(l.text)
    if (words > LIMITS.lineWords) problems.push(`^${l.id} has ${words} words; at most ${LIMITS.lineWords}.`)
  }

  // Speakers, and a passage for every paper's voice
  for (const l of parsed.lines) {
    if (isPaperVoice(l.speaker) && !SHORT_CITE.test(l.speaker))
      problems.push(`“${l.speaker}” isn't a speaker. A line is said by You, Owlit, or a paper by its short cite (“Chen 2025”, “Lewis et al. 2020”).`)
    if (!isPaperVoice(l.speaker)) continue
    const anchored = l.sources.some((r) => {
      const m = /^owlit:\/\/library\/([^#/]+)#(.+)$/.exec(r.uri)
      if (!m) return false
      if (m[2] === "abstract") return true
      const passage = /^passage=(.+)$/.exec(m[2])?.[1]
      return !!passage && !!write.passages[m[1]]?.has(passage)
    })
    if (!anchored)
      problems.push(`^${l.id} speaks for ${l.speaker} without a passage: cite owlit://library/<id>#passage=<name> and give that passage's quote in passages (or #abstract when only the abstract says it).`)
  }

  // What the user did to lines
  const next = new Map(parsed.lines.map((l) => [l.id, l]))
  for (const [id, edit] of Object.entries(sidecar.edits)) {
    if (!before?.lines.some((l) => l.id === id)) continue
    const l = next.get(id)
    if (!l) problems.push(`^${id} is the user's own wording and can't be removed: keep it as “${edit.text}”.`)
    else if (l.text !== edit.text || l.speaker !== "You") problems.push(`^${id} is the user's own wording: keep it word for word, as “You${l.verb ? ` ${l.verb}` : ""}: ${edit.text}”.`)
  }
  // A You line is the user speaking: their voice, never addressed to them
  for (const l of parsed.lines)
    if (l.speaker === "You" && !sidecar.edits[l.id] && /\byours?\b|你的|您的/i.test(l.text))
      problems.push(`^${l.id} is the user speaking, so it is in their voice, first person ("I", "my draft"), not "your": ${opening(l.text)}.`)
  const removedTexts = new Set(Object.values(sidecar.removed).map((r) => normal(r.text)))
  for (const l of parsed.lines) if (removedTexts.has(normal(l.text))) problems.push(`The user removed ${opening(l.text)}; don't bring it back.`)

  // Lines that are gone must be named in remove
  const remove = new Set(write.remove)
  for (const l of before?.lines ?? [])
    if (!next.has(l.id) && !remove.has(l.id) && !sidecar.edits[l.id]) problems.push(`^${l.id} (${opening(l.text)}) is gone. Keep it, or name it in remove and say why.`)
  const nextQuestions = new Set(parsed.questions.map((q) => q.id))
  for (const q of before?.questions ?? [])
    if (!nextQuestions.has(q.id) && !remove.has(q.id)) problems.push(`Question ^${q.id} (${opening(q.text)}) is gone. Keep it, or name it in remove and say why.`)

  const { path: _path, updatedAt: _updated, ...topic } = parsed
  return { topic, problems }
}

// Where a quote sits in a paper's text.md: its 1-based page, or null when the words aren't there. Line
// breaks, hyphenation at a break and spacing don't count.
export function findQuote(textMd: string, quote: string): number | null {
  const squash = (s: string) => s.toLowerCase().replace(/-\s*\n\s*/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const want = squash(quote)
  if (!want) return null
  const pages: { page: number; text: string }[] = []
  let page = 1
  for (const chunk of textMd.split(/(<!-- page \d+ -->)/)) {
    const marker = /^<!-- page (\d+) -->$/.exec(chunk)
    if (marker) page = Number(marker[1])
    else if (squash(chunk)) pages.push({ page, text: squash(chunk) })
  }
  const on = pages.find((p) => p.text.includes(want))
  if (on) return on.page
  // Across a page break: the page it starts on
  return pages.find((p, i) => i + 1 < pages.length && `${p.text} ${pages[i + 1]!.text}`.includes(want))?.page ?? null
}

// A passage record for the reader: found again by a phrase that opens it and one that closes it
export function passageOf(id: string, quote: string, page: number, section?: string): Passage {
  const words = quote.trim().split(/\s+/)
  const n = Math.min(8, words.length)
  return { id, section: section ?? `p. ${page}`, text: quote.trim(), start: words.slice(0, n).join(" "), end: words.slice(-n).join(" "), page: page - 1 }
}
