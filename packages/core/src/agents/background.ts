import type * as acp from "@agentclientprotocol/sdk"
import { RpcErrorCode } from "@owlit/protocol"
import { RpcFailure } from "../rpc/index.ts"
import type { Agents } from "./agents.ts"
import { preamble } from "./rules.ts"

// Agent work that isn't a chat: a session on a local agent that no chat list shows, given one prompt,
// whose answer is the result (a reading note, later a Knowledge update). Nobody is there to answer
// questions, so the only tools it may use are owlit's own read-only ones; anything else is refused, and
// it can't write files: core writes what the answer says.

// owlit-mcp tools a background session may use without asking
const READ_ONLY = /^(mcp__owlit__)?(library_(list|get|read|highlights)|docs_(list|read)|chats_(list|read))$/

export interface BackgroundRun {
  prompt: string
  // The workspace, as the session's cwd
  root: string
  mcpServers: acp.McpServer[]
  signal: AbortSignal
  // An agent to use; the first one that is set up when not given
  connectorId?: string
}

export interface BackgroundResult {
  text: string
  connectorId: string
}

export class Background {
  private readonly agents: Agents

  constructor(agents: Agents) {
    this.agents = agents
  }

  async run(run: BackgroundRun): Promise<BackgroundResult> {
    const connectorId = run.connectorId ?? (await this.pickConnector())
    const proc = await this.agents.process(connectorId)
    let answer = ""
    const refused: string[] = []
    const session = await proc.newSession(
      { cwd: run.root, mcpServers: run.mcpServers },
      {
        update: (n) => {
          if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content.type === "text") answer += n.update.content.text
        },
        requestPermission: async (r) => {
          const name = r.toolCall.title ?? ""
          const allow = READ_ONLY.test(name) ? r.options.find((o) => o.kind === "allow_once") : undefined
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
      },
    )
    const cancel = () => void proc.cancel({ sessionId: session.sessionId }).catch(() => undefined)
    run.signal.addEventListener("abort", cancel, { once: true })
    try {
      const response = await proc.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: preamble(run.root) }, { type: "text", text: run.prompt }] })
      run.signal.throwIfAborted()
      if (response.stopReason === "refusal") throw new Error("The agent declined.")
      if (!answer.trim()) throw new Error(refused.length ? `The agent wanted tools it may not use here (${refused.join(", ")}).` : "The agent said nothing.")
      return { text: answer, connectorId }
    } finally {
      run.signal.removeEventListener("abort", cancel)
      await proc.closeSession(session.sessionId).catch(() => undefined)
    }
  }

  // The first agent that is installed and signed in, Claude Code first
  private async pickConnector() {
    const all = await this.agents.list()
    const ready = all.filter((c) => c.status === "available" || c.status === "connected")
    const chosen = ready.find((c) => c.id === "claude-code") ?? ready[0]
    if (!chosen) throw new RpcFailure(RpcErrorCode.Unavailable, "No agent is set up to work in the background.")
    return chosen.id
  }
}
