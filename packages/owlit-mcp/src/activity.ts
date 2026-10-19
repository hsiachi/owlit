import { isPerson, type ActivityAnswer, type ActivityItem, type ActivityLine, type ActivityQuery } from "@owlit/protocol"

// activity_read's answer as the agent reads it: one fact per line, times in the user's clock, papers by
// title and id so they can be cited, nothing interpreted.

const UNITS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }

// "24h", "7d", "2w" back from now, or a date ("2026-10-07", read as the start of that day here)
export function parseWhen(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const back = /^\s*(\d+)\s*([hdw])\s*$/i.exec(value)
  if (back) return now - Number(back[1]) * UNITS[back[2].toLowerCase()]
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? new Date(`${value.trim()}T00:00`) : new Date(value)
  const at = day.getTime()
  if (Number.isNaN(at)) throw new Error(`activity_read can't read the time "${value}": give '7d', '24h', '2w' or a date like 2026-10-07.`)
  return at
}

export function activityQueryOf(args: Record<string, unknown>, now = Date.now()): ActivityQuery {
  const mode = args.mode as ActivityQuery["mode"]
  const limit = typeof args.limit === "number" ? args.limit : undefined
  const since = parseWhen(args.since as string | undefined, now)
  const at = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  if (mode === "of") return at({ mode, paper: args.paper || undefined, doc: args.doc || undefined, chat: args.chat || undefined }) as ActivityQuery
  if (mode === "log") return at({ mode, since, until: parseWhen(args.until as string | undefined, now), actor: args.actor || undefined, limit }) as ActivityQuery
  if (mode === "recent" || mode === "top") return at({ mode, since, limit }) as ActivityQuery
  throw new Error(`activity_read's mode is one of recent, top, of, log; not "${String(mode)}".`)
}

const pad = (n: number) => String(n).padStart(2, "0")
export function clock(at: number) {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function duration(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// [3, 4, 5, 7] → "pp. 3–5, 7"
export function pageRanges(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (sorted[j + 1] === sorted[j] + 1) j++
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return sorted.length === 1 ? `p. ${runs[0]}` : `pp. ${runs.join(", ")}`
}

const times = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)))

function itemLine(item: ActivityItem): string {
  if (item.kind === "paper") {
    const facts: string[] = [`last ${clock(item.last)}`, times(item.visits, "opened once", "opened # times")]
    const pages = Object.keys(item.pages).map(Number)
    if (item.pdfSeconds) facts.push(`${duration(item.pdfSeconds)} on the PDF${pages.length ? ` (${pageRanges(pages)})` : ""}`)
    if (item.digestSeconds) facts.push(`${duration(item.digestSeconds)} on the digest`)
    if (item.highlights) facts.push(times(item.highlights, "1 highlight", "# highlights"))
    if (item.noted) facts.push("wrote in its note")
    if (item.starred !== undefined) facts.push(item.starred ? "starred it" : "took its star off")
    if (item.status) facts.push(`set it to ${item.status}`)
    if (item.tags) facts.push(item.tags.length ? `tagged it ${item.tags.join(", ")}` : "took its tags off")
    facts.push(item.read ? "read" : "not read yet")
    return `- paper ${item.id} · "${item.title}" · ${facts.join(" · ")}`
  }
  if (item.kind === "doc") {
    const facts = [`last ${clock(item.last)}`]
    if (item.opens) facts.push(times(item.opens, "opened once", "opened # times"))
    if (item.edits) facts.push(times(item.edits, "edited once", "edited # times"))
    if (item.agentEdits) facts.push(times(item.agentEdits, "an agent changed it once", "agents changed it # times"))
    return `- doc ${item.path} · ${facts.join(" · ")}`
  }
  return `- chat ${item.id} · "${item.title}" · last ${clock(item.last)} · ${times(item.sessions, "wrote in it once", "wrote in it # times")}`
}

function logLine(line: ActivityLine): string {
  const who = isPerson(line.actor) ? "the user" : "an agent"
  const what = line.paper ? `${line.what} "${line.paper.title}" (${line.paper.id})` : line.doc ? `${line.what} the doc ${line.doc}` : line.chat ? `${line.what} "${line.chat.title}" (${line.chat.id})` : line.what
  const parts = [`${clock(line.at)} · ${who} ${what}`]
  if (line.seconds) parts.push(`for ${duration(line.seconds)}`)
  if (line.pages?.length) parts.push(pageRanges(line.pages))
  if (line.detail) parts.push(`(${line.detail})`)
  if (!isPerson(line.actor) && line.chat) parts.push(`in the chat "${line.chat.title}" (${line.chat.id})`)
  if (line.times) parts.push(`(${line.times} times)`)
  return parts.join(" ")
}

export function activityText(answer: ActivityAnswer, query: ActivityQuery): string {
  if (!answer.recording) return "The user has turned off \"Remember what I do in owlit\" in Settings, so owlit keeps nothing of what they do. Ask them instead."
  const since = answer.since ? `since ${clock(answer.since)}` : ""
  const more = answer.more ? "\n(There is more: narrow it with since, until or limit.)" : ""
  if (query.mode === "recent" || query.mode === "top") {
    if (!answer.items?.length) return `Nothing recorded ${since}.`
    const order = query.mode === "recent" ? "newest first" : "what the user spent the most on first"
    return `What the user did ${since}, ${order}:\n${answer.items.map(itemLine).join("\n")}${more}`
  }
  if (query.mode === "log") {
    if (!answer.lines?.length) return `Nothing recorded ${since}.`
    return `What happened ${since}, in order:\n${answer.lines.map(logLine).join("\n")}${more}`
  }
  const name = query.paper ? `the paper ${query.paper}` : query.doc ? `the doc ${query.doc}` : `the chat ${query.chat}`
  const out: string[] = []
  // A chat's history also holds the docs agents changed in it; the summary is the thing asked about
  const item = answer.items?.find((i) => i.kind === (query.paper ? "paper" : query.doc ? "doc" : "chat"))
  if (item) out.push(`In all: ${itemLine(item).slice(2)}`)
  if (answer.lines?.length) out.push(`History:\n${answer.lines.map(logLine).join("\n")}`)
  if (answer.cited?.length)
    out.push(`Sentences Owlit's answers cited from it:\n${answer.cited.map((c) => `- ${clock(c.at)} in "${c.chatTitle}" (${c.chatId})${c.page ? `, p. ${c.page}` : ""}: "${c.quote}"`).join("\n")}`)
  return out.length ? out.join("\n\n") + more : `Nothing is recorded about ${name}.`
}
