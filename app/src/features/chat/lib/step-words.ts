import { plural, t, type ChoiceOptions } from "@lingui/core/macro"
import { i18n } from "@owlit/i18n"
import type { MessagePart, ToolCall } from "../types"
import { owlitStepWords, owlitToolOf, quote, toolTitle } from "./tool-title"
import { useLibraryStore } from "@/features/library/store"
import { capital, joinActions, joinAnd } from "@/lib/words"
import { fileName } from "@/lib/names"

// How a step of an answer is put in words: what it is doing while it runs, what it did once done, and what
// kind of work it is, so a block of steps can say in one sentence what happened ("Read 3 files and
// searched the web twice"). Steps are named by the agent's own tool and inputs when it says them (Claude
// Code does); otherwise by the title it gave, read as plainly as it allows.
//
// Every sentence owlit puts together is a whole message per form (running, done, n times), so each
// language says it its own way; only what an agent wrote itself (a command's description, a tool's title)
// stays in the agent's words, and gets an English past tense only when it is English.

export interface StepWords {
  // While it runs or waits, in the agent's words ("Read the lit check")
  now: string
  // Once it ran ("Read the lit check", "Searched the web for “x”")
  done: string
  // What kind of work, for the block's sentence and for folding neighbours together
  group: string
  // The file a read, edit or write named, so steps on one file are said once ("Read and edited story.md")
  file?: string
  // Housekeeping of the agent's that says nothing to the user (loading its tools, its to-do list)
  hidden?: boolean
}

// ---- Verbs, for what an agent wrote in English ----

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

// An English sentence with its first verb in the past tense; unchanged when the first word isn't a verb
// owlit knows (a sentence in another language among them)
function pastTense(sentence: string) {
  const m = /^(\S+)(.*)$/s.exec(sentence.trim())
  if (!m) return sentence
  const word = m[1].toLowerCase()
  const base = PAST[word] ? word : ING[word] ? ING[word] : word.endsWith("s") && PAST[word.slice(0, -1)] ? word.slice(0, -1) : word.endsWith("es") && PAST[word.slice(0, -2)] ? word.slice(0, -2) : null
  if (!base) return sentence
  const past = PAST[base]
  return (m[1][0] === m[1][0].toUpperCase() ? capital(past) : past) + m[2]
}

// ---- Things a step names ----

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

// The title a fetched page gave, when the agent's summary of it says ("**Title:** …", or a first heading)
function pageTitle(content?: string) {
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
  const action = lower(words(m[2]))
  return { now: t`Use ${server}: ${action}`, done: t`Used ${server}: ${action}`, group: `mcp:${server}` }
}

// SubagentHandback is how an agent the step handed work to gives its report back; the report reaches the
// user through Owlit's answer, and the step itself only says "Report delivered"
const HIDDEN = new Set(["ToolSearch", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "SubagentHandback"])

// ---- One step ----

// A step on a file, named or not
function fileStep(kind: "read" | "edit" | "write", path: string | undefined): StepWords {
  const file = path === undefined ? undefined : fileName(path)
  if (kind === "read")
    return file
      ? { now: t`Read ${file}`, done: t({ message: `Read ${file}`, context: "a step that ran" }), group: "read", file }
      : { now: t`Read a file`, done: t({ message: "Read a file", context: "a step that ran" }), group: "read" }
  if (kind === "edit") return file ? { now: t`Edit ${file}`, done: t`Edited ${file}`, group: "edit", file } : { now: t`Edit a file`, done: t`Edited a file`, group: "edit" }
  return file ? { now: t`Write ${file}`, done: t`Wrote ${file}`, group: "write", file } : { now: t`Write a file`, done: t`Wrote a file`, group: "write" }
}

const runCommand = (): StepWords => ({ now: t`Run a command`, done: t`Ran a command`, group: "command" })

// What an agent wrote to say what it does ("Run the tests"): its own words, past tense once done
const described = (description: string, group: string): StepWords => ({ now: capital(description), done: capital(pastTense(description)), group })

function webSearch(query: string | undefined): StepWords {
  if (!query) return { now: t`Search the web`, done: t`Searched the web`, group: "web" }
  const quoted = quote(query)
  return { now: t`Search the web for ${quoted}`, done: t`Searched the web for ${quoted}`, group: "web" }
}

