import type * as acp from "@agentclientprotocol/sdk"
import type { MemoryLine, SessionUpdate } from "@owlit/protocol"
import { withoutAgentError } from "@owlit/protocol"
import type { Agents } from "./agents.ts"
import type { AgentFs } from "./fs.ts"
import type { Who } from "./policy.ts"
import { flatValues } from "./process.ts"
import { backgroundMeta, bareToolTitle, guardFor, isOwlitCall, roots } from "./profiles.ts"
import { answerFor, takesRules } from "./roles.ts"
import { memoryNote, preamble } from "./rules.ts"
import { failureOf } from "./failure.ts"
import { agentNotice, agentWork, toKind, toUpdate, type HelperReports } from "./updates.ts"

// Agent work that isn't a chat: a session on a local agent that no chat list shows, given one prompt,
// whose answer is the result, or whose work goes through owlit's tools. Nobody is
// there to answer questions. What the agent asks to do with its own tools is decided by the policy, as a
// chat's is (roles.ts answerFor), for a run with a Reviewer's role: it changes nothing of the user's and
// runs no commands, and anything left to a person is refused. owlit's own tools are held to the run's
// list, and the router's policy decides each call as it arrives. It can't write files: core writes what
// the answer says.

const log = (line: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[background] ${line}`)

// owlit-mcp tools every run may use: reading the workspace, not searching the web or moving the window
const READ_ONLY = /^(library_(list|get|read|highlights)|docs_(list|read)|chats_(list|read)|thread_(list|read)|activity_read|owlit_help)$/


export interface BackgroundRun {
  prompt: string
  // The workspace, as the session's cwd
  root: string
  mcpServers: acp.McpServer[]
  signal: AbortSignal
  // An agent to use; the first one that is set up when not given
  connectorId?: string
  // Further tools this run may use (a thread run writes the thread)
  allow?: RegExp
  // The run it is ("<kind>:<task id>"), as owlit-mcp signs its calls
  run?: string
  // The model each agent uses here, when not its default (Settings › Owlit › Background work)
  models?: Record<string, string>
  // Owlit's memory of the user, said after the rules
  memory?: MemoryLine[]
  // Each step and word of the answer as it comes, for the run's session (the hidden chat that shows it)
  onUpdate?: (update: SessionUpdate) => void
}

// A run that failed, in owlit's words (failure.ts), with how the agent's process ended when it did.
// final: another try fails the same way until something changes (the agent's usage limit).
export class BackgroundFailure extends Error {
  readonly detail?: string
  readonly final: boolean

  constructor(text: string, detail?: string, final = false) {
    super(text)
    this.detail = detail
    this.final = final
  }
}

export interface BackgroundResult {
  text: string
  connectorId: string
  // The model chosen for background work, when one is and the agent offers it
  model?: string
}

export class Background {
  private readonly agents: Agents
  private readonly fs: AgentFs

  constructor(agents: Agents, fs: AgentFs) {
    this.agents = agents
    this.fs = fs
  }

  async run(run: BackgroundRun): Promise<BackgroundResult> {
    const connectorId = await this.agents.forWork(run.connectorId)
    // The answer so far: when the agent fails, its last words may be its own account of the error
    let answer = ""
    try {
      return await this.session(run, connectorId, (text) => (answer = text))
    } catch (error) {
      if (run.signal.aborted) throw error
      const said = withoutAgentError({ id: "", role: "assistant", createdAt: 0, status: "error", parts: [{ type: "text", text: answer }] }).errorDetail ?? ""
      const { text, detail, final } = await failureOf(this.agents, connectorId, error, said)
      throw new BackgroundFailure(text, detail, final)
    }
  }

  private async session(run: BackgroundRun, connectorId: string, wrote: (answer: string) => void): Promise<BackgroundResult> {
    const proc = await this.agents.process(connectorId)
    run.signal.throwIfAborted()
    let answer = ""
    // Text after a tool call is another message: kept apart, so words before the result don't run
    // into its first line ("I'll read the rest.# Title")
    let apart = false
    const refused: string[] = []
    const reports: HelperReports = { agentText: new Map() }
    // Agents that ask before each of owlit's tools are held to the run's list when they ask, below; one
    // that calls them itself is told which it may offer (backgroundMeta)
    const _meta = backgroundMeta(connectorId, [READ_ONLY.source, ...(run.allow ? [run.allow.source] : [])], run.root)
    const tools = new RegExp(`${READ_ONLY.source}${run.allow ? `|${run.allow.source}` : ""}`)
    const session = await proc.newSession(
      { cwd: run.root, mcpServers: run.mcpServers, ...(_meta ? { _meta } : {}) },
      {
        update: (n, agentId) => {
          // The agent's own agents' work is shown as theirs, and their words are never the answer
          if (agentId) {
            for (const update of agentWork(reports, agentId, n.update, run.root)) run.onUpdate?.(update)
            return
          }
          const update = run.onUpdate && toUpdate(n.update, run.root)
          if (update) run.onUpdate!(update)
          if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content.type === "text") {
            if (apart && answer) answer += "\n\n"
            apart = false
            answer += n.update.content.text
            wrote(answer)
          }
          if (n.update.sessionUpdate === "tool_call") {
            apart = true
            log(`tool ${n.update.title}`)
          }
          if (n.update.sessionUpdate === "tool_call_update" && n.update.status === "failed") log(`tool failed ${n.update.toolCallId}`)
        },
        requestPermission: async (r) => {
          const name = r.toolCall.title ?? ""
          // One of owlit's tools on the run's list goes ahead (the router's policy decides the call when it
          // arrives); anything else is the engine's own, for the policy
          const allowed = tools.test(bareToolTitle(name)) || (!isOwlitCall(r.toolCall) && (await this.answer(run, r.toolCall).catch(() => "ask" as const)) === "allow")
          log(`${allowed ? "allowed" : "refused"} ${name}`)
          const allow = allowed ? r.options.find((o) => o.kind === "allow_once") : undefined
          if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } }
          refused.push(name)
          const reject = r.options.find((o) => o.kind === "reject_once")
          return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } }
        },
        readTextFile: async () => {
          throw new Error("A background session reads through owlit's tools.")
        },
        writeTextFile: async () => {
          throw new Error("A background session doesn't write files; its answer is the result.")
        },
        // Nobody is there to answer a question
        createElicitation: async () => ({ action: "decline" }),
        agent: (notice) => {
          for (const update of agentNotice(notice)) run.onUpdate?.(update)
        },
      },
    )
    const cancel = () => void proc.cancel({ sessionId: session.sessionId }).catch(() => undefined)
    run.signal.addEventListener("abort", cancel, { once: true })
    try {
      // Cancelled while the session was starting: the listener above came too late to hear it
      run.signal.throwIfAborted()
      // The agent's own default mode (acceptEdits, bypassPermissions, Codex's agent) would let it edit or
      // run things without asking, and requestPermission only refuses what is asked: the session takes a
      // Reviewer's mode (Codex's read-only), else one that asks first. (Not plan mode: Claude Code then
      // ends by asking to leave it, which nobody can answer here.)
      await setMode(proc, session, [...guardFor(connectorId, "reviewer", roots(run.root)).modes, "default"])
      const chosen = run.models?.[connectorId]
      const model = chosen && (await setModel(proc, session, chosen)) ? chosen : undefined
      const init = await proc.initialized()
      // An agent that takes owlit's rules in its system prompt has them already
      const rules: acp.ContentBlock[] = takesRules(init) ? [] : [{ type: "text", text: preamble(run.root) }]
      // Background work follows owlit's memory too (how the user wants Owlit to work)
      if (run.memory?.length) rules.push({ type: "text", text: memoryNote(run.memory, false) })
      const response = await proc.prompt({ sessionId: session.sessionId, prompt: [...rules, { type: "text", text: run.prompt }] })
      run.signal.throwIfAborted()
      log(`answered (${response.stopReason}): ${answer.slice(0, 600)}`)
      if (response.stopReason === "refusal") throw new Error("The agent declined.")
      if (!answer.trim()) throw new Error(refused.length ? `The agent wanted tools it may not use here (${refused.join(", ")}).` : "The agent said nothing.")
      return { text: answer, connectorId, ...(model ? { model } : {}) }
    } finally {
      run.signal.removeEventListener("abort", cancel)
      await proc.closeSession(session.sessionId).catch(() => undefined)
    }
  }

  // An engine's own request, as the policy answers it for a run working with a Reviewer's role
  private async answer(run: BackgroundRun, call: acp.ToolCallUpdate) {
    const caller = { kind: "owlit", run: run.run ?? "background" } as const
    const who: Who = { caller, actor: await this.fs.actorOf(caller), role: "reviewer" }
    const paths = [...(call.locations ?? []).map((l) => l.path), ...(call.content ?? []).flatMap((c) => (c.type === "diff" ? [c.path] : []))]
    return answerFor(who, toKind(call.kind), await this.fs.target(paths))
  }

}

// The model set on the session if the agent still offers it (true); otherwise its default stays
async function setModel(proc: Awaited<ReturnType<Agents["process"]>>, session: acp.NewSessionResponse, model: string) {
  const option = session.configOptions?.find((o) => o.category === "model" && o.type === "select")
  if (!option || option.type !== "select") return false
  if (option.currentValue === model) return true
  const values = flatValues(option.options)
  if (values.includes(model)) {
    await proc.setConfigOption({ sessionId: session.sessionId, configId: option.id, value: model })
    return true
  }
  log(`model ${model} isn't offered any more; the agent's default is used`)
  return false
}

// The first of these modes the agent offers, set on the session: as a config option (category mode) or,
// for an agent without those, as a session mode
async function setMode(proc: Awaited<ReturnType<Agents["process"]>>, session: acp.NewSessionResponse, modes: string[]) {
  const option = session.configOptions?.find((o) => o.category === "mode" && o.type === "select")
  if (option && option.type === "select") {
    const mode = modes.find((m) => flatValues(option.options).includes(m))
    if (mode && option.currentValue !== mode) await proc.setConfigOption({ sessionId: session.sessionId, configId: option.id, value: mode })
  } else {
    const mode = modes.find((m) => session.modes?.availableModes.some((a) => a.id === m))
    if (mode && session.modes?.currentModeId !== mode) await proc.setMode({ sessionId: session.sessionId, modeId: mode })
  }
}
