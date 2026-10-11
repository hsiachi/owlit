import type * as acp from "@agentclientprotocol/sdk"
import type { AgentQuestion, QuestionAnswer, ToolInfo } from "@owlit/protocol"

// An agent's form (ACP elicitation) as questions the chat can show, and the user's answers back as the
// form's content. Claude Code sends its AskUserQuestion this way: one select field per question
// (question_<n>, a titled oneOf, or an array of anyOf for several picks), each followed by an optional
// free-text field (question_<n>_custom) for an answer of the user's own. Any other form is read the same
// way, field by field; a field owlit can't show (a number range, say) is asked in words.

type Field = {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  oneOf?: { const?: unknown; title?: string; description?: string }[]
  items?: { anyOf?: { const?: unknown; title?: string; description?: string }[]; enum?: unknown[] }
}

const optionsOf = (choices: { const?: unknown; title?: string; description?: string }[] | undefined, plain: unknown[] | undefined) =>
  choices
    ? choices.map((c) => ({ label: String(c.const ?? c.title ?? ""), ...(c.description ? { description: c.description } : {}) }))
    : (plain ?? []).map((v) => ({ label: String(v) }))

// The questions a form asks, in the order of its fields; empty when it asks nothing owlit can show
export function questionsFrom(request: { message: string; requestedSchema?: { properties?: Record<string, unknown> } }): AgentQuestion[] {
  const fields = Object.entries((request.requestedSchema?.properties ?? {}) as Record<string, Field>)
  const questions: AgentQuestion[] = []
  const byId = new Map<string, AgentQuestion>()
  for (const [id, f] of fields) {
    // An answer of one's own, belonging to the question before it
    const base = /^(.+)_custom$/.exec(id)?.[1]
    if (base && byId.has(base) && (f.type ?? "string") === "string") {
      byId.get(base)!.allowsText = true
      continue
    }
    let q: AgentQuestion
    if (f.type === "array") {
      q = { id, question: "", options: optionsOf(f.items?.anyOf, f.items?.enum), multiSelect: true, allowsText: false }
    } else if (f.type === "boolean") {
      q = { id, question: "", options: [{ label: "Yes" }, { label: "No" }], allowsText: false }
    } else if (f.oneOf || f.enum) {
      q = { id, question: "", options: optionsOf(f.oneOf, f.enum), allowsText: false }
    } else {
      q = { id, question: "", options: [], allowsText: true }
    }
    q.question = f.description || f.title || request.message
    if (f.title && f.title !== "Other") q.header = f.title
    questions.push(q)
    byId.set(id, q)
  }
  // A form of one question carries it in its message; with several, each field says its own
  if (questions.length === 1 && request.message) questions[0].question = request.message
  return questions
}

// The form's content for what the user gave. A question with an answer field of its own takes typed words
// there; one asked in words only takes them as its value.
export function contentFrom(request: { requestedSchema?: { properties?: Record<string, unknown> } }, questions: AgentQuestion[], answers: Record<string, QuestionAnswer>) {
  const fields = (request.requestedSchema?.properties ?? {}) as Record<string, Field>
  const content: Record<string, string | string[] | boolean> = {}
  for (const q of questions) {
    const a = answers[q.id]
    if (!a) continue
    const picks = a.picks?.filter(Boolean) ?? []
    const text = a.text?.trim()
    if (fields[q.id]?.type === "boolean") {
      if (picks[0]) content[q.id] = picks[0] === "Yes"
    } else if (q.multiSelect) {
      if (picks.length) content[q.id] = picks
    } else if (picks[0]) {
      content[q.id] = picks[0]
    }
    if (text) {
      if (fields[`${q.id}_custom`]) content[`${q.id}_custom`] = text
      else if (content[q.id] === undefined) content[q.id] = text
    }
  }
  return content
}

// What a tool call says about itself beyond its title: Claude Code puts its own tool name in
// _meta.claudeCode.toolName and its input in rawInput. Only the inputs that name the step are kept.
export function toolInfoOf(call: { _meta?: Record<string, unknown> | null; rawInput?: unknown }): ToolInfo | undefined {
  const name = (call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName
  if (typeof name !== "string" || !name) return undefined
  const input = (call.rawInput ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined)
  const info: ToolInfo = { name }
  const set = (k: keyof Omit<ToolInfo, "name">, v: string | undefined) => {
    if (v) info[k] = v.length > 2000 ? `${v.slice(0, 2000)}…` : v
  }
  set("description", str("description"))
  set("command", str("command"))
  set("query", str("query"))
  set("url", str("url"))
  set("pattern", str("pattern"))
  set("path", str("file_path") ?? str("path") ?? str("notebook_path"))
  return info
}

// A form's request, when it can be shown in a chat: one of a session's forms (not a URL to open)
export const isSessionForm = (r: acp.CreateElicitationRequest): r is acp.CreateElicitationRequest & { mode: "form"; sessionId: string; requestedSchema: { properties?: Record<string, unknown> } } =>
  r.mode === "form" && typeof (r as { sessionId?: unknown }).sessionId === "string"

// The report an agent's own agent hands back, when this step is how it does: Claude Code's agents end with
// a SubagentHandback call whose input is the report (checked 2026-10-11, claude-agent-acp 0.88); the step
// itself only says "Report delivered"
export function handbackOf(call: { _meta?: Record<string, unknown> | null; rawInput?: unknown }): string | undefined {
  if ((call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName !== "SubagentHandback") return undefined
  const message = (call.rawInput as { message?: unknown } | undefined)?.message
  return typeof message === "string" && message.trim() ? message.trim() : undefined
}
