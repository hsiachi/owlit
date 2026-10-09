// owlit-mcp: an MCP server giving agents owlit's library, docs and chats, through the open workspace's
// socket. owlit hands it to every agent it runs; it can also be configured in an agent outside owlit.

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { connect, OwlitError, OwlitNotRunning, type OwlitClient } from "@owlit/client"
import { OWLIT_TOOLS, type AgentNote, type HighlightColor, type Paper, type ToolSpec } from "@owlit/protocol"
import { randomUUID } from "node:crypto"

export interface OwlitMcpOptions {
  workspace: string
  // The chat this agent is answering in, when owlit started it for one
  chatId?: string
  // Where the socket is when not in the temp folder (tests)
  socketDir?: string
  // Told to the agent when it connects; owlit's rules for agents
  instructions?: string
}

const FALLBACK_INSTRUCTIONS =
  "owlit is the user's research workspace: their papers (library_*), their Markdown docs (docs_*) and their chats (chats_*). Cite papers as [Author Year](owlit://library/<id>). Leave comments on docs with docs_add_note rather than editing them."

export function createServer(options: OwlitMcpOptions) {
  const server = new Server({ name: "owlit", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: options.instructions ?? FALLBACK_INSTRUCTIONS })
  let client: Promise<OwlitClient> | null = null
  // Connected on first use, and again after owlit closed and opened again
  const owlit = async () => {
    client ??= connect(options.workspace, { dir: options.socketDir }).catch((error) => {
      client = null
      throw error
    })
    return client
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: OWLIT_TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const spec = OWLIT_TOOLS.find((t) => t.name === request.params.name)
    if (!spec) return failure(`owlit has no tool called ${request.params.name}.`)
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const problem = checkArgs(spec, args)
    if (problem) return failure(problem)
    try {
      return text(await run(spec.name, args, await owlit(), options))
    } catch (error) {
      if (error instanceof OwlitNotRunning) {
        client = null
        return failure(error.message)
      }
      if (error instanceof OwlitError) return failure(error.message)
      return failure(error instanceof Error ? error.message : String(error))
    }
  })
  return server
}

// How a topic file reads; shown with the list so a first topic can be written
const TOPIC_FORMAT = `A topic file:

# Name of the topic

One or two sentences saying where the user's understanding stands.

## Understanding

- Lewis et al. 2020: RAG-Token can draw a different retrieved document for each token it generates. ^s1
  - [§2.1](owlit://library/arxiv-2005.11401#passage=rag-token) — Only when generating with a top-K retriever.
- You: Per-token retrieval is what makes multi-document answers possible. ^s2
  - [Related work](owlit://docs/Related%20work.md)
- Owlit thinks: … (only Owlit's own inference, said as such) ^s3

## Questions

- You: When does per-token retrieval beat per-sequence retrieval? ^q1
  - [Chat](owlit://chat/<id>) — From your chat on Oct 9. Nothing answers it yet.

## Sources

- 2026-10-09 · [Lewis et al. 2020](owlit://library/arxiv-2005.11401) · you highlighted §2.1

A line's one sub-bullet holds its sources, then " — " and a sentence: when the line holds, or where a question stands. New lines may leave out ^id; owlit gives them one.`

