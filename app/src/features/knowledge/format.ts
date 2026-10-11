import { parseOwlitUri } from "@owlit/protocol"
import type { Line, Verb } from "./types"

// Topic files are read and written by @owlit/protocol's parseTopic and serializeTopic, shared with core
export { parseTopic, serializeTopic, topicPath, topicSlug, topicUri } from "@owlit/protocol"

// ---- Reading a line ----

export const isYou = (l: Pick<Line, "speaker">) => l.speaker === "You"
export const isOwlit = (l: Pick<Line, "speaker">) => l.speaker === "Owlit"

// A paper line Owlit could not anchor to a passage: its only paper source is the abstract
export const isAbstractOnly = (l: Line) => !isYou(l) && !isOwlit(l) && l.sources.some((r) => r.uri.endsWith("#abstract")) && !l.sources.some((r) => r.uri.includes("#passage="))

// The opening words of a line, the way the change log and the chat name it: “Retrieval and tool use may…”
export function firstWords(text: string, n = 5) {
  const words = text.replace(/\s+/g, " ").trim().split(" ")
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ")
}

// The verb the line reads with, when the file doesn't name one
export function verbOf(l: Line): Verb {
  if (l.verb) return l.verb
  if (isOwlit(l)) return "thinks"
  if (isYou(l)) return l.sources[0] && parseOwlitUri(l.sources[0].uri)?.kind === "chat" ? "said" : "wrote"
  return isAbstractOnly(l) ? "says" : "found"
}

// owlit://library/p6#passage=tf-filter → { kind: "paper", id: "p6", passage: "tf-filter" }
export function paperRef(uri: string) {
  const u = parseOwlitUri(uri)
  return u?.kind === "paper" ? u : null
}

export const isoDay = (t: number) => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
