import { useLibraryStore } from "@/features/library/store"
import type { Connector, Mentionable, PermissionKind, QuotedSelection, SessionUpdate, StopReason } from "../types"
import { builtInConnectors, mockCheckResults } from "../mocks/connectors"
import { getWorkspaceFs, getWorkspaceNotes, type AgentClient, type PromptRequest } from "./client"

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
    const t = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(t)
      reject(new DOMException("Aborted", "AbortError"))
    })
  })

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError"

const READ_ONLY_MODES = new Set(["plan", "read-only"])
const AUTO_MODES = new Set(["acceptEdits", "bypassPermissions", "auto", "full-access", "auto_edit", "yolo"])

// Simulates an ACP agent turn: thinking, tool calls, an optional permission
// request, and a streamed markdown answer. Enough to exercise every UI state.
export class MockAgentClient implements AgentClient {
  private pendingPermissions = new Map<string, (optionId: string) => void>()

  async listConnectors() {
    return builtInConnectors
  }

  async check(connector: Connector): Promise<Connector> {
    await new Promise((r) => setTimeout(r, 700))
    const result = mockCheckResults[connector.id]
    if (result) return { ...connector, ...result, error: result.error }
    // Custom connectors: pretend the command exists only if it looks like one
    const looksValid = /^\S+/.test(connector.command.trim())
    return looksValid
      ? { ...connector, status: "available", version: "unknown", authenticated: true }
      : { ...connector, status: "error", error: "Command is empty" }
  }

  respondPermission(_chatId: string, requestId: string, optionId: string) {
    this.pendingPermissions.get(requestId)?.(optionId)
    this.pendingPermissions.delete(requestId)
  }

  async prompt(
    req: PromptRequest,
    emit: (u: SessionUpdate) => void,
    signal: AbortSignal,
  ): Promise<StopReason> {
    const { text, mentions, attachments, context = [], selection } = req.input
    const mode = req.modeId ?? ""
    // What the agent reads first: everything mentioned, plus what was on screen
    const sources = [...mentions, ...context.filter((c) => !mentions.some((m) => m.uri === c.uri))]
    try {
      await this.stream(emit, signal, thoughtFor(text, sources, selection), "agent_thought_chunk", 18)

      await sleep(300, signal)
      for (const m of sources) await this.readTool(emit, signal, m)

      // Asked to review a doc: notes in its margin rather than edits
      const doc = selection?.source.kind === "doc" ? selection.source : sources.find((s) => s.kind === "doc")
      if (doc && WANTS_REVIEW.test(text)) {
        return await this.review(emit, signal, doc, "Owlit", req.chatId)
      }

      // Asked from a doc about a passage: rewrite it in place, or find papers behind it
      if (selection?.source.kind === "doc") {
        if (WANTS_REWRITE.test(text)) return await this.proposeEdit(emit, signal, selection, mode)
        if (WANTS_SUPPORT.test(text)) return await this.findSupport(emit, signal, selection)
      }
      if (selection || context.length) {
        await sleep(300, signal)
        await this.stream(emit, signal, contextAnswer(text, sources, selection), "agent_message_chunk", 14)
        return "end_turn"
      }

      for (const a of attachments) {
        const id = `tc-${crypto.randomUUID()}`
        emit({ type: "tool_call", toolCallId: id, title: `Reading attachment ${a.name}`, kind: "read", status: "in_progress" })
        await sleep(500, signal)
        emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: `${formatBytes(a.size)} · ${a.mimeType || "unknown type"}` })
      }