async function run(tool: string, args: Record<string, unknown>, owlit: OwlitClient, options: OwlitMcpOptions): Promise<string> {
  const str = (key: string) => args[key] as string
  const num = (key: string) => args[key] as number | undefined
  const optStr = (key: string) => (args[key] as string | undefined) || undefined
  // The chat this agent is answering in, so the window keeps it in view
  const asker = options.chatId ? { chatId: options.chatId } : {}
  switch (tool) {
    case "library_list": {
      const { papers } = await owlit.rpc.library.list()
      let chosen = papers
      if (args.query) {
        const hits = await owlit.rpc.search.papers({ q: str("query") })
        const byId = new Map(papers.map((p) => [p.id, p]))
        chosen = hits.map((h) => byId.get(h.key)).filter((p): p is Paper => !!p)
      } else {
        chosen = [...papers].sort((a, b) => b.addedAt - a.addedAt)
      }
      const shown = chosen.slice(0, num("limit") ?? 50)
      if (!shown.length) return args.query ? "No paper in the library matches that." : "The library is empty."
      const more = chosen.length > shown.length ? `\n(${chosen.length - shown.length} more)` : ""
      return shown.map(paperLine).join("\n") + more
    }
    case "library_get": {
      const { papers, notes } = await owlit.rpc.library.list()
      const paper = papers.find((p) => p.id === str("id"))
      if (!paper) return `There is no paper ${str("id")} in the library.`
      const highlights = await owlit.rpc.library.highlights({ id: paper.id })
      return JSON.stringify(
        {
          ...paper,
          pdf: !!paper.pdf,
          highlights: highlights.length,
          note: notes.some((n) => n.paperId === paper.id && n.content.trim()),
          cite: `[${citeAs(paper)}](owlit://library/${paper.id})`,
        },
        null,
        2,
      )
    }
    case "library_read": {
      const part = (args.part as "text" | "digest" | "note" | undefined) ?? "text"
      const { text, pages } = await owlit.rpc.library.read({ id: str("id"), part, pages: args.pages as string | undefined, section: args.section as string | undefined })
      if (!text.trim()) return part === "digest" ? "This paper has no digest yet." : part === "note" ? "The user hasn't written a note on this paper." : "The paper has no text."
      return pages && part === "text" && (args.pages || args.section) ? `${text}\n\n(The paper has ${pages} pages.)` : text
    }
    case "library_highlights": {
      const highlights = await owlit.rpc.library.highlights({ id: str("id") })
      if (!highlights.length) return "The user hasn't highlighted anything in this paper."
      return [...highlights]
        .sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0))
        .map((h) => `p. ${h.page + 1} (${h.color}): "${h.text.replace(/\s+/g, " ").trim()}"${h.comment ? ` — ${h.comment}` : ""}`)
        .join("\n")
    }
    case "library_search": {
      const found = await owlit.rpc.library.searchOnline({ q: str("query"), limit: num("limit") ?? 10, by: options.chatId ? `chat:${options.chatId}` : "agent" })
      if (!found.length) return "Nothing found."
      return found
        .map((p) =>
          [
            `- ${p.id} · ${p.title}`,
            [shortAuthors(p.authors), p.year, p.venue].filter(Boolean).join(", "),
            p.citationCount !== undefined ? `${p.citationCount} citations` : "",
            p.inLibrary ? `already in the library as ${p.inLibrary}` : "",
          ]
            .filter(Boolean)
            .join(" · ") + (p.abstract ? `\n  ${p.abstract.slice(0, 300)}${p.abstract.length > 300 ? "…" : ""}` : ""),
        )
        .join("\n")
    }
    case "library_add": {
      const { paper, existingId } = await owlit.rpc.library.resolve({ input: str("ref") })
      if (existingId) return `Already in the library as ${existingId}: ${paper.title}`
      const added = await owlit.rpc.library.add({ paper, addedBy: "agent", ...asker })
      return `Added ${added.id}: ${added.title}. Cite it as [${citeAs(added)}](owlit://library/${added.id}). Its PDF and text arrive by themselves; once you have read it, keep a reading note with library_write_digest.`
    }
    case "library_write_digest": {
      const paper = await owlit.rpc.library.writeDigest({ id: str("id"), text: str("digest"), by: options.chatId ? `chat:${options.chatId}` : "agent" })
      return `Kept the reading note for ${paper.id}.`
    }
    case "docs_list": {
      const { files } = await owlit.rpc.docs.list()
      const docs = files.filter((f) => f.path.toLowerCase().endsWith(".md"))
      return docs.length ? docs.map((f) => f.path).join("\n") : "There are no docs yet."
    }
    case "docs_read":
      return (await owlit.rpc.docs.read({ path: str("path") })).content
    case "docs_add_note": {
      const { content } = await owlit.rpc.docs.read({ path: str("path") })
      const anchor = anchorOf(content, str("quote"))
      if (!anchor) return `That passage isn't in ${str("path")} word for word; quote it exactly as it appears.`
      const note: AgentNote = { id: randomUUID(), ...anchor, text: str("note"), by: "Owlit", createdAt: Date.now(), ...(options.chatId ? { chatId: options.chatId } : {}) }
      await owlit.rpc.notes.add({ path: str("path"), note, agent: asker })
      return `Left a note on "${anchor.quote.slice(0, 60)}${anchor.quote.length > 60 ? "…" : ""}" in ${str("path")}. The file itself is unchanged.`
    }
    case "ui_open": {
      const { title } = await owlit.rpc.ui.open({ uri: str("uri"), ...asker })
      return `Showing ${title} in owlit.`
    }
    case "ui_jump": {
      const quote = optStr("quote")
      const { title, found } = await owlit.rpc.ui.jump({ uri: str("uri"), ...asker, ...(num("page") ? { page: num("page") } : {}), ...(quote ? { quote } : {}) })
      if (!quote) return `Showing ${title}${num("page") ? ` at page ${num("page")}` : ""}.`
      return found ? `Showing the passage in ${title}.` : `Opened ${title}, but that passage isn't in it word for word; quote it exactly as library_read or docs_read gives it.`
    }
    case "ui_mark": {
      const { title, page } = await owlit.rpc.ui.mark({ uri: `owlit://library/${str("id")}`, ...asker, quote: str("quote"), ...(optStr("color") ? { color: optStr("color") as HighlightColor } : {}) })
      return `Highlighted the passage on p. ${page} of ${title}. The user can remove it from the paper's Highlights.`
    }
    case "knowledge_read": {
      const topic = optStr("topic")
      if (!topic) {
        const topics = await owlit.rpc.knowledge.topics()
        const list = topics.length
          ? topics.map((t) => `- ${t.id} · ${t.name} · ${t.lines} line${t.lines === 1 ? "" : "s"}, ${t.questions} question${t.questions === 1 ? "" : "s"} · updated ${new Date(t.updatedAt).toISOString().slice(0, 10)}${t.paused ? " · paused by the user: leave it" : ""}`).join("\n")
          : "There are no topics yet."
        return `${list}\n\n${TOPIC_FORMAT}`
      }
      const t = await owlit.rpc.knowledge.read({ topic })
      const notes = [
        t.paused ? "The user paused updates to this topic: don't write to it." : "",
        t.edited.length ? `Lines the user rewrote (keep word for word): ${t.edited.map((e) => `^${e.id}`).join(", ")}` : "",
        t.removed.length ? `Lines the user removed (never bring back):\n${t.removed.map((r) => `- ${r}`).join("\n")}` : "",
      ].filter(Boolean)
      return `${t.path} (id ${t.id})\n\n${t.content}${notes.length ? `\n---\n${notes.join("\n\n")}` : ""}`
    }
    case "knowledge_write": {
      let passages: { id: string; paper: string; quote: string; section?: string }[] | undefined
      if (optStr("passages")) {
        try {
          passages = JSON.parse(str("passages"))
        } catch {
          return "passages should be a JSON array: [{\"id\": …, \"paper\": …, \"quote\": …}]."
        }
        if (!Array.isArray(passages)) return "passages should be a JSON array."
      }
      const remove = optStr("remove")
        ?.split(/[\s,]+/)
        .map((id) => id.replace(/^\^/, ""))
        .filter(Boolean)
      const done = await owlit.rpc.knowledge.write({ topic: str("topic"), content: str("content"), why: str("why"), ...(remove?.length ? { remove } : {}), ...(passages ? { passages } : {}), ...asker })
      return `Wrote ${done.path}${done.changes.length ? `: ${done.changes.join(", ")}` : " (nothing changed)"}.`
    }
    case "chats_list": {
      const chats = await owlit.rpc.chats.list()
      return chats.length ? chats.map((c) => `- ${c.id} · ${c.title} · ${new Date(c.updatedAt).toISOString().slice(0, 10)}`).join("\n") : "There are no chats yet."
    }
    case "chats_read": {
      const chat = await owlit.rpc.chats.get({ id: str("id") })
      return chat.messages
        .map((m) => `${m.role === "user" ? "User" : "Owlit"}: ${m.parts.map((p) => ("text" in p && typeof p.text === "string" ? p.text : "")).join("")}`)
        .join("\n\n")
    }
  }
  return `owlit has no tool called ${tool}.`
}

