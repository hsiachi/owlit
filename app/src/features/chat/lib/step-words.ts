import { baseName } from "@owlit/protocol"
import type { MessagePart, ToolCall } from "../types"
import { OWLIT_TOOLS, owlitToolOf, toolTitle } from "./tool-title"
import { capital, joinAnd, plural } from "@/lib/words"

// How a step of an answer is put in words: what it is doing while it runs, what it did once done, and what
// kind of work it is, so a block of steps can say in one sentence what happened ("Read 3 files and
// searched the web twice"). Steps are named by the agent's own tool and inputs when it says them (Claude
// Code does); otherwise by the title it gave, read as plainly as it allows.

export type { ToolCall }
export { owlitToolOf }

export interface StepWords {
  // While it runs or waits, in the agent's words ("Read the lit check")
  now: string
  // Once it ran ("Read the lit check", "Searched the web for “x”")
  done: string
  // What kind of work, for the block's sentence and for folding neighbours together
  group: string
  // Housekeeping of the agent's that says nothing to the user (loading its tools, its to-do list)
  hidden?: boolean
}

// ---- Verbs ----

const PAST: Record<string, string> = {
  add: "added", analyse: "analysed", analyze: "analyzed", ask: "asked", browse: "browsed", build: "built", calculate: "calculated",
  capture: "captured", change: "changed", check: "checked", clean: "cleaned", clone: "cloned", collect: "collected", commit: "committed",
  compare: "compared", compute: "computed", confirm: "confirmed", convert: "converted", copy: "copied", count: "counted", create: "created",
  delete: "deleted", describe: "described", diff: "diffed", download: "downloaded", draft: "drafted", edit: "edited", examine: "examined",
  explain: "explained", explore: "explored", extract: "extracted", fetch: "fetched", filter: "filtered", find: "found", fix: "fixed",
  follow: "followed", format: "formatted", gather: "gathered", generate: "generated", get: "got", grep: "grepped", highlight: "highlighted",
  identify: "identified", inspect: "inspected", install: "installed", investigate: "investigated", leave: "left", list: "listed",
  load: "loaded", locate: "located", look: "looked", make: "made", mark: "marked", measure: "measured", merge: "merged", move: "moved",
  note: "noted", open: "opened", parse: "parsed", peek: "peeked", preview: "previewed", print: "printed", pull: "pulled", push: "pushed",
  query: "queried", read: "read", record: "recorded", remove: "removed", rename: "renamed", reread: "reread", resolve: "resolved",
  retry: "retried", review: "reviewed", run: "ran", save: "saved", scan: "scanned", search: "searched", see: "saw", set: "set",
  show: "showed", skim: "skimmed", sort: "sorted", start: "started", stop: "stopped", summarise: "summarised", summarize: "summarized",
  take: "took", test: "tested", think: "thought", try: "tried", update: "updated", use: "used", verify: "verified", view: "viewed",
  wait: "waited", watch: "watched", write: "wrote",
}
// The same verbs as they appear running ("Reading …") or in the third person ("Lists …")
const ING: Record<string, string> = Object.fromEntries(
  Object.keys(PAST).map((v) => [v.endsWith("e") && !v.endsWith("ee") ? `${v.slice(0, -1)}ing` : /^(run|get|set|stop|skim|scan|grep|diff|commit)$/.test(v) ? `${v}${v.at(-1)}ing` : `${v}ing`, v]),
)

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// The sentence with its first verb in the past tense; unchanged when the first word isn't a verb owlit knows
export function pastTense(sentence: string) {
  const m = /^(\S+)(.*)$/s.exec(sentence.trim())
  if (!m) return sentence
  const word = m[1].toLowerCase()
  const base = PAST[word] ? word : ING[word] ? ING[word] : word.endsWith("s") && PAST[word.slice(0, -1)] ? word.slice(0, -1) : word.endsWith("es") && PAST[word.slice(0, -2)] ? word.slice(0, -2) : null
  if (!base) return sentence
  const past = PAST[base]
  return (m[1][0] === m[1][0].toUpperCase() ? capital(past) : past) + m[2]
}

// ---- Things a step names ----