function fetchPage(where: string | undefined, content: string | undefined): StepWords {
  const title = pageTitle(content)
  if (title) return { now: where ? t`Open ${where}` : t`Open a page`, done: t`Opened “${title}”`, group: "fetch" }
  return where ? { now: t`Open ${where}`, done: t`Opened ${where}`, group: "fetch" } : { now: t`Open a page`, done: t`Opened a page`, group: "fetch" }
}

// A step's words, worked out once per tool call: a streamed update replaces only the call it is about, so
// the other steps of a block keep theirs. Kept beside them is what else the words read, so a change in
// any says them again: how many questions, the interface's language, and the Library (a paper's label).
const wordsCache = new WeakMap<ToolCall, { questions: number; locale: string; papers: unknown; words: StepWords }>()

// `questions`: how many questions the step asked the user, when it asked some. Shared: don't change it.
export function stepWords(call: ToolCall, questions = 1): StepWords {
  const locale = i18n.locale
  const papers = useLibraryStore.getState().papers
  const kept = wordsCache.get(call)
  if (kept && kept.questions === questions && kept.locale === locale && kept.papers === papers) return kept.words
  const words = wordsFor(call, questions)
  wordsCache.set(call, { questions, locale, papers, words })
  return words
}

function wordsFor(call: ToolCall, questions: number): StepWords {
  const tool = call.tool
  const name = tool?.name
  const path = pathOf(call)

  if (name && HIDDEN.has(name)) return { now: name, done: name, group: "hidden", hidden: true }

  const owlit = owlitToolOf(name ?? call.title)
  if (owlit) return { ...owlitStepWords(owlit, tool), group: `owlit:${owlit}` }
  const mcp = name ? mcpWords(name) : undefined
  if (mcp) return mcp

  switch (name) {
    case "Bash":
    case "BashOutput":
      return tool?.description ? described(tool.description, "command") : runCommand()
    case "Read":
      return fileStep("read", path)
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return fileStep("edit", path)
    case "Write":
      return fileStep("write", path)
    case "Glob": {
      if (!tool?.pattern) return { now: t`Look for files`, done: t`Looked for files`, group: "find" }
      const pattern = quote(tool.pattern)
      return { now: t`Look for files matching ${pattern}`, done: t`Looked for files matching ${pattern}`, group: "find" }
    }
    case "Grep": {
      if (!tool?.pattern) return { now: t`Search files`, done: t`Searched files`, group: "grep" }
      const pattern = quote(tool.pattern)
      return { now: t`Search files for ${pattern}`, done: t`Searched files for ${pattern}`, group: "grep" }
    }
    case "WebSearch":
      return webSearch(tool?.query)
    case "WebFetch":
      return fetchPage(tool?.url ? shortUrl(tool.url) : undefined, call.content)
    case "Agent":
    case "Task":
      return tool?.description ? described(tool.description, "agent") : { now: t`Hand a task to an agent`, done: t`Handed a task to an agent`, group: "agent" }
    case "AskUserQuestion":
      return {
        now: plural(questions, { one: "Ask you a question", other: "Ask you # questions" }),
        done: plural(questions, { one: "Asked you a question", other: "Asked you # questions" }),
        group: "question",
      }
  }
  return fromTitle(call)
}

// A step whose agent didn't name its tool: read the title as the agent wrote it
function fromTitle(call: ToolCall): StepWords {
  const title = call.title.trim()
  let m: RegExpExecArray | null
  if (call.kind === "execute") return runCommand()
  if ((m = /^Read (.+)$/.exec(title)) && call.kind === "read") return fileStep("read", m[1].replace(/ \(.*\)$/, ""))
  if ((m = /^Edit (.+)$/.exec(title))) return fileStep("edit", m[1])
  if ((m = /^Write (.+)$/.exec(title))) return fileStep("write", m[1])
  if ((m = /^Fetch (\S+)/.exec(title))) return fetchPage(shortUrl(m[1]), call.content)
  if ((m = /^Search "(.*)"$/s.exec(title))) return webSearch(m[1])
  const mcp = mcpWords(title)
  if (mcp) return mcp
  if (title === "ToolSearch") return { now: title, done: title, group: "hidden", hidden: true }
  const now = toolTitle(title)
  return { now, done: pastTense(now), group: call.kind === "read" ? "read" : call.kind === "fetch" ? "fetch" : "other" }
}