// The passage as it is in the doc, with a little text either side so it can be found again after edits
function anchorOf(content: string, quote: string) {
  let at = content.indexOf(quote)
  let found = quote
  if (at < 0) {
    // Same words, different spacing or line breaks
    const pattern = new RegExp(quote.trim().split(/\s+/).map(escapeRegExp).join("\\s+"))
    const match = content.match(pattern)
    if (!match || match.index === undefined) return null
    at = match.index
    found = match[0]
  }
  return { quote: found, prefix: content.slice(Math.max(0, at - 32), at), suffix: content.slice(at + found.length, at + found.length + 32) }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function paperLine(p: Paper) {
  const facts = [
    p.status,
    p.starred ? "starred" : "",
    p.tags.length ? `tags: ${p.tags.join(" ")}` : "",
    p.pdf ? "" : "no PDF",
    p.text === "full" ? "full text" : "",
    p.hasDigest ? "digest" : "",
  ].filter(Boolean)
  return `- ${p.id} · ${p.title} · ${[shortAuthors(p.authors), p.year, p.venue].filter(Boolean).join(", ")} · ${facts.join(", ")}`
}

function shortAuthors(authors: string[]) {
  if (!authors.length) return ""
  const last = (name: string) => name.trim().split(/\s+/).at(-1)
  return authors.length > 2 ? `${last(authors[0])} et al.` : authors.map(last).join(" & ")
}

const citeAs = (p: Pick<Paper, "authors" | "year">) => [shortAuthors(p.authors) || "Anonymous", p.year].filter(Boolean).join(" ")

// The arguments against the tool's schema, in a sentence when they don't fit
export function checkArgs(spec: ToolSpec, args: Record<string, unknown>): string | null {
  for (const key of spec.inputSchema.required ?? []) {
    if (args[key] === undefined || args[key] === "") return `${spec.name} needs ${key}.`
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = spec.inputSchema.properties[key]
    if (!prop) return `${spec.name} doesn't take ${key}; it takes ${Object.keys(spec.inputSchema.properties).join(", ") || "nothing"}.`
    if (value === undefined || value === null) continue
    if (typeof value !== prop.type) return `${key} should be a ${prop.type}.`
    if (prop.enum && !prop.enum.includes(value as string)) return `${key} should be one of ${prop.enum.join(", ")}.`
  }
  return null
}

const text = (body: string): CallToolResult => ({ content: [{ type: "text", text: body }] })
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true })
