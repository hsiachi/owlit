import type { Line, Question, Ref, Topic, Verb } from "./types"

// A topic file, as Owlit writes it and Obsidian reads it:
//
//   ---
//   id: when-to-call
//   ---
//   # When to call a tool
//
//   One or two sentences of summary.
//
//   ## Understanding
//
//   - Schick 2023: Toolformer keeps a call only if … ^s1
//     - [§2](owlit://library/p6#passage=tf-filter) — Only for calls it generated itself.
//
//   ## Questions
//
//   - You: When should a model reach for a tool? ^q1
//     - [Proposal draft](owlit://docs/…) — From your proposal. Nothing answers it yet.
//
//   ## Sources
//
//   - 2026-10-03 · [ReAct](owlit://library/p7) · you read §3 and §4
//
// A line's one sub-bullet holds its sources, then " — " and a sentence: the condition of a line, or where a
// question stands. Anything else in the file is left alone by the parser and dropped on the next write.

const VERBS: Verb[] = ["wrote", "said", "reported", "rewrote", "found", "says", "thinks"]
const ITEM = new RegExp(`^- (.+?)(?: (${VERBS.join("|")}))?: (.*?)(?: \\^([a-z]+\\d+))?$`)
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g
const DASH = " — "

function parseRefs(s: string): Ref[] {
  return [...s.matchAll(LINK)].map((m) => ({ label: m[1], uri: m[2] }))
}

// "[a](x) · [b](y) — Sentence." → refs and the sentence
function parseSub(s: string): { refs: Ref[]; sentence?: string } {
  const at = s.indexOf(DASH)
  const head = at < 0 ? s : s.slice(0, at)
  const tail = at < 0 ? "" : s.slice(at + DASH.length).trim()
  const refs = parseRefs(head)
  // A sub-bullet with no links is all sentence
  if (!refs.length) return { refs, sentence: s.trim() || undefined }
  return { refs, sentence: tail || undefined }
}

const refText = (r: Ref) => `[${r.label}](${r.uri})`

function subLine(refs: Ref[], sentence?: string) {
  const head = refs.map(refText).join(" · ")
  if (head && sentence) return `${head}${DASH}${sentence}`
  return head || sentence || ""
}

export function parseTopic(path: string, content: string, updatedAt: number): Topic {
  const topic: Topic = { id: "", path, name: "", summary: "", questions: [], lines: [], sources: [], archived: false, updatedAt }
  let body = content
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  if (fm) {
    body = content.slice(fm[0].length)
    for (const row of fm[1].split("\n")) {
      const [k, ...v] = row.split(":")
      const value = v.join(":").trim()
      if (k.trim() === "id") topic.id = value
      if (k.trim() === "archived") topic.archived = value === "true"
    }
  }
  if (!topic.id) topic.id = path.replace(/^knowledge\//, "").replace(/\.md$/, "")

  let section: "summary" | "Understanding" | "Questions" | "Sources" | null = null
  const summary: string[] = []
  let last: { sources: Ref[]; set: (s?: string) => void } | null = null

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd()
    if (line.startsWith("# ")) {
      topic.name = line.slice(2).trim()
      section = "summary"
      continue
    }
    if (line.startsWith("## ")) {
      const h = line.slice(3).trim()
      section = h === "Understanding" || h === "Questions" || h === "Sources" ? h : null
      last = null
      continue
    }
    if (section === "summary") {
      if (line.trim()) summary.push(line.trim())
      continue
    }
    if (section === "Sources") {
      const m = /^- (.+?) · (\[[^\]]*\]\([^)]+\))(?: · (.*))?$/.exec(line)
      const ref = m && parseRefs(m[2])[0]
      if (m && ref) topic.sources.push({ date: m[1], ref, how: m[3] ?? "" })
      continue
    }
    if (section !== "Understanding" && section !== "Questions") continue
    // The sub-bullet under the item just read
    if (/^\s+- /.test(line) && last) {
      const { refs, sentence } = parseSub(line.replace(/^\s+- /, ""))
      last.sources.push(...refs)
      last.set(sentence)
      continue
    }
    const m = ITEM.exec(line)
    if (!m) continue
    const [, speaker, verb, text, id] = m
    if (section === "Understanding") {
      const l: Line = { id: id ?? `s${topic.lines.length + 1}`, speaker, text, sources: [] }
      if (verb) l.verb = verb as Verb
      topic.lines.push(l)
      last = { sources: l.sources, set: (s) => (l.condition = s) }
    } else {
      const q: Question = { id: id ?? `q${topic.questions.length + 1}`, text, sources: [] }
      topic.questions.push(q)
      last = { sources: q.sources, set: (s) => (q.status = s) }
    }
  }
  topic.summary = summary.join(" ")
  return topic
}