// What kind of work a step is ("web", "fetch", "owlit:library_add"), as its words group it
export const stepGroup = (call: ToolCall) => stepWords(call).group

// ---- A block of steps ----

// An exact form for two ("twice") is ICU's "=2". Lingui's types only take "2", which its native macro
// transform passes on unchanged and ICU then can't read, so the options are cast instead.
type Twice = ChoiceOptions

// What n steps of a kind did, in a lower-case phrase for the middle of a sentence ("read 3 files",
// "searched the web twice"); undefined for a kind owlit has no phrase for
function kindPhrase(group: string, n: number): string | undefined {
  switch (group) {
    case "command":
      return plural(n, { one: "ran a command", other: "ran # commands" })
    case "read":
      return plural(n, { one: "read a file", other: "read # files" })
    case "edit":
      return plural(n, { one: "edited a file", other: "edited # files" })
    case "write":
      return plural(n, { one: "wrote a file", other: "wrote # files" })
    case "find":
      return plural(n, { one: "looked for files", "=2": "looked for files twice", other: "looked for files # times" } as Twice)
    case "grep":
      return plural(n, { one: "searched files", "=2": "searched files twice", other: "searched files # times" } as Twice)
    case "web":
      return plural(n, { one: "searched the web", "=2": "searched the web twice", other: "searched the web # times" } as Twice)
    case "fetch":
      return plural(n, { one: "opened a page", other: "opened # pages" })
    case "agent":
      return plural(n, { one: "handed a task to a helper", other: "handed # tasks to helpers" })
    case "question":
      return plural(n, { one: "asked you a question", other: "asked you # questions" })
    case "other":
      return plural(n, { one: "used a tool", other: "used # tools" })
    case "owlit:library_list":
      return plural(n, { one: "listed your Library", "=2": "listed your Library twice", other: "listed your Library # times" } as Twice)
    case "owlit:library_get":
      return plural(n, { one: "looked up a paper", other: "looked up # papers" })
    case "owlit:library_read":
      return plural(n, { one: "read a paper", other: "read # papers" })
    case "owlit:library_highlights":
      return plural(n, { one: "read your highlights", "=2": "read your highlights twice", other: "read your highlights # times" } as Twice)
    case "owlit:library_search":
      return plural(n, { one: "searched for papers", "=2": "searched for papers twice", other: "searched for papers # times" } as Twice)
    case "owlit:library_related":
      return plural(n, { one: "followed a paper's citations", "=2": "followed a paper's citations twice", other: "followed a paper's citations # times" } as Twice)
    case "owlit:library_journal":
      return plural(n, { one: "listed a journal's papers", "=2": "listed a journal's papers twice", other: "listed a journal's papers # times" } as Twice)
    case "owlit:library_add":
      return plural(n, { one: "added papers to your Library", "=2": "added papers twice", other: "added papers # times" } as Twice)
    case "owlit:library_remove":
      return plural(n, { one: "removed papers from your Library", "=2": "removed papers twice", other: "removed papers # times" } as Twice)
    case "owlit:library_request_digest":
      return plural(n, { one: "asked for a digest", other: "asked for # digests" })
    case "owlit:docs_list":
      return plural(n, { one: "listed your docs", "=2": "listed your docs twice", other: "listed your docs # times" } as Twice)
    case "owlit:docs_read":
      return plural(n, { one: "read a doc", other: "read # docs" })
    case "owlit:docs_add_note":
      return plural(n, { one: "left a note on a doc", other: "left # notes on docs" })
    case "owlit:docs_move":
      return plural(n, { one: "moved a doc", other: "moved # docs" })
    case "owlit:chats_read":
      return plural(n, { one: "read a chat", other: "read # chats" })
    case "owlit:ui_jump":
      return plural(n, { one: "showed a passage", other: "showed # passages" })
    case "owlit:ui_mark":
      return plural(n, { one: "highlighted a passage", other: "highlighted # passages" })
  }
  if (group.startsWith("mcp:")) {
    const server = group.slice(4)
    return plural(n, { one: `used ${server}`, "=2": `used ${server} twice`, other: `used ${server} # times` } as Twice)
  }
  return undefined
}

