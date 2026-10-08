import type { Connector, Mentionable, PermissionKind, SessionUpdate, StopReason } from "../types"
import { builtInConnectors, mockCheckResults } from "../mocks/connectors"
import type { AgentClient, PromptRequest } from "./client"

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
    const { text, mentions, attachments } = req.input
    const mode = req.modeId ?? ""
    try {
      await this.stream(emit, signal, thoughtFor(text, mentions), "agent_thought_chunk", 18)

      await sleep(300, signal)
      for (const m of mentions) await this.readTool(emit, signal, m)

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

function thoughtFor(text: string, mentions: Mentionable[]) {
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
