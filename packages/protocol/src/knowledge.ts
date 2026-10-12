// Knowledge: the topic files Owlit writes in `knowledge/` and what the user did to them, kept in
// `.owlit/knowledge/`. The window shows them and core checks what agents write, so both read topic files
// with the same parser.

// The parsed shapes. A topic is one Markdown file in the workspace's `knowledge/` folder, written by
// Owlit; what the user did to it (edits, removals, what they said) lives beside it in `.owlit/knowledge/`,
// where a rewrite can't touch it. These are the parsed shapes of both.

// A mention inside a line's sources, as written in the file: `[label](owlit://…)`
export interface Ref {
  label: string
  uri: string
}

// Who a line comes from and how. In the file the speaker opens the line ("You:", "Owlit:", "Schick 2023:");
// the verb is written only when it isn't the usual one ("You reported:", "You rewrote:").
export type Verb = "wrote" | "said" | "reported" | "rewrote" | "found" | "says" | "thinks"

export interface Line {
  // Obsidian block id, kept across rewrites: s1, s2…
  id: string
  speaker: string
  verb?: Verb
  text: string
  sources: Ref[]
  // When it holds, as a full sentence ("Only on HotpotQA and FEVER.")
  condition?: string
}

export interface Question {
  id: string
  // Always the user's own words
  text: string
  // One muted sentence on where it stands ("From your proposal. Schick 2023 partly answers it.")
  status?: string
  sources: Ref[]
}

// One row of Sources: when Owlit took something in, what, and how it was used
export interface SourceEntry {
  date: string
  ref: Ref
  how: string
}

export interface Topic {
  // From front matter, so a rename keeps the sidecar and every link
  id: string
  // Workspace-relative file path, "knowledge/When to call a tool.md"
  path: string
  name: string
  summary: string
  questions: Question[]
  lines: Line[]
  sources: SourceEntry[]
  archived: boolean
  // When Owlit last changed the file
  updatedAt: number
}

// ---- Sidecar: .owlit/knowledge/<topic id>.json ----

export interface Change {
  id: string
  at: number
  // The line or question it touched, if one
  lineId?: string
  // "Added", "Rewritten", "Removed"…, as the history shows it
  what: string
  // Why, in the user's terms ("you read Schick 2023 §Limitations")
  why: string
  by: "owlit" | "you"
  // The line before a rewrite, so the history can show it
  before?: string
}

// Something the user said about a line, in a chat or the ask bar
export interface Said {
  at: number
  text: string
  chatId?: string
}

export interface TopicSidecar {
  // Last time the user looked at the topic; lines Owlit changed after it carry the dot
  seenAt: number
  paused?: boolean
  history: Change[]
  // Lines the user rewrote, kept word for word on every run
  edits: Record<string, { text: string; at: number }>
  // Lines the user removed, never brought back
  removed: Record<string, { text: string; at: number }>
  said: Record<string, Said[]>
  // When Owlit last added or changed each line
  changedAt: Record<string, number>
}

// ---- A paper's connections: .owlit/knowledge/papers/<paper id>.json ----

// A passage of the paper, found again in the PDF by its words. `start` and `end` are short phrases that
// open and close it, since a long passage rarely survives the PDF's line breaks as one search.
export interface Passage {
  id: string
  // "§4", "Limitations", "abstract", "p. 5"
  section: string
  text: string
  start: string
  end: string
  // 0-based page where Owlit last found it, tried first
  page?: number
}

// What the user already has, that a passage of this paper relates to
export type Have =
  | { kind: "line"; topicId: string; lineId: string }
  | { kind: "question"; topicId: string; questionId: string }
  | { kind: "doc"; path: string; quote: string; at: number }

export type ConnectionKind = "challenges" | "backs" | "might"

export interface Connection {
  id: string
  kind: ConnectionKind
  have: Have
  // The sentence after the section link: "cuts against it: …"
  relation: string
  passageId: string
  createdAt: number
}

export interface PaperKnowledge {
  passages: Record<string, Passage>
  connections: Connection[]
  // Guesses the user said were not related
  dismissed: string[]
  // Last time the user had the Knowledge tab open on this paper
  seenAt: number
  // A line whose passage the user found and highlighted, waiting for Owlit to rewrite it from there
  found?: Record<string, { topicId: string; passageId: string }>
  // For an abstract-only line ("topic/line"), the passage Owlit thinks says the same thing in the body
  likely?: Record<string, string>
}

// ---- Topic files ----

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

export function parseRefs(s: string): Ref[] {
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

export const refText = (r: Ref) => `[${r.label}](${r.uri})`

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

export const KNOWLEDGE_DIR = "knowledge"

// A topic's file follows its name, made safe for a file name: "knowledge/When to call a tool.md"
export const topicPath = (name: string) => `${KNOWLEDGE_DIR}/${name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Topic"}.md`

// A topic's id, from its name: "when-to-call-a-tool"
export const topicSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "topic"

// ---- Runs ----

// The most recent run that changed something, for "Updated 3 min ago · 2 topics"
export interface KnowledgeRun {
  at: number
  items: { topicId: string; what: string }[]
  // knowledge/ as it was before the run (knowledge.revert)
  versionId?: string
}

// What an agent writes to a topic (owlit-mcp's knowledge_write). Core checks it against the rules and
// refuses with every problem it finds.
export interface KnowledgeWrite {
  // A topic's id, name or path; a name no topic has starts a new one
  topic: string
  // The whole topic file
  content: string
  // Why, in the user's terms ("you highlighted two passages of Lewis et al. 2020")
  why: string
  // Line or question ids removed on purpose
  remove?: string[]
  // Passages the content cites as owlit://library/<paper>#passage=<id>, quoted word for word
  passages?: { id: string; paper: string; quote: string; section?: string }[]
  chatId?: string
}

// knowledge/ as it was before a run, or before a revert
export interface KnowledgeVersion {
  id: string
  at: number
  reason: "run" | "revert"
  files: string[]
}

// A topic as knowledge_read lists it
export interface TopicSummary {
  id: string
  path: string
  name: string
  summary: string
  lines: number
  questions: number
  updatedAt: number
  paused: boolean
}