// What a running block is doing, by the kind of its latest step
function liveWords(group: string): string | undefined {
  switch (group) {
    case "command":
      return t`Running commands`
    case "read":
      return t`Reading files`
    case "edit":
      return t`Editing`
    case "write":
      return t`Writing`
    case "find":
      return t`Looking for files`
    case "grep":
      return t`Searching files`
    case "web":
      return t`Searching the web`
    case "fetch":
      return t`Opening pages`
    case "agent":
      return t`Working with a helper`
    case "owlit:library_search":
      return t`Searching for papers`
    case "owlit:library_related":
      return t`Following citations`
    case "owlit:library_journal":
      return t`Listing a journal's papers`
    case "owlit:library_read":
      return t`Reading papers`
    case "owlit:docs_read":
      return t`Reading docs`
  }
  return undefined
}

// What a step on a file did, without the file, for "Read and edited story.md": the verbs are joined as a
// list ("读取和编辑"), and the sentence around them sets the tense ("{verbs}了 {file}")
function fileVerb(group: string) {
  if (group === "read") return t({ message: "read", context: "done to a file, before its name: read and edited story.md" })
  if (group === "edit") return t({ message: "edited", context: "done to a file, before its name: read and edited story.md" })
  return t({ message: "wrote", context: "done to a file, before its name: read and wrote story.md" })
}

// Groups whose phrase counts files ("edited 3 files"), so a file worked on twice is counted once
const FILE_GROUPS = new Set(["read", "edit", "write"])

// What a group of n steps did, in a lower-case phrase ("read 3 files"); `one` is the step itself when alone
export function groupPhrase(group: string, n: number, one?: string) {
  if (n === 1 && one) return lower(one)
  return kindPhrase(group, n) ?? plural(n, { one: "used a tool", other: "used # tools" })
}

// A step with its words, worked out once for a block
export interface WordedStep {
  call: ToolCall
  words: StepWords
}

// The sentence a finished block folds into: its one step, or up to three kinds of work in the order they
// came ("Listed your Library, searched the web twice and opened 3 pages"), or "Took 12 steps"
export function blockSentence(steps: WordedStep[]) {
  const shown = steps.filter((s) => !s.words.hidden)
  if (shown.length === 0) return t({ message: "Thought", comment: "a block of an answer's steps in which the agent only thought" })
  // A step that didn't run to the end is said as it was asked ("Edit notes.md"); its row says what happened
  const said = ({ call, words }: WordedStep) => (call.status === "completed" ? words.done : words.now)
  if (shown.length === 1) return said(shown[0])
  // An edit that didn't happen isn't counted as one; the count after the sentence says so
  const counted = shown.filter((s) => s.call.status === "completed" || !["edit", "write"].includes(s.words.group))
  if (counted.length === 0) return said(shown[0])
  if (counted.length === 1) return said(counted[0])
  // Steps on files count the files, not the steps: two edits of draft.md are "Read and edited draft.md",
  // not "Read draft.md and edited 2 files". A step that names no file ("a file") counts as its own.
  const groups = new Map<string, { n: number; one: string; file?: string; seen: Set<string> }>()
  for (const { words: w } of counted) {
    const g = groups.get(w.group)
    if (!g) groups.set(w.group, { n: 1, one: w.done, file: w.file, seen: new Set([w.done]) })
    else if (!FILE_GROUPS.has(w.group) || !g.seen.has(w.done) || !w.file) {
      g.n++
      g.seen.add(w.done)
    }
  }
  if (groups.size > 3) {
    const count = shown.length
    return t`Took ${count} steps`
  }
  // Single steps on one file name it once ("Read and edited story.md")
  const all = [...groups]
  const file = all[0][1].file
  if (file && all.every(([group, g]) => FILE_GROUPS.has(group) && g.n === 1 && g.file === file)) {
    const verbs = joinAnd(all.map(([group]) => fileVerb(group)))
    return capital(t({ message: `${verbs} ${file}`, context: "file actions and the file: read and edited story.md" }))
  }
  return capital(joinActions(all.map(([group, { n, one }]) => groupPhrase(group, n, one))))
}