      if (mentions.length === 0 && /\b(paper|library|literature)\b/i.test(text)) {
        const id = `tc-${crypto.randomUUID()}`
        emit({ type: "tool_call", toolCallId: id, title: "Searching the Library", kind: "search", status: "in_progress" })
        await sleep(900, signal)
        emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: "8 papers matched; shortlisted 3 by relevance." })
      }

      if (READ_ONLY_MODES.has(mode)) {
        await sleep(400, signal)
        emit({
          type: "plan",
          entries: [
            { content: "Read the mentioned sources", priority: "high", status: "completed" },
            { content: "Outline the answer", priority: "medium", status: "in_progress" },
            { content: "Draft and cite", priority: "medium", status: "pending" },
          ],
        })
      }

      const wantsWrite = /\b(write|edit|create|save|update|draft|add)\b/i.test(text)
      if (wantsWrite && !READ_ONLY_MODES.has(mode)) {
        const target = mentions.find((m) => m.kind === "doc")?.title ?? "notes/untitled.md"
        const toolCallId = `tc-${crypto.randomUUID()}`
        emit({ type: "tool_call", toolCallId, title: `Edit ${target}`, kind: "edit", status: "pending", locations: [{ path: `docs/${target}` }] })
        let outcome: PermissionKind = "allow_once"
        if (!AUTO_MODES.has(mode)) {
          outcome = await this.askPermission(emit, signal, toolCallId, `Edit ${target}`)
        }
        if (outcome.startsWith("reject")) {
          emit({ type: "tool_call_update", toolCallId, status: "failed", content: "Edit rejected by the user." })
          await this.stream(emit, signal, "Understood, I won't change any files. Here is the draft inline instead so you can paste it where you like.\n\n", "agent_message_chunk", 14)
        } else {
          emit({ type: "tool_call_update", toolCallId, status: "in_progress" })
          await sleep(900, signal)
          emit({ type: "tool_call_update", toolCallId, status: "completed", content: `Wrote 14 lines to docs/${target}` })
        }
      }

      await sleep(300, signal)
      await this.stream(emit, signal, answerFor(text, mentions), "agent_message_chunk", 14)
      return "end_turn"
    } catch (e) {
      if (isAbort(e)) return "cancelled"
      throw e
    }
  }

  // An edit to the doc the passage came from: shown as a diff, written only once allowed
  private async proposeEdit(emit: (u: SessionUpdate) => void, signal: AbortSignal, selection: QuotedSelection, mode: string): Promise<StopReason> {
    const fs = getWorkspaceFs()
    const path = docPath(selection.source.uri)
    const before = path && fs ? await fs.readTextFile(path) : null
    const rewritten = rewriteOf(selection.text)
    await sleep(300, signal)
    if (!path || !fs || before === null || !before.includes(selection.text)) {
      await this.stream(emit, signal, "I couldn't find that passage in the doc any more, so I left it alone. Select it again and I'll take another look.", "agent_message_chunk", 14)
      return "end_turn"
    }
    if (!rewritten) {
      await this.stream(emit, signal, "This already reads tight; I'd leave it as it is.", "agent_message_chunk", 14)
      return "end_turn"
    }

    await this.stream(emit, signal, rewritten.why + "\n\n", "agent_message_chunk", 14)
    const title = selection.source.title
    const toolCallId = `tc-${crypto.randomUUID()}`
    const diff = { path, oldText: before, newText: before.replace(selection.text, rewritten.text) }
    emit({ type: "tool_call", toolCallId, title: `Edit ${title}`, kind: "edit", status: "pending", locations: [{ path }], diff })
    let outcome: PermissionKind = "allow_once"
    if (!AUTO_MODES.has(mode)) outcome = await this.askPermission(emit, signal, toolCallId, `Edit ${title}`)
    if (outcome.startsWith("reject")) {
      emit({ type: "tool_call_update", toolCallId, status: "failed", content: "Edit rejected by the user." })
      await this.stream(emit, signal, "Left the doc as it was.", "agent_message_chunk", 14)
      return "end_turn"
    }
    emit({ type: "tool_call_update", toolCallId, status: "in_progress" })
    await sleep(300, signal)
    // Read again before writing: the user may have kept typing while the edit waited
    const now = await fs.readTextFile(path)
    if (now === null || !now.includes(selection.text)) {
      emit({ type: "tool_call_update", toolCallId, status: "failed", content: "The passage changed before the edit could be applied." })
      return "end_turn"
    }
    await fs.writeTextFile(path, now.replace(selection.text, rewritten.text))
    emit({ type: "tool_call_update", toolCallId, status: "completed", content: `Replaced 1 passage in ${path}` })
    return "end_turn"
  }

  // Reads the doc and leaves a note beside each sentence that claims more than it shows
  private async review(emit: (u: SessionUpdate) => void, signal: AbortSignal, doc: Mentionable, by: string, chatId: string): Promise<StopReason> {
    const path = docPath(doc.uri)
    const fs = getWorkspaceFs()
    const notes = getWorkspaceNotes()
    const text = path && fs ? await fs.readTextFile(path) : null
    if (!path || !notes || text === null) {
      await this.stream(emit, signal, "I couldn't open that doc.", "agent_message_chunk", 14)
      return "end_turn"
    }
    const found = reviewNotes(text).slice(0, 3)
    let left = 0
    for (const f of found) {
      const id = `tc-${crypto.randomUUID()}`
      emit({ type: "tool_call", toolCallId: id, title: `Note on ${doc.title}`, kind: "other", status: "in_progress", locations: [{ path }] })
      await sleep(500, signal)
      const ok = await notes.addNote({ path, quote: f.quote, text: f.note, by, chatId })
      if (ok) left++
      emit({ type: "tool_call_update", toolCallId: id, status: ok ? "completed" : "failed", content: `“${f.quote.slice(0, 60)}${f.quote.length > 60 ? "…" : ""}”` })
    }
    await sleep(300, signal)
    const answer = left
      ? `I left ${left} ${left === 1 ? "note" : "notes"} in the margin of [${doc.title}](${doc.uri}), beside the sentences that claim more than the text shows. Dismiss any you disagree with; the doc itself is unchanged.`
      : `Nothing in [${doc.title}](${doc.uri}) claims more than it shows, so I left no notes.`
    await this.stream(emit, signal, answer, "agent_message_chunk", 14)
    return "end_turn"
  }

  private async findSupport(emit: (u: SessionUpdate) => void, signal: AbortSignal, selection: QuotedSelection): Promise<StopReason> {
    const id = `tc-${crypto.randomUUID()}`
    emit({ type: "tool_call", toolCallId: id, title: "Searching the Library", kind: "search", status: "in_progress" })
    await sleep(900, signal)
    const papers = relatedPapers(selection.text)
    emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: `${papers.length} papers bear on the passage.` })
    await sleep(300, signal)
    const lines = papers.map((p) => `- [${p.cite}](owlit://library/${p.id}) · ${p.title}. ${p.reason}`)
    const answer = papers.length
      ? `These papers in your Library bear on the passage:\n\n${lines.join("\n")}\n\nNone of them settles the claim on its own; cite them for the parts they cover.`
      : "Nothing in your Library speaks to this passage directly. A search beyond the Library would be the next step."
    await this.stream(emit, signal, answer, "agent_message_chunk", 14)
    return "end_turn"
  }

  private async readTool(emit: (u: SessionUpdate) => void, signal: AbortSignal, m: Mentionable) {
    const id = `tc-${crypto.randomUUID()}`
    const verb = m.kind === "paper" ? "Reading paper" : m.kind === "doc" ? "Reading" : "Loading knowledge item"
    const path =
      m.kind === "paper"
        ? `library/papers/${slug(m.title)}/digest.md`
        : m.kind === "doc"
          ? `docs/${m.subtitle ?? ""}${m.title}`
          : `knowledge/${m.id}.md`
    emit({ type: "tool_call", toolCallId: id, title: `${verb} ${m.title}`, kind: "read", status: "in_progress", locations: [{ path }] })
    await sleep(700, signal)
    emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: `Read ${path} (${Math.floor(Math.random() * 60 + 20)} lines)` })
  }

  private askPermission(
    emit: (u: SessionUpdate) => void,
    signal: AbortSignal,
    toolCallId: string,
    title: string,
  ): Promise<PermissionKind> {
    const requestId = `perm-${crypto.randomUUID()}`
    const options = [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" as const },
      { optionId: "allow_always", name: "Always allow", kind: "allow_always" as const },
      { optionId: "reject_once", name: "Reject", kind: "reject_once" as const },
    ]
    emit({ type: "permission_request", requestId, toolCallId, title, kind: "edit", options })
    return new Promise<PermissionKind>((resolve, reject) => {
      const onAbort = () => {
        this.pendingPermissions.delete(requestId)
        emit({ type: "permission_resolved", requestId, outcome: "cancelled" })
        reject(new DOMException("Aborted", "AbortError"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
      this.pendingPermissions.set(requestId, (optionId) => {
        signal.removeEventListener("abort", onAbort)
        const kind = options.find((o) => o.optionId === optionId)?.kind ?? "reject_once"
        emit({ type: "permission_resolved", requestId, outcome: kind })
        resolve(kind)
      })
    })
  }

  private async stream(
    emit: (u: SessionUpdate) => void,
    signal: AbortSignal,
    text: string,
    type: "agent_message_chunk" | "agent_thought_chunk",
    delay: number,
  ) {
    const tokens = text.match(/\S+\s*|\s+/g) ?? []
    for (const t of tokens) {
      emit({ type, text: t })
      await sleep(delay, signal)
    }
  }
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const WANTS_REVIEW = /\b(review|check|critique|feedback|comments?|proofread)\b/i
const WANTS_REWRITE = /\b(rewrite|tighten|shorten|narrow|rephrase|fix|edit|improve)\b/i
const WANTS_SUPPORT = /\b(support|evidence|cite|citations?|sources?|back up)\b/i

// Sentences that claim more than they show, with what to do about each
const CLAIMS: { test: RegExp; note: string }[] = [
  { test: /\b(no (work|study|one)|to our knowledge|none of|nobody)\b/i, note: "This says nothing like it exists, which a reading list can't show. Narrow it to what you've read, or search further first." },
  { test: /\b(always|never|every|all) /i, note: "An absolute invites a counterexample. Say where it holds." },
  { test: /\b(clearly|obviously|of course|undoubtedly)\b/i, note: "This asks the reader to take it on trust. Show it, or cite where it's shown." },
  { test: /\b(only|first) (work|study|paper|to)\b/i, note: "\u201cFirst\u201d and \u201conly\u201d are hard to defend. Check the claim or soften it." },
]

function reviewNotes(doc: string): { quote: string; note: string }[] {
  const body = doc.replace(/^---\n[\s\S]*?\n---\n/, "")
  const out: { quote: string; note: string }[] = []
  for (const line of body.split("\n")) {
    if (/^\s*(#|```|\||>)/.test(line)) continue
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const claim = CLAIMS.find((c) => c.test.test(sentence))
      if (claim && sentence.trim().length > 20) out.push({ quote: sentence.trim(), note: claim.note })
    }
  }
  return out
}

// owlit://docs/writing/Related%20work.md → "writing/Related work.md"
function docPath(uri: string) {
  const m = /^owlit:\/\/docs\/(.+)$/.exec(uri)
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : null
}

// A canned rewrite for the seed draft's overclaim; elsewhere, plain tightening
function rewriteOf(text: string): { text: string; why: string } | null {
  const trail = /\s*$/.exec(text)?.[0] ?? ""
  const body = text.slice(0, text.length - trail.length)
  if (/no work has compared learned tool calls with retrieval/i.test(body))
    return {
      text: "Among the studies we have read, none compares learned tool calls with retrieval on the same tasks; [Schick et al. 2023](owlit://library/p6) come closest but evaluate one tool at a time." + trail,
      why: "The sentence claims more than a reading list can show. I narrowed it to what you've read and named the closest work, so a reviewer can check it.",
    }
  const tightened = body
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bdue to the fact that\b/gi, "because")
    .replace(/\ba number of\b/gi, "several")
    .replace(/\bis able to\b/gi, "can")
    .replace(/\b(very|really|quite|basically|actually|just) /gi, "")
    .replace(/\s{2,}/g, " ")
  return tightened !== body ? { text: tightened + trail, why: "I cut the words that weren't carrying meaning." } : null
}

const STOPWORDS = new Set(
  "about above after again against also among because been before being both could does doing down during each from further have having here into itself just more most much must only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with would your already".split(" "),
)

// Library papers that share the passage's words, best first
function relatedPapers(text: string) {
  const words = new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w)))
  const lastName = (a: string) => a.trim().split(/\s+/).pop() ?? a
  return Object.values(useLibraryStore.getState().papers)
    .map((p) => {
      const hay = `${p.title} ${p.abstract ?? ""}`.toLowerCase()
      const shared = [...words].filter((w) => hay.includes(w))
      return { p, shared }
    })
    .filter((x) => x.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, 3)
    .map(({ p, shared }) => ({
      id: p.id,
      title: p.title,
      cite: `${p.authors.length > 2 ? `${lastName(p.authors[0])} et al.` : p.authors.map(lastName).join(" and ")} ${p.year ?? ""}`.trim(),
      reason: `It also deals with ${shared.slice(0, 2).join(" and ")}.`,
    }))
}

