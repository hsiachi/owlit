import { DEFAULT_ROLE, type AgentQuestion, type QuestionAnswer, type ToolInfo, type ToolKind } from "@owlit/protocol"
import { useLibraryStore } from "@/features/library/store"
import type { Connector, Mentionable, PermissionKind, QuotedSelection, SessionUpdate, StopReason } from "../types"
import { builtInConnectors, mockCheckResults } from "../mocks/connectors"
import { getWorkspaceFs, getWorkspaceKnowledge, getWorkspaceNotes, type AgentClient, type PromptRequest } from "./client"
import { recordResult, setMockUndo } from "../results"

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

// A Reviewer never writes; a Co-author writes without asking; an Assistant asks first
const READ_ONLY_ROLES = new Set<string>(["reviewer"])
const AUTO_ROLES = new Set<string>(["coauthor"])

// Simulates an ACP agent turn: thinking, tool calls, an optional permission
// request, and a streamed markdown answer. Enough to exercise every UI state.
export class MockAgentClient implements AgentClient {
  private pendingPermissions = new Map<string, (optionId: string) => void>()
  private pendingQuestions = new Map<string, (answers: Record<string, QuestionAnswer> | null) => void>()

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

  answerQuestion(_chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) {
    this.pendingQuestions.get(requestId)?.(answers)
    this.pendingQuestions.delete(requestId)
  }

  async prompt(
    req: PromptRequest,
    emit: (u: SessionUpdate) => void,
    signal: AbortSignal,
  ): Promise<StopReason> {
    const { text, mentions, attachments, context = [], selection } = req.input
    const mode: string = req.role ?? DEFAULT_ROLE
    // What the agent reads first: everything mentioned, plus what was on screen
    const sources = [...mentions, ...context.filter((c) => !mentions.some((m) => m.uri === c.uri))]
    try {
      await this.stream(emit, signal, thoughtFor(text, sources, selection), "agent_thought_chunk", 18)

      await sleep(300, signal)
      for (const m of sources) await this.readTool(emit, signal, m)

      // Asked about a line of Knowledge: what the user says corrects that one line
      if (selection?.source.kind === "knowledge") return await this.reviseKnowledge(emit, signal, selection, text, req.chatId)

      // Asked from the paper's note: the note is the user's, so a rewrite is proposed in it, not made
      if (selection?.notePath && WANTS_REWRITE.test(text)) return await this.proposeNoteEdit(emit, signal, selection, mode)

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
      // Handed-off work: search outside, add what fits, and say what changed under the answer
      if (WANTS_FIND_AND_ADD.test(text)) return await this.findAndAdd(emit, signal, req.chatId)
      // Commands, web searches and pages, as Claude Code runs them, and a question for the user
      if (/\bweb\b/i.test(text)) return await this.webResearch(emit, signal)
      if (/\b(ask me|questions?)\b/i.test(text)) return await this.askQuestions(emit, signal)
      // Lets the browser build show a reply that broke
      if (/\bfail(s|ed)? on purpose\b/i.test(text)) {
        await sleep(600, signal)
        throw new Error("The agent process exited (code 1)")
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
        emit({ type: "tool_call", toolCallId: id, title: "mcp__owlit__library_search", kind: "search", status: "in_progress", tool: { name: "mcp__owlit__library_search" } })
        await sleep(900, signal)
        emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: "8 papers matched; shortlisted 3 by relevance." })
      }