// A file's name, from a path that may end in a slash
export const fileName = (p: string) => baseName(p.replace(/\/+$/, "")) || p

// The file a step works on
export const pathOf = (call: ToolCall) => call.tool?.path ?? call.diff?.path ?? call.locations?.[0]?.path

// The page a fetch opens: the agent's own input, else the address its title starts with ("Fetch https://…")
export const fetchUrlOf = (call: ToolCall) => call.tool?.url ?? /^Fetch (\S+)/.exec(call.title)?.[1]

// A shell command, which shows as the command line itself (the step's sentence is its description)
export const runsCommand = (call: ToolCall) => call.tool?.name === "Bash" || (!call.tool && call.kind === "execute")

// A web address as people read it: the site and its path, without the scheme or a trailing slash
export function shortUrl(url: string) {
  try {
    const u = new URL(url)
    const rest = `${u.pathname}${u.search}`.replace(/\/$/, "")
    return `${u.host.replace(/^www\./, "")}${rest}`
  } catch {
    return url
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 80)}…` : s}”`

// The title a fetched page gave, when the agent's summary of it says ("**Title:** …", or a first heading)
export function pageTitle(content?: string) {
  if (!content) return undefined
  const m = /\*\*Title:\*\*\s*(.+)/.exec(content) ?? /^#\s+(.+)/m.exec(content)
  return m?.[1].trim().replace(/\*+/g, "") || undefined
}

// Words for the tool's own name, for an agent's MCP tool owlit has no words for ("snippet_search" → "Snippet search")
const words = (name: string) => capital(name.replace(/[_-]+/g, " ").trim())

// Another server's MCP tool, by Claude Code (mcp__server__tool) or Codex (mcp.server.tool)
function mcpWords(name: string): StepWords | undefined {
  const m = /^mcp(?:__|\.)([^_.]+(?:_[^_.]+)*?)(?:__|\.)(\w+)$/.exec(name)
  if (!m) return undefined
  const server = m[1].replace(/^claude_ai_/, "").replace(/_/g, " ")
  return { now: `Use ${server}: ${lower(words(m[2]))}`, done: `Used ${server}: ${lower(words(m[2]))}`, group: `mcp:${server}` }
}

// SubagentHandback is how an agent the step handed work to gives its report back; the report reaches the
// user through Owlit's answer, and the step itself only says "Report delivered"
const HIDDEN = new Set(["ToolSearch", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "SubagentHandback"])

// ---- One step ----

// `questions`: how many questions the step asked the user, when it asked some
export function stepWords(call: ToolCall, questions = 1): StepWords {
  const tool = call.tool
  const name = tool?.name
  const path = pathOf(call)

  if (name && HIDDEN.has(name)) return { now: name, done: name, group: "hidden", hidden: true }

  const owlit = owlitToolOf(name ?? call.title)
  if (owlit) {
    const now = OWLIT_TOOLS[owlit] ?? words(owlit)
    return { now, done: pastTense(now), group: `owlit:${owlit}` }
  }
  const mcp = name ? mcpWords(name) : undefined
  if (mcp) return mcp

  switch (name) {
    case "Bash":
    case "BashOutput": {
      const d = tool?.description
      return d ? { now: capital(d), done: capital(pastTense(d)), group: "command" } : { now: "Run a command", done: "Ran a command", group: "command" }
    }
    case "Read":
      return { now: `Read ${fileName(path ?? "a file")}`, done: `Read ${fileName(path ?? "a file")}`, group: "read" }
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { now: `Edit ${fileName(path ?? "a file")}`, done: `Edited ${fileName(path ?? "a file")}`, group: "edit" }
    case "Write":
      return { now: `Write ${fileName(path ?? "a file")}`, done: `Wrote ${fileName(path ?? "a file")}`, group: "write" }
    case "Glob":
      return tool?.pattern
        ? { now: `Look for files matching ${quote(tool.pattern)}`, done: `Looked for files matching ${quote(tool.pattern)}`, group: "find" }
        : { now: "Look for files", done: "Looked for files", group: "find" }
    case "Grep":
      return tool?.pattern
        ? { now: `Search files for ${quote(tool.pattern)}`, done: `Searched files for ${quote(tool.pattern)}`, group: "grep" }
        : { now: "Search files", done: "Searched files", group: "grep" }
    case "WebSearch":
      return tool?.query
        ? { now: `Search the web for ${quote(tool.query)}`, done: `Searched the web for ${quote(tool.query)}`, group: "web" }
        : { now: "Search the web", done: "Searched the web", group: "web" }
    case "WebFetch": {
      const where = tool?.url ? shortUrl(tool.url) : "a page"
      const title = pageTitle(call.content)
      return { now: `Open ${where}`, done: title ? `Opened “${title}”` : `Opened ${where}`, group: "fetch" }
    }
    case "Agent":
    case "Task": {
      const d = tool?.description
      return d ? { now: capital(d), done: capital(pastTense(d)), group: "agent" } : { now: "Hand a task to an agent", done: "Handed a task to an agent", group: "agent" }
    }
    case "AskUserQuestion":
      return questions > 1
        ? { now: `Ask you ${questions} questions`, done: `Asked you ${questions} questions`, group: "question" }
        : { now: "Ask you a question", done: "Asked you a question", group: "question" }
  }
  return fromTitle(call)
}