function item(speaker: string, verb: Verb | undefined, text: string, id: string, refs: Ref[], sentence?: string) {
  const head = `- ${speaker}${verb ? ` ${verb}` : ""}: ${text} ^${id}`
  const sub = subLine(refs, sentence)
  return sub ? `${head}\n  - ${sub}` : head
}

export function serializeTopic(t: Omit<Topic, "path" | "updatedAt">): string {
  const out = ["---", `id: ${t.id}`]
  if (t.archived) out.push("archived: true")
  out.push("---", `# ${t.name}`, "")
  if (t.summary) out.push(t.summary, "")
  if (t.lines.length) {
    out.push("## Understanding", "")
    for (const l of t.lines) out.push(item(l.speaker, l.verb, l.text, l.id, l.sources, l.condition))
    out.push("")
  }
  if (t.questions.length) {
    out.push("## Questions", "")
    for (const q of t.questions) out.push(item("You", undefined, q.text, q.id, q.sources, q.status))
    out.push("")
  }
  if (t.sources.length) {
    out.push("## Sources", "")
    for (const s of t.sources) out.push(`- ${s.date} · ${refText(s.ref)}${s.how ? ` · ${s.how}` : ""}`)
    out.push("")
  }
  return out.join("\n")
}

// ---- Reading a line ----

export const isYou = (l: Pick<Line, "speaker">) => l.speaker === "You"
export const isOwlit = (l: Pick<Line, "speaker">) => l.speaker === "Owlit"

// A paper line Owlit could not anchor to a passage: its only paper source is the abstract
export const isAbstractOnly = (l: Line) => !isYou(l) && !isOwlit(l) && l.sources.some((r) => r.uri.endsWith("#abstract")) && !l.sources.some((r) => r.uri.includes("#passage="))

// The opening words of a line, the way the change log and the chat name it: “Retrieval and tool use may…”
export function firstWords(text: string, n = 5) {
  const words = text.replace(/\s+/g, " ").trim().split(" ")
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ")
}

// The verb the line reads with, when the file doesn't name one
export function verbOf(l: Line): Verb {
  if (l.verb) return l.verb
  if (isOwlit(l)) return "thinks"
  if (isYou(l)) return l.sources[0]?.uri.startsWith("owlit://chat/") ? "said" : "wrote"
  return isAbstractOnly(l) ? "says" : "found"
}

// owlit://library/p6#passage=tf-filter → { paperId: "p6", passageId: "tf-filter" }
export function paperRef(uri: string): { paperId: string; passageId?: string; abstract?: boolean } | null {
  const m = /^owlit:\/\/library\/([^#/]+)(?:#(.*))?$/.exec(uri)
  if (!m) return null
  const frag = m[2] ?? ""
  if (frag === "abstract") return { paperId: m[1], abstract: true }
  const p = /^passage=(.+)$/.exec(frag)
  return { paperId: m[1], passageId: p?.[1] }
}

export const topicUri = (id: string, block?: string) => `owlit://knowledge/${encodeURIComponent(id)}${block ? `#^${block}` : ""}`

// A topic's file name follows its name
export const topicPath = (name: string) => `knowledge/${name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim()}.md`

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "topic"
  )
}

export const isoDay = (t: number) => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
