// One conversation on the engine: pi-agent-core's loop with owlit's tools, a model and an effort, and its
// transcript kept in the workspace (<workspace>/.owlit/engine/<id>.jsonl) so a chat can go on after a
// restart and moves with the folder.

import type * as acp from "@agentclientprotocol/sdk"
import { Agent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core"
import type { Api, Model, Models } from "@earendil-works/pi-ai"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { modelKey } from "./models.ts"
import type { Toolbox } from "./tools.ts"
import { updatesFor } from "./updates.ts"

// The engine's own instructions. owlit's rules reach it as they reach every agent: before the first
// prompt of a session.
const SYSTEM_PROMPT = `You are Owlit, the assistant inside owlit, a research workspace for reading papers and writing about them.
You work only through the tools you are given. You can't run commands or browse the web; for papers, use owlit's library tools.
To change a file, read it with read_file first, then use edit_file (or write_file for a new doc), when you have them. They are the only way to change files.
Answer in Markdown. Keep answers to what the user asked.`

export const EFFORTS: { id: ThinkingLevel; name: string }[] = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Extra high" },
]
const DEFAULT_EFFORT: ThinkingLevel = "medium"

interface Saved {
  model?: string
  effort?: ThinkingLevel
  messages: AgentMessage[]
}

export interface SessionInit {
  id: string
  cwd: string
  models: Models
  available: Model<Api>[]
  toolbox: Toolbox
  saved?: Saved
  // Whether the transcript is kept; a background run is never picked up again, so it isn't
  persist: boolean
  send: (update: acp.SessionUpdate) => Promise<void>
}

export class EngineSession {
  readonly id: string
  readonly cwd: string
  private readonly agent: Agent
  private readonly init: SessionInit
  private model: Model<Api>
  private effort: ThinkingLevel

  constructor(init: SessionInit) {
    this.init = init
    this.id = init.id
    this.cwd = init.cwd
    this.model = init.available.find((m) => modelKey(m) === init.saved?.model) ?? defaultModel(init.available)
    this.effort = init.saved?.effort ?? DEFAULT_EFFORT
    this.agent = new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, thinkingLevel: this.thinking(), tools: init.toolbox.tools, messages: init.saved?.messages ?? [] },
      streamFn: init.models.streamSimple.bind(init.models),
      sessionId: init.id,
    })
    this.agent.subscribe(async (event) => {
      for (const update of updatesFor(event, init.toolbox.info)) await init.send(update)
    })
  }

  static file(cwd: string, id: string) {
    return path.join(cwd, ".owlit", "engine", `${id}.jsonl`)
  }

  static async read(cwd: string, id: string): Promise<Saved | null> {
    let text: string
    try {
      text = await readFile(EngineSession.file(cwd, id), "utf8")
    } catch {
      return null
    }
    const saved: Saved = { messages: [] }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      const entry = JSON.parse(line)
      if (entry.type === "session") Object.assign(saved, { model: entry.model, effort: entry.effort })
      if (entry.type === "message") saved.messages.push(entry.message)
    }
    return saved
  }

  configOptions(): acp.SessionConfigOption[] {
    const groups = new Map<string, { value: string; name: string }[]>()
    for (const m of this.init.available) {
      const provider = this.init.models.getProvider(m.provider)?.name ?? m.provider
      groups.set(provider, [...(groups.get(provider) ?? []), { value: modelKey(m), name: m.name }])
    }
    return [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: modelKey(this.model), options: [...groups].map(([name, options]) => ({ group: name, name, options })) },
      { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: this.effort, options: EFFORTS.map((e) => ({ value: e.id, name: e.name })) },
    ]
  }

  setOption(configId: string, value: string) {
    if (configId === "model") {
      const model = this.init.available.find((m) => modelKey(m) === value)
      if (!model) throw new Error(`The engine has no model ${value}.`)
      this.model = model
      this.agent.state.model = model
    } else if (configId === "effort") {
      if (!EFFORTS.some((e) => e.id === value)) throw new Error(`Unknown effort ${value}.`)
      this.effort = value as ThinkingLevel
    } else {
      throw new Error(`Unknown option ${configId}.`)
    }
    this.agent.state.thinkingLevel = this.thinking()
  }

  async prompt(blocks: acp.ContentBlock[]): Promise<acp.StopReason> {
    await this.agent.prompt({ role: "user", content: textOf(blocks), timestamp: Date.now() })
    if (this.init.persist) await this.save()
    const last = this.agent.state.messages.at(-1)
    const stop = last?.role === "assistant" ? last.stopReason : undefined
    if (stop === "aborted") return "cancelled"
    if (stop === "error") throw new Error(last?.role === "assistant" && last.errorMessage ? last.errorMessage : "The model stopped with an error.")
    if (stop === "length") return "max_tokens"
    return "end_turn"
  }

  cancel() {
    this.agent.abort()
  }

  async close() {
    this.agent.abort()
    await this.init.toolbox.close()
  }

  // A model without reasoning ignores the effort
  private thinking(): ThinkingLevel {
    return this.model.reasoning ? this.effort : "off"
  }

  private async save() {
    const file = EngineSession.file(this.cwd, this.id)
    await mkdir(path.dirname(file), { recursive: true })
    const lines = [JSON.stringify({ type: "session", model: modelKey(this.model), effort: this.effort }), ...this.agent.state.messages.map((message) => JSON.stringify({ type: "message", message }))]
    const temp = `${file}.tmp`
    await writeFile(temp, lines.join("\n") + "\n")
    await rename(temp, file)
  }
}

// The newest model of the first provider signed in to (each provider's list runs newest first)
const defaultModel = (available: Model<Api>[]) => available[0]

// owlit's prompt as the user's message: text as it is, mentions and attachments as links and quotes
function textOf(blocks: acp.ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text
      if (b.type === "resource_link") return `[${b.title ?? b.name}](${b.uri})`
      if (b.type === "resource" && "text" in b.resource) return `<resource uri="${b.resource.uri}">\n${b.resource.text}\n</resource>`
      return `[${b.type} left out: the engine takes text only]`
    })
    .join("\n\n")
}