// A step whose agent didn't name its tool: read the title as the agent wrote it
function fromTitle(call: ToolCall): StepWords {
  const title = call.title.trim()
  let m: RegExpExecArray | null
  if (call.kind === "execute") return { now: "Run a command", done: "Ran a command", group: "command" }
  if ((m = /^Read (.+)$/.exec(title)) && call.kind === "read") return { now: `Read ${fileName(m[1].replace(/ \(.*\)$/, ""))}`, done: `Read ${fileName(m[1].replace(/ \(.*\)$/, ""))}`, group: "read" }
  if ((m = /^Edit (.+)$/.exec(title))) return { now: `Edit ${fileName(m[1])}`, done: `Edited ${fileName(m[1])}`, group: "edit" }
  if ((m = /^Write (.+)$/.exec(title))) return { now: `Write ${fileName(m[1])}`, done: `Wrote ${fileName(m[1])}`, group: "write" }
  if ((m = /^Fetch (\S+)/.exec(title))) {
    const page = pageTitle(call.content)
    return { now: `Open ${shortUrl(m[1])}`, done: page ? `Opened “${page}”` : `Opened ${shortUrl(m[1])}`, group: "fetch" }
  }
  if ((m = /^Search "(.*)"$/s.exec(title))) return { now: `Search the web for ${quote(m[1])}`, done: `Searched the web for ${quote(m[1])}`, group: "web" }
  const mcp = mcpWords(title)
  if (mcp) return mcp
  if (title === "ToolSearch") return { now: title, done: title, group: "hidden", hidden: true }
  const now = toolTitle(title)
  return { now, done: pastTense(now), group: call.kind === "read" ? "read" : call.kind === "fetch" ? "fetch" : "other" }
}

// What kind of work a step is ("web", "fetch", "owlit:library_add"), as its words group it
export const stepGroup = (call: ToolCall) => stepWords(call).group

// ---- A block of steps ----