// What a running block is doing, by the kind of its latest step
export function liveSentence(steps: WordedStep[]) {
  const shown = steps.map((s) => s.words).filter((w) => !w.hidden)
  const latest = shown.at(-1)
  const working = () => t({ message: "Working", comment: "what an answer is doing while it runs" })
  if (!latest) return working()
  return liveWords(latest.group) ?? (latest.group.startsWith("owlit:") ? latest.now : working())
}

// Neighbouring steps of these kinds fold into one row ("Read 3 files"); a command, an edit or a question
// keeps its own row, since each says something different
export const foldable = (group: string) => ["read", "find", "grep", "web", "fetch"].includes(group) || group.startsWith("owlit:")

// ---- What Owlit asks ----

// What Owlit asks to do, as the end of "Owlit wants to …": "edit 研究故事.md", "run a command"
function askAction(title: string, call?: ToolCall) {
  if (call) {
    const w = stepWords(call)
    if (runsCommand(call)) return t({ message: "run a command", context: "Owlit wants to …" })
    if (call.tool?.name === "Write" && !call.diff?.oldText) {
      const path = pathOf(call)
      if (!path) return t({ message: "create a file", context: "Owlit wants to …" })
      const file = fileName(path)
      return t({ message: `create ${file}`, context: "Owlit wants to …" })
    }
    if (!w.hidden) return lower(w.now)
  }
  return lower(toolTitle(title).replace(/(?:[\w.~-]*\/)+([\w.-]+)/g, "$1"))
}

// A permission or question as one sentence in Owlit's words, for the card above the composer, Home and
// notifications: "Owlit wants to edit 研究故事.md", "Owlit wants to run a command"
export function askSentence(title: string, call?: ToolCall) {
  const action = askAction(title, call)
  return t`Owlit wants to ${action}`
}

// What Owlit was still waiting on the user to allow when its reply broke; those steps never ran ("It was
// asking to edit 研究故事.md when it stopped, so that wasn't done.")
export function unansweredSentence(parts: MessagePart[]) {
  const calls = new Map(parts.flatMap((p) => (p.type === "tool_call" ? [[p.toolCallId, p] as const] : [])))
  const asks = new Set(parts.flatMap((p) => (p.type === "permission" && !p.outcome ? [askAction(p.title, calls.get(p.toolCallId))] : [])))
  if (asks.size === 0) return undefined
  const actions = joinActions([...asks])
  return plural(asks.size, {
    one: `It was asking to ${actions} when it stopped, so that wasn't done.`,
    other: `It was asking to ${actions} when it stopped, so those weren't done.`,
  })
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
  // library_add's result says "Added …" once per paper; that is core's text to the agent, always English
  const papers = done.filter((c) => owlit(c, "library_add")).reduce((n, c) => n + (c.content?.match(/^Added /gm)?.length ?? 0), 0)
  if (papers) return plural(papers, { one: "Added a paper", other: "Added # papers" })
  const notes = done.filter((c) => owlit(c, "library_request_digest")).length
  if (notes) return plural(notes, { one: "Asked for a digest", other: "Asked for # digests" })
  const files = [...new Set(done.filter((c) => c.kind === "edit").map(pathOf).filter((p): p is string => !!p))]
  if (files.length === 1) {
    const file = fileName(files[0])
    return t`Edited ${file}`
  }
  if (files.length > 1) return plural(files.length, { one: "Edited # file", other: "Edited # files" })
  const shown = calls.filter((c) => !stepWords(c).hidden).length
  return shown ? plural(shown, { one: "# step", other: "# steps" }) : undefined
}

// The step an agent is at now, in the steps' own words ("Searching your Library for “…”"). Between steps,
// while it writes its report or runs a hidden step, it is thinking: Starting is only before its first step,
// or the row would fall back to it mid-run.
export function agentNow(calls: ToolCall[], started: boolean) {
  const running = calls
    .map((call) => ({ call, words: stepWords(call) }))
    .findLast((s) => !s.words.hidden && (s.call.status === "in_progress" || s.call.status === "pending"))
  return running ? running.words.now : started ? t`Thinking` : t`Starting`
}