      if (READ_ONLY_ROLES.has(mode)) {
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
      if (wantsWrite && !READ_ONLY_ROLES.has(mode)) {
        const target = mentions.find((m) => m.kind === "doc")?.title ?? "notes/untitled.md"
        const toolCallId = `tc-${crypto.randomUUID()}`
        const oldText = "# Notes\n\nA first line.\n"
        const newText = `# Notes\n\nA first line, now with the point it makes.\n\n## Related work\n\nThree papers frame the question differently; each is summarised below with what it found.\n`
        emit({ type: "tool_call", toolCallId, title: `Edit ${target}`, kind: "edit", status: "pending", locations: [{ path: `docs/${target}` }], diff: { path: target, oldText, newText }, tool: { name: "Edit", path: target } })
        let outcome: PermissionKind = "allow_once"
        if (!AUTO_ROLES.has(mode)) {
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

  // Finds papers outside the library and adds the ones that fit, as a hand-off does
  private async findAndAdd(emit: (u: SessionUpdate) => void, signal: AbortSignal, chatId: string): Promise<StopReason> {
    emit({ type: "plan", entries: FIND_PLAN.map((content, i) => ({ content, priority: "medium", status: i === 0 ? "in_progress" : "pending" })) })
    const step = async (title: string, kind: "search" | "read" | "other", ms: number, content: string, done: number) => {
      const id = `tc-${crypto.randomUUID()}`
      emit({ type: "tool_call", toolCallId: id, title, kind, status: "in_progress" })
      await sleep(ms, signal)
      emit({ type: "tool_call_update", toolCallId: id, status: "completed", content })
      emit({ type: "plan", entries: FIND_PLAN.map((c, i) => ({ content: c, priority: "medium", status: i < done ? "completed" : i === done ? "in_progress" : "pending" })) })
    }
    await step("Searched Semantic Scholar", "search", 1800, "14 results", 1)
    await step("Searched OpenAlex", "search", 1500, "9 results, 5 new", 1)
    await step("Read 6 abstracts", "read", 2500, "Kept 3", 2)
    const added = FOUND.map((p) => useLibraryStore.getState().addPaper(p, "agent"))
    for (const paper of added) {
      const versionId = `mock-${crypto.randomUUID()}`
      setMockUndo(versionId, () => useLibraryStore.getState().removePapers([paper.id]))
      recordResult(chatId, { kind: "paper", versionId, path: paper.id, label: paper.title, at: Date.now() })
    }
    await step(`Added ${added.length} papers to the Library`, "other", 400, added.map((p) => p.title).join("\n"), 3)
    await this.stream(emit, signal, FOUND_ANSWER, "agent_message_chunk", 12)
    return "end_turn"
  }

  // An edit to the paper's note: shown in the note as a diff, written only once allowed
  private async proposeNoteEdit(emit: (u: SessionUpdate) => void, signal: AbortSignal, selection: QuotedSelection, mode: string): Promise<StopReason> {
    const path = selection.notePath!
    const paperId = path.split("/")[2]
    const library = useLibraryStore.getState()
    const before = library.notes[paperId]?.content ?? ""
    const rewritten = rewriteOf(selection.text) ?? shorterOf(selection.text)
    await sleep(300, signal)
    if (!before.includes(selection.text)) {
      await this.stream(emit, signal, "I couldn't find that passage in your note word for word (formatting gets in the way), so I left it alone.", "agent_message_chunk", 14)
      return "end_turn"
    }
    if (!rewritten) {
      await this.stream(emit, signal, "This already reads tight; I'd leave it as it is.", "agent_message_chunk", 14)
      return "end_turn"
    }
    await this.stream(emit, signal, rewritten.why + "\n\n", "agent_message_chunk", 14)
    const title = `your note on ${selection.source.title}`
    const toolCallId = `tc-${crypto.randomUUID()}`
    const diff = { path, oldText: before, newText: before.replace(selection.text, rewritten.text) }
    emit({ type: "tool_call", toolCallId, title: `Edit ${title}`, kind: "edit", status: "pending", locations: [{ path }], diff })
    let outcome: PermissionKind = "allow_once"
    if (!AUTO_ROLES.has(mode)) outcome = await this.askPermission(emit, signal, toolCallId, `Edit ${title}`)
    if (outcome.startsWith("reject")) {
      emit({ type: "tool_call_update", toolCallId, status: "failed", content: "Edit rejected by the user." })
      await this.stream(emit, signal, "Left your note as it was.", "agent_message_chunk", 14)
      return "end_turn"
    }
    // Read again before writing: the user may have kept typing while the edit waited
    const now = useLibraryStore.getState().notes[paperId]?.content ?? ""
    if (!now.includes(selection.text)) {
      emit({ type: "tool_call_update", toolCallId, status: "failed", content: "The passage changed while the edit waited." })
      await this.stream(emit, signal, "That passage changed while I waited, so I left the note alone.", "agent_message_chunk", 14)
      return "end_turn"
    }
    useLibraryStore.getState().setNote(paperId, now.replace(selection.text, rewritten.text))
    emit({ type: "tool_call_update", toolCallId, status: "completed", content: `Edited ${title}` })
    await this.stream(emit, signal, "Done. ⌘Z in the note takes it back.", "agent_message_chunk", 14)
    return "end_turn"
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
    const diff = { path, oldText: before, newText: replacePassage(before, selection, rewritten.text) }
    emit({ type: "tool_call", toolCallId, title: `Edit ${title}`, kind: "edit", status: "pending", locations: [{ path }], diff })
    let outcome: PermissionKind = "allow_once"
    if (!AUTO_ROLES.has(mode)) outcome = await this.askPermission(emit, signal, toolCallId, `Edit ${title}`)
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
    await fs.writeTextFile(path, replacePassage(now, selection, rewritten.text))
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

  // Restates a Knowledge line from what the user said, changing that line and nothing else
  private async reviseKnowledge(emit: (u: SessionUpdate) => void, signal: AbortSignal, selection: QuotedSelection, said: string, chatId: string): Promise<StopReason> {
    const toolCallId = `tc-${crypto.randomUUID()}`
    await this.readTool(emit, signal, selection.source)
    await sleep(400, signal)
    const r = getWorkspaceKnowledge()?.reviseLine({ uri: selection.source.uri, said, chatId, callId: toolCallId })
    if (!r) {
      await this.stream(emit, signal, "That line isn't in the topic any more, so there is nothing to change.", "agent_message_chunk", 14)
      return "end_turn"
    }
    if (!r.changed) {
      await this.stream(emit, signal, `I've kept what you asked beside “${r.words}” in ${r.topic}, but left the line as it is: a question doesn't change what it says. Tell me how it should read and I'll rewrite it.`, "agent_message_chunk", 14)
      return "end_turn"
    }
    emit({ type: "tool_call", toolCallId, title: `Updated · ${r.topic} · “${r.words}”`, kind: "edit", status: "completed", locations: [{ path: r.path, line: r.position }], content: r.text })
    const what = r.how === "rewrote" ? `I've rewritten the line in ${r.topic} in your words. It stays as you put it from now on:` : `I've kept the line in ${r.topic} and noted what you said beside it:`
    await this.stream(emit, signal, `${what}\n\n> ${r.text}`, "agent_message_chunk", 14)
    return "end_turn"
  }

  private async readTool(emit: (u: SessionUpdate) => void, signal: AbortSignal, m: Mentionable) {
    const id = `tc-${crypto.randomUUID()}`
    const verb = m.kind === "paper" ? "Reading paper" : "Reading"
    // A Knowledge item lives in its topic's file; a line or a question names the topic as its source
    const topic = m.subtitle?.startsWith("Question · ") ? m.subtitle.slice("Question · ".length) : m.title
    const path =
      m.kind === "paper"
        ? `library/papers/${slug(m.title)}/digest.md`
        : m.kind === "doc"
          ? `docs/${m.subtitle ?? ""}${m.title}`
          : `knowledge/${topic}.md`
    emit({ type: "tool_call", toolCallId: id, title: `${verb} ${m.title}`, kind: "read", status: "in_progress", locations: [{ path }], tool: { name: "Read", path } })
    await sleep(700, signal)
    emit({ type: "tool_call_update", toolCallId: id, status: "completed", content: `Read ${path} (${Math.floor(Math.random() * 60 + 20)} lines)` })
  }

  // Reads around with commands, searches the web and opens pages, the way Claude Code works through a
  // question, so the browser build shows long step lists, folded rows and a failure
  private async webResearch(emit: (u: SessionUpdate) => void, signal: AbortSignal): Promise<StopReason> {
    const step = async (title: string, kind: ToolKind, tool: ToolInfo, content: string, ms = 600, status: "completed" | "failed" = "completed") => {
      const id = `tc-${crypto.randomUUID()}`
      emit({ type: "tool_call", toolCallId: id, title, kind, status: "in_progress", tool })
      await sleep(ms, signal)
      emit({ type: "tool_call_update", toolCallId: id, status, content })
    }
    const dir = "~/Documents/research/2026-10 kickoff"
    await step(`cat "Proactive Support/story.md"; ls -la "Proactive Support/"`, "execute", { name: "Bash", command: `cat "Proactive Support/story.md"; ls -la "Proactive Support/"`, description: "Read story.md and list its folder" }, "```console\n# Story\n\n## Background\nAgents can remind people proactively…\n```")
    await step(`cd ${dir}; cat proposal-v0.5.md lit-check.md`, "execute", { name: "Bash", command: `cd ${dir}; cat proposal-v0.5.md lit-check.md`, description: "Read proposal v0.5 and the lit check" }, "```\nExit code 1\n# Proposal v0.5\ncat: lit-check.md: No such file or directory\n```", 600, "failed")
    await step(`cd ${dir}; cat feasibility.md`, "execute", { name: "Bash", command: `cd ${dir}; cat feasibility.md`, description: "Read the feasibility comparison" }, "```console\n# Feasibility\n\n1. Current judgement…\n```")
    await step("ToolSearch", "other", { name: "ToolSearch" }, "Tool: WebSearch\nTool: WebFetch", 200)
    await step(`Search "prospective memory definition"`, "fetch", { name: "WebSearch", query: "prospective memory definition Einstein McDaniel" }, "Prospective memory (https://en.wikipedia.org/wiki/Prospective_memory)\nMark A. McDaniel (https://en.wikipedia.org/wiki/Mark_A._McDaniel)\nProspective Memory · Encyclopedia (https://link.springer.com/referenceworkentry/10.1007/978-0-387-79948-3_1144)")
    await step(`Search "proactive agent definition"`, "fetch", { name: "WebSearch", query: "proactive agent definition ContextAgent wearable" }, "ContextAgent: Context-Aware Proactive LLM Agents (https://arxiv.org/abs/2505.14668)\nProactive Agent: Shifting LLM Agents from Reactive Responses to Active Assistance (https://arxiv.org/abs/2410.12361)")
    for (const [url, title] of [
      ["https://arxiv.org/abs/2403.01365", "AI-Powered Reminders for Collaborative Tasks: Experiences and Futures"],
      ["https://arxiv.org/abs/2507.21378", "ProMemAssist: Exploring Timely Proactive Assistance Through Working Memory Modeling"],
      ["https://arxiv.org/abs/2605.23085", "Remind Me To Check The Stove Before I Leave The House"],
    ])
      await step(`Fetch ${url}`, "fetch", { name: "WebFetch", url }, `**Title:** ${title}\n\n**Year:** 2024\n\nA short summary of what the page says.`, 700)
    await sleep(300, signal)
    await this.stream(emit, signal, "I read the story and the kickoff notes, then checked the papers the background leans on. Two files had moved, so I read them by their new names.", "agent_message_chunk", 14)
    return "end_turn"
  }

  // Asks two questions, as Claude Code's AskUserQuestion does, and says what it heard
  private async askQuestions(emit: (u: SessionUpdate) => void, signal: AbortSignal): Promise<StopReason> {
    const toolCallId = `tc-${crypto.randomUUID()}`
    emit({ type: "tool_call", toolCallId, title: "Asking for your input", kind: "other", status: "pending", tool: { name: "AskUserQuestion" } })
    const requestId = `q-${crypto.randomUUID()}`
    const questions: AgentQuestion[] = [
      { id: "question_0", header: "Perception", question: "By “Perception dimensions”, which do you mean?", allowsText: true, options: [{ label: "Reason categories", description: "Drawn from people's own reasons" }, { label: "Rating scales", description: "Rated on given dimensions at the follow-up" }, { label: "Not decided", description: "Write it as v0.5 does" }] },
      { id: "question_1", header: "Venue", question: "Still submitting to IMWUT on 11/1?", allowsText: true, options: [{ label: "Yes", description: "Keep the v0.5 timeline" }, { label: "Later", description: "Decide after the pilot" }] },
    ]
    emit({ type: "question_request", requestId, toolCallId, questions })
    const answers = await new Promise<Record<string, QuestionAnswer> | null>((resolve, reject) => {
      const onAbort = () => {
        this.pendingQuestions.delete(requestId)
        emit({ type: "question_resolved", requestId, outcome: "cancelled" })
        reject(new DOMException("Aborted", "AbortError"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
      this.pendingQuestions.set(requestId, (a) => {
        signal.removeEventListener("abort", onAbort)
        emit({ type: "question_resolved", requestId, outcome: a ? "answered" : "skipped", ...(a ? { answers: a } : {}) })
        resolve(a)
      })
    })
    emit({ type: "tool_call_update", toolCallId, status: "completed" })
    const said = answers ? questions.map((q) => [...(answers[q.id]?.picks ?? []), answers[q.id]?.text].filter(Boolean).join(", ") || "no answer").join("; ") : "nothing yet"
    await this.stream(emit, signal, `Thanks. I heard: ${said}. I'll write the background with that in mind.`, "agent_message_chunk", 14)
    return "end_turn"
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

// The selected passage replaced: the occurrence nearest where it was selected, as written (no $ patterns)
function replacePassage(doc: string, selection: QuotedSelection, text: string) {
  const near = selection.from ?? 0
  let at = -1
  for (let i = doc.indexOf(selection.text); i >= 0; i = doc.indexOf(selection.text, i + 1))
    if (at < 0 || Math.abs(i - near) < Math.abs(at - near)) at = i
  return at < 0 ? doc : doc.slice(0, at) + text + doc.slice(at + selection.text.length)
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

// Elsewhere in a note, plain shortening: the first sentence, when the rest only says it again
function shorterOf(text: string): { text: string; why: string } | null {
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (!sentences || sentences.length < 2) return null
  return { text: sentences[0].trim(), why: "I kept your first sentence; the rest said it again. Your point stays the same." }
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
  if (selection?.source.kind === "knowledge") return `The user is telling me about a line in the topic "${selection.source.title}": "${text.slice(0, 80)}". I'll read the topic, then change that one line to follow what they said, keeping its sources.`
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

// ---- Finding and adding papers (the browser build's hand-off) ----

const WANTS_FIND_AND_ADD = /\bfind\b.*\bpapers?\b|\badd (them|the ones|papers)\b/i

const FIND_PLAN = ["Search two sources", "Read the abstracts, keep the best three", "Add them to the Library"]

const FOUND = [
  { title: "Explanations After the Task: When Users Read Them", authors: ["Sato, K.", "Park, J."], year: 2025, venue: "CHI", ids: { doi: "10.1145/mock.sato2025" } },
  { title: "Putting It Off: Deferrable Explanations in Assistants", authors: ["Okafor, A."], year: 2024, venue: "IUI", ids: { doi: "10.1145/mock.okafor2024" } },
  { title: "Deferral in Code Review Tools", authors: ["Lind, E.", "Berg, S."], year: 2023, venue: "CSCW", ids: { doi: "10.1145/mock.lind2023" } },
]

const FOUND_ANSWER = `Added three papers that fit. Two others came close but are about interruptions, not explanations, so I listed them without adding them.

1. **Sato 2025**: explanations shown after the task were read twice as often. Closest to your question.
2. **Okafor 2024**: lets users put an explanation off and measures whether they come back to it.
3. **Lind 2023**: deferral in code review tools; a smaller study pointing the same way.

Close but not added: Park 2024 (interruption cost, no explanations) and Hsu 2023 (notifications).`