// [one, several]; "#" stands for the count
const GROUPS: Record<string, [string, string]> = {
  command: ["ran a command", "ran # commands"],
  read: ["read a file", "read # files"],
  edit: ["edited a file", "edited # files"],
  write: ["wrote a file", "wrote # files"],
  find: ["looked for files", "looked for files # times"],
  grep: ["searched files", "searched files # times"],
  web: ["searched the web", "searched the web # times"],
  fetch: ["opened a page", "opened # pages"],
  agent: ["handed a task to a helper", "handed # tasks to helpers"],
  question: ["asked you a question", "asked you # questions"],
  other: ["used a tool", "used # tools"],
  "owlit:library_list": ["listed your Library", "listed your Library # times"],
  "owlit:library_get": ["looked up a paper", "looked up # papers"],
  "owlit:library_read": ["read a paper", "read # papers"],
  "owlit:library_highlights": ["read your highlights", "read your highlights # times"],
  "owlit:library_search": ["searched for papers", "searched for papers # times"],
  "owlit:library_related": ["followed a paper's citations", "followed a paper's citations # times"],
  "owlit:library_journal": ["listed a journal's papers", "listed a journal's papers # times"],
  "owlit:library_add": ["added papers to your Library", "added papers # times"],
  "owlit:library_remove": ["removed papers from your Library", "removed papers # times"],
  "owlit:library_write_digest": ["wrote a reading summary", "wrote # reading summaries"],
  "owlit:docs_list": ["listed your docs", "listed your docs # times"],
  "owlit:docs_read": ["read a doc", "read # docs"],
  "owlit:docs_add_note": ["left a note on a doc", "left # notes on docs"],
  "owlit:docs_move": ["moved a doc", "moved # docs"],
  "owlit:chats_read": ["read a chat", "read # chats"],
  "owlit:ui_jump": ["showed a passage", "showed # passages"],
  "owlit:ui_mark": ["highlighted a passage", "highlighted # passages"],
}
const LIVE: Record<string, string> = {
  command: "Running commands",
  read: "Reading files",
  edit: "Editing",
  write: "Writing",
  find: "Looking for files",
  grep: "Searching files",
  web: "Searching the web",
  fetch: "Opening pages",
  agent: "Working with a helper",
  "owlit:library_search": "Searching for papers",
  "owlit:library_related": "Following citations",
  "owlit:library_journal": "Listing a journal's papers",
  "owlit:library_read": "Reading papers",
  "owlit:docs_read": "Reading docs",
}

const count = (n: number) => (n === 2 ? "twice" : `${n} times`)

// Groups whose phrase counts files ("edited 3 files"), so a file worked on twice is counted once
const FILE_GROUPS = new Set(["read", "edit", "write"])

// What a group of n steps did, in a lower-case phrase ("read 3 files"); `one` is the step itself when alone
export function groupPhrase(group: string, n: number, one?: string) {
  if (n === 1 && one) return lower(one)
  const forms = GROUPS[group]
  if (forms) return n === 1 ? forms[0] : forms[1].replace("# times", count(n)).replace("#", String(n))
  if (group.startsWith("mcp:")) return n === 1 ? `used ${group.slice(4)}` : `used ${group.slice(4)} ${count(n)}`
  return n === 1 ? "used a tool" : `used ${n} tools`
}

// A step with its words, worked out once for a block
export interface WordedStep {
  call: ToolCall
  words: StepWords
}

// The sentence a finished block folds into: its one step, or up to three kinds of work in the order they
// came ("Listed your Library, searched the web twice and opened 3 pages"), or "Took 12 steps"
export function blockSentence(steps: WordedStep[]) {
  const shown = steps.map(({ call, words }) => ({ c: call, w: words })).filter((x) => !x.w.hidden)
  if (shown.length === 0) return "Thought"
  // A step that didn't run to the end is said as it was asked ("Edit notes.md"); its row says what happened
  const said = (x: (typeof shown)[number]) => (x.c.status === "completed" ? x.w.done : x.w.now)
  if (shown.length === 1) return said(shown[0])
  // An edit that didn't happen isn't counted as one; the count after the sentence says so
  const counted = shown.filter((x) => x.c.status === "completed" || !["edit", "write"].includes(x.w.group))
  if (counted.length === 0) return said(shown[0])
  if (counted.length === 1) return said(counted[0])
  // Steps on files count the files, not the steps: two edits of draft.md are "Read and edited draft.md",
  // not "Read draft.md and edited 2 files". A step that names no file ("a file") counts as its own.
  const groups = new Map<string, { n: number; one: string; seen: Set<string> }>()
  for (const { w } of counted) {
    const g = groups.get(w.group)
    if (!g) groups.set(w.group, { n: 1, one: w.done, seen: new Set([w.done]) })
    else if (!FILE_GROUPS.has(w.group) || !g.seen.has(w.done) || w.done.endsWith(" a file")) {
      g.n++
      g.seen.add(w.done)
    }
  }
  if (groups.size > 3) return `Took ${shown.length} steps`
  // Single steps on one file name it once ("Read and edited story.md")
  const singles = [...groups.values()].map(({ n, one }) => (n === 1 ? /^(\S+) (.+)$/.exec(one) : null))
  const object = singles[0]?.[2]
  if (object && object !== "a file" && singles.every((m) => m?.[2] === object)) return `${capital(joinAnd(singles.map((m) => lower(m![1]))))} ${object}`
  return capital(joinAnd([...groups].map(([group, { n, one }]) => groupPhrase(group, n, one))))
}

