// Agents of the engine's own: the `agent` tool hands one part of the work to a fresh agent in the same
// process, with the same model and the same tools (bar this one), and gives back its report. Several run
// at once when the model calls the tool several times in one go (pi-agent-core runs a batch in parallel).
//
// Each agent works in a session of its own, announced to owlit the way ACP's draft for subagents says
// (subagent_update on the chat's session, then everything of the agent's on its own session), so owlit
// shows it as it shows Claude Code's agents and holds its file requests to the chat's role.

import type * as acp from "@agentclientprotocol/sdk"
import { Agent, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core"
import type { Api, Model, Models } from "@earendil-works/pi-ai"
import { Type } from "typebox"
import { updatesFor, type ToolInfo } from "./updates.ts"

// At most this many agents work at a time; the rest wait their turn
const AT_ONCE = 4

export interface AgentToolOptions {
  conn: acp.AgentSideConnection
  // The chat's session, which the agents work for
  sessionId: string
  models: Models
  // The model and effort the chat's session has when an agent starts
  current: () => { model: Model<Api>; thinking: ThinkingLevel }
  systemPrompt: string
  // The tools an agent gets, made for its own session (its file requests then say whose they are)
  toolsFor: (agentSessionId: string) => { tools: AgentTool[]; info: (name: string) => ToolInfo | undefined }
}

export const AGENT_TOOL = "agent"

// The agent tool's own step isn't shown: owlit shows the agent itself, where it was handed out
export const agentToolInfo: ToolInfo = { title: "Agent", kind: "think", hidden: true }

export function agentTool(options: AgentToolOptions): AgentTool {
  let running = 0
  const waiting: (() => void)[] = []
  const slot = async () => {
    if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
  }
  const release = () => {
    running--
    waiting.shift()?.()
  }
  const announce = (update: Record<string, unknown>) =>
    options.conn.sessionUpdate({ sessionId: options.sessionId, update: { sessionUpdate: "subagent_update", ...update } } as unknown as acp.SessionNotification)

  return {
    name: AGENT_TOOL,
    label: "Agent",
    description:
      "Hand one self-contained part of the work to an agent of your own. It has your tools (except this one), works on its own and gives you back its report. Call this tool several times in one go to run agents at the same time (for example one per line of a literature review). The user sees each agent by its task.",
    parameters: Type.Object({
      task: Type.String({ description: "The task in a few words, as the user will see it (\"Lit review: interruptions & bystanders\")" }),
      prompt: Type.String({ description: "Everything the agent needs to do the task well: what to do, what to read, what to hand back. It doesn't see this conversation." }),
    }),
    execute: async (toolCallId, params, signal) => {
      const { task, prompt } = params as { task: string; prompt: string }
      const sessionId = `${options.sessionId}:agent:${toolCallId}`
      await announce({ sessionId, title: task, description: prompt, state: { state: "running" } })
      await slot()
      const { model, thinking } = options.current()
      const tools = options.toolsFor(sessionId)
      const agent = new Agent({
        initialState: { systemPrompt: options.systemPrompt, model, thinkingLevel: thinking, tools: tools.tools, messages: [] },
        streamFn: options.models.streamSimple.bind(options.models),
        sessionId,
      })
      agent.subscribe(async (event) => {
        for (const update of updatesFor(event, tools.info)) await options.conn.sessionUpdate({ sessionId, update })
      })
      const stop = () => agent.abort()
      signal?.addEventListener("abort", stop)
      try {
        await agent.prompt({ role: "user", content: prompt, timestamp: Date.now() })
      } finally {
        signal?.removeEventListener("abort", stop)
        release()
      }
      const last = agent.state.messages.at(-1)
      const stopReason = last?.role === "assistant" ? last.stopReason : undefined
      if (stopReason === "aborted" || signal?.aborted) {
        await announce({ sessionId, state: { state: "cancelled" } })
        throw new Error(`The agent for “${task}” was stopped.`)
      }
      if (stopReason === "error") {
        await announce({ sessionId, state: { state: "failed" } })
        throw new Error(`The agent for “${task}” failed: ${last?.role === "assistant" && last.errorMessage ? last.errorMessage : "the model stopped with an error"}`)
      }
      const report = last?.role === "assistant" ? last.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim() : ""
      await announce({ sessionId, state: { state: "idle" } })
      return { content: [{ type: "text", text: report || "The agent finished without a report." }], details: undefined }
    },
  }
}
