import { plural } from "@lingui/core/macro"
import { editStats } from "@owlit/protocol"
import { hostOf } from "@/lib/names"
import type { QuestionPart, ToolCall } from "../types"
import { countsText } from "./edit-counts"
import { fetchUrlOf, stepGroup } from "./step-words"
import { owlitToolOf } from "./tool-title"

// What a step got back, read for its row: the text a tool sent, a web search's hits, the detail at the
// row's right end, and whether the row has anything to open to.

// The text a tool sent back, without the code fences Claude Code wraps it in
const plain = (content?: string) =>
  (content ?? "")
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim()

// What an agent the step handed work to sent back. Claude Code answers a background start with a notice
// meant only for its model ("Async agent launched successfully … never quote …", the agent's id, its
// output file): that is no result at all. A finished agent's answer ends with the same kind of lines
// (its id, its token usage), which are dropped.
function agentOutput(content?: string) {
  const text = plain(content)
  if (/^Async agent launched/.test(text)) return ""
  return text
    .replace(/<usage>[\s\S]*?<\/usage>/g, "")
    .split("\n")
    .filter((line) => !/^agentId: /.test(line.trim()))
    .join("\n")
    .trim()
}

const LIMIT = 4000

// What a step printed or sent back, cut to a length a row can hold
export function outputOf(call: ToolCall) {
  const text = call.tool?.name === "Agent" || call.tool?.name === "Task" ? agentOutput(call.content) : plain(call.content)
  return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…` : text
}

// A web search's hits, as Claude Code lists them: "Title (https://…)" a line
export function hitsOf(content?: string) {
  const hits: { title: string; url: string }[] = []
  for (const line of plain(content).split("\n")) {
    const m = /^(.*?)\s*\((https?:\/\/[^\s)]+)\)\s*$/.exec(line.trim())
    if (m) hits.push({ title: m[1] || m[2], url: m[2] })
  }
  return hits
}

// A page that is a paper: on arXiv, or under a DOI
export const isPaperUrl = (url: string) => /arxiv\.org\/(abs|pdf|html)\/|doi\.org\/10\.|\/doi\/(abs\/|full\/|pdf\/)?10\./.test(url)

// The muted detail at a row's right end, when the step's result has one worth seeing at a glance
export function stepMeta(call: ToolCall): string | undefined {
  if (call.status !== "completed") return undefined
  const group = stepGroup(call)
  if (group === "web") {
    const n = hitsOf(call.content).length
    return n ? plural(n, { one: "# result", other: "# results" }) : undefined
  }
  const url = group === "fetch" ? fetchUrlOf(call) : undefined
  if (url) return hostOf(url)
  if (call.diff) {
    // Only the parts the agent reported, so never "Rewritten": that is said of the whole file, in the result card
    return countsText(editStats(call.diff.path, call.diff.oldText, call.diff.newText)) || undefined
  }
  return undefined
}

// owlit's own tools whose outcome the reply's result card already shows: papers added or taken out, a note
// left on a doc, papers gathered into a thread. What they send back is written for the agent ("Cite it as …;
// keep a digest with library_write_digest"), so a step that worked is its sentence alone and doesn't
// open; the card's row is where the person sees and undoes it. One that failed still opens to why.
const SHOWN_AS_RESULT = new Set(["library_add", "library_remove", "docs_add_note", "thread_write"])

function shownAsResult(call: ToolCall) {
  if (call.status === "failed") return false
  // By the MCP name, or bare as the Owlit engine may name them
  const name = call.tool?.name ?? call.title
  return SHOWN_AS_RESULT.has(owlitToolOf(name) ?? name)
}

export function hasResult(call: ToolCall, question?: QuestionPart) {
  if (shownAsResult(call)) return false
  return !!question?.answers || !!call.diff || !!outputOf(call) || !!call.tool?.command || (call.kind === "execute" && !call.tool)
}

