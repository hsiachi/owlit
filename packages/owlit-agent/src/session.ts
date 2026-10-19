// One conversation on the engine: pi-agent-core's loop with owlit's tools, a model and an effort, and its
// transcript kept in the workspace (<workspace>/.owlit/engine/<id>.jsonl) so a chat can go on after a
// restart and moves with the folder.

import type * as acp from "@agentclientprotocol/sdk"
import { Agent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core"
import type { Api, ImageContent, Model, Models, TextContent, UserMessage } from "@earendil-works/pi-ai"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { modelKey } from "./models.ts"
import type { Toolbox } from "./tools.ts"
import { updatesFor } from "./updates.ts"

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
  // prompt.ts, made for this session's role and context
  systemPrompt: string
  models: Models
  available: Model<Api>[]
  toolbox: Toolbox
  saved?: Saved
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
      // A saved conversation starts with the system prompt it was made with; this session's own leads instead
      initialState: { systemPrompt: init.systemPrompt, model: this.model, thinkingLevel: this.thinking(), tools: init.toolbox.tools, messages: withoutLeadingSystem(init.saved?.messages ?? []) },
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
    await this.agent.prompt({ role: "user", content: contentOf(blocks, this.model.input.includes("image")), timestamp: Date.now() })
    await this.save()
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

  // The model and effort an agent of this session's starts with
  current() {
    return { model: this.model, thinking: this.thinking() }
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

const withoutLeadingSystem = (messages: AgentMessage[]) => (messages[0]?.role === "system" ? messages.slice(1) : messages)

// The newest model of the first provider signed in to (each provider's list runs newest first)
const defaultModel = (available: Model<Api>[]) => available[0]

// owlit's prompt as the user's message: text as it is, mentions and attachments as links and quotes, and
// an attached image as a picture when the model takes one (otherwise it is told the picture was left out;
// the link to the file comes with it anyway)
export function contentOf(blocks: acp.ContentBlock[], seesImages: boolean): UserMessage["content"] {
  const parts: (TextContent | ImageContent)[] = []
  const say = (text: string) => {
    const last = parts.at(-1)
    if (last?.type === "text") last.text += `\n\n${text}`
    else parts.push({ type: "text", text })
  }
  for (const b of blocks) {
    if (b.type === "text") say(b.text)
    else if (b.type === "resource_link") say(`[${b.title ?? b.name}](${b.uri})`)
    else if (b.type === "resource" && "text" in b.resource) say(`<resource uri="${b.resource.uri}">\n${b.resource.text}\n</resource>`)
    else if (b.type === "image" && seesImages) parts.push({ type: "image", data: b.data, mimeType: b.mimeType })
    else if (b.type === "image") say(`[An image${b.uri ? ` (${b.uri})` : ""} was left out: this model takes text only. Tell the user you can't see it with this model.]`)
    else say(`[${b.type} left out: the engine takes text and images only]`)
  }
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts
}
