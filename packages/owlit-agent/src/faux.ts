// A model for tests (OWLIT_ENGINE_FAUX=1): pi-ai's faux provider answering from the last message.
//   "tool <name> <json>"  calls that tool, then reports its result
//   "slow"                answers at length, slowly (to be cancelled)
//   "system?"             says what the system prompt holds and whether owlit's preamble came in the prompt
//   anything else         "engine: <text> (<model>/<effort>)"

import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type CredentialStore, type FauxResponseFactory, type Models } from "@earendil-works/pi-ai"

export function fauxModels(credentials: CredentialStore): Models {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-small", name: "Faux Small", reasoning: true }, { id: "faux-large", name: "Faux Large" }], tokensPerSecond: 400 })
  const answer: FauxResponseFactory = (context, options, _state, model) => {
    const last = context.messages.at(-1)
    if (last?.role === "toolResult") {
      const text = last.content.map((c) => (c.type === "text" ? c.text : "")).join("")
      return fauxAssistantMessage(`${last.isError ? "tool failed" : "tool said"}: ${text.slice(0, 60)}`)
    }
    const text = last?.role === "user" ? (typeof last.content === "string" ? last.content : last.content.map((c) => (c.type === "text" ? c.text : "")).join("")) : ""
    const call = /tool (\w+)(?: (\{.*\}))?/.exec(text)
    if (call) return fauxAssistantMessage(fauxToolCall(call[1], call[2] ? JSON.parse(call[2]) : {}), { stopReason: "toolUse" })
    if (text.includes("slow")) return fauxAssistantMessage(fauxText("word ".repeat(2000)))
    if (text.includes("system?")) {
      const system = context.messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n")
      const role = /Your role in this chat: ([\w-]+)/.exec(system)?.[1] ?? "none"
      const name = /The user's name: ([^.]+)\./.exec(system)?.[1] ?? "none"
      return fauxAssistantMessage(`rules:${system.includes("owlit agent rules")} role:${role} name:${name} preamble:${text.includes("[owlit]")}`)
    }
    const request = text.split("\n\n").at(-1) ?? text
    return fauxAssistantMessage(`engine: ${request.slice(0, 40)} (${model.id}/${options?.reasoning ?? "off"})`)
  }
  faux.setResponses(Array.from({ length: 1000 }, () => answer))
  const models = createModels({ credentials })
  models.setProvider(faux.provider)
  return models
}