// What a running block is doing, by the kind of its latest step
export function liveSentence(steps: WordedStep[]) {
  const shown = steps.map((s) => s.words).filter((w) => !w.hidden)
  const latest = shown.at(-1)
  if (!latest) return "Working"
  return LIVE[latest.group] ?? (latest.group.startsWith("owlit:") ? latest.now : "Working")
}

// Neighbouring steps of these kinds fold into one row ("Read 3 files"); a command, an edit or a question
// keeps its own row, since each says something different
export const foldable = (group: string) => ["read", "find", "grep", "web", "fetch"].includes(group) || group.startsWith("owlit:")

// ---- What Owlit asks ----

// A permission or question as one sentence in Owlit's words, for the card above the composer, Home and
// notifications: "Owlit wants to edit 研究故事.md", "Owlit wants to run a command"
export function askSentence(title: string, call?: ToolCall) {
  if (call) {
    const w = stepWords(call)
    if (runsCommand(call)) return "Owlit wants to run a command"
    if (call.tool?.name === "Write" && !call.diff?.oldText) return `Owlit wants to create ${fileName(pathOf(call) ?? "a file")}`
    if (!w.hidden) return `Owlit wants to ${lower(w.now)}`
  }
  const action = toolTitle(title).replace(/(?:[\w.~-]*\/)+([\w.-]+)/g, "$1")
  return `Owlit wants to ${lower(action)}`
}

// What Owlit was still waiting on the user to allow when its reply broke; those steps never ran ("It was
// asking to edit 研究故事.md when it stopped, so that wasn't done.")
export function unansweredSentence(parts: MessagePart[]) {
  const calls = new Map(parts.flatMap((p) => (p.type === "tool_call" ? [[p.toolCallId, p] as const] : [])))
  const asks = new Set(
    parts.flatMap((p) => (p.type === "permission" && !p.outcome ? [askSentence(p.title, calls.get(p.toolCallId)).replace(/^Owlit wants to /, "")] : [])),
  )
  if (asks.size === 0) return undefined
  return `It was asking to ${joinAnd([...asks])} when it stopped, so ${asks.size === 1 ? "that wasn't" : "those weren't"} done.`
}

// ---- An agent the answer handed work to ----

// What one agent did, for the right end of its row once it is done: what it changed (papers added, reading
// notes kept, files edited), else how many steps it took. Its failed searches are normal and stay inside.
export function agentDone(calls: ToolCall[]) {
  const done = calls.filter((c) => c.status === "completed")
  // owlit's tools by their MCP name, or bare as the Owlit engine may name them
  const owlit = (c: ToolCall, tool: string) => {
    const name = c.tool?.name ?? c.title
    return (owlitToolOf(name) ?? name) === tool
  }
  const papers = done.filter((c) => owlit(c, "library_add")).reduce((n, c) => n + (c.content?.match(/^Added /gm)?.length ?? 0), 0)
  if (papers) return papers === 1 ? "Added a paper" : `Added ${papers} papers`
  const notes = done.filter((c) => owlit(c, "library_write_digest")).length
  if (notes) return notes === 1 ? "Wrote a reading note" : `Wrote ${notes} reading notes`
  const files = [...new Set(done.filter((c) => c.kind === "edit").map(pathOf).filter((p): p is string => !!p))]
  if (files.length === 1) return `Edited ${fileName(files[0])}`
  if (files.length > 1) return `Edited ${files.length} files`
  const shown = calls.filter((c) => !stepWords(c).hidden).length
  return shown ? plural(shown, "step") : undefined
}

// The step an agent is at now, in the steps' own words ("Searching your Library for “…”")
export function agentNow(calls: ToolCall[], thinking: boolean) {
  const running = calls
    .map((call) => ({ call, words: stepWords(call) }))
    .findLast((s) => !s.words.hidden && (s.call.status === "in_progress" || s.call.status === "pending"))
  return running ? running.words.now : thinking ? "Thinking" : "Starting"
}