function contextAnswer(text: string, sources: Mentionable[], selection?: QuotedSelection) {
  const where = selection ? `the passage you selected in [${selection.source.title}](${selection.source.uri})` : sources[0] ? `[${sources[0].title}](${sources[0].uri})` : "what's on screen"
  return `Reading ${where} with your question in mind ("${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"):

The point rests on one step that isn't argued yet. Saying why that step holds, or citing the work that shows it, would make the rest follow.

Ask me to rewrite the passage or find support for it, and I'll do it in place.`
}

function thoughtFor(text: string, mentions: Mentionable[], selection?: QuotedSelection) {
  if (selection) return `The user selected a passage in "${selection.source.title}" and asked: "${text.slice(0, 80)}". I'll read the doc around it first.`
  const what = mentions.length
    ? `The user referenced ${mentions.length} item${mentions.length > 1 ? "s" : ""} from the workspace, so I should read ${mentions.length > 1 ? "them" : "it"} before answering.`
    : "No workspace items were referenced, so I'll answer from the request itself and check the Library if it helps."
  return `${what} The request is: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}". I'll keep the answer concise and cite sources where I can.`
}

function answerFor(text: string, mentions: Mentionable[]) {
  const cites = mentions.map((m) => `[${m.title}](${m.uri})`)
  const intro = mentions.length
    ? `Here's what I found after reading ${cites.join(", ")}.`
    : "Here's a first pass; mention a paper or doc with `@` if you want me to ground this in your workspace."
  return `${intro}

## Summary

- **Core idea.** ${text.length > 20 ? "The question centres on how the referenced work frames its main contribution and where it sits relative to prior methods." : "This is a mock answer so the interface has something to render."}
- **Evidence.** The sources report consistent gains on the standard benchmarks, though evaluation setups differ enough that direct comparison needs care.
- **Open questions.** Scaling behaviour beyond the reported range and robustness under distribution shift are not addressed.

\`\`\`python
# example: how a citation key might be resolved in owlit
paper = library.get("attention-is-all-you-need")
print(paper.title, paper.year)
\`\`\`

| Aspect | Takeaway |
| --- | --- |
| Method | Attention-based, no recurrence |
| Cost | Lower training compute |
| Limits | Long-context scaling |

Want me to turn this into a note in Docs?`
}
