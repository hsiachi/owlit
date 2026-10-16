// owlit-mcp: an MCP server giving agents owlit's library, docs and chats, through the open workspace's
// socket. owlit hands it to every agent it runs; it can also be configured in an agent outside owlit.

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { connect, OwlitNotRunning, type OwlitClient } from "@owlit/client"
import {
  threadUri,
  OWLIT_TOOLS,
  QUESTION_COLUMN,
  placedKey,
  shownThread,
  type DocComment,
  type Thread,
  type ThreadCell,
  type ThreadGroup,
  type ThreadRowWrite,
  type ConsentAction,
  type FoundPaper,
  type FoundPapers,
  type HighlightColor,
  type MemoryKind,
  type Paper,
  type ExtensionWait,
  type PdfEnded,
  type ToolSpec,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { activityQueryOf, activityText } from "./activity.ts"

export interface OwlitMcpOptions {
  workspace: string
  // The chat this agent is answering in, when owlit started it for one
  chatId?: string
  // The background run it works for ("<kind>:<task id>"), which signs its searches and thread writes
  run?: string
  // Where the socket is when not in the temp folder (tests)
  socketDir?: string
  // Told to the agent when it connects; owlit's rules for agents
  instructions?: string
}

const FALLBACK_INSTRUCTIONS =
  "owlit is the user's research workspace: their papers (library_*), their Markdown docs (docs_*) and their chats (chats_*). Cite papers as [Author Year](owlit://library/<id>). Leave comments on docs with docs_add_comment rather than editing them."

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
      return failure(error instanceof Error ? error.message : String(error))
    }
  })
  return server
}

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
      if (!paper) {
        // A paper a search found: its whole abstract, which the search's line cuts short
        const found = await owlit.rpc.library.found({ id: str("id") })
        if (!found) return `There is no paper ${str("id")} in the library, and no recent search showed it.`
        return JSON.stringify({ id: str("id"), ...found, inLibrary: false, note: "Not in the user's library: a search found it. Gather it into a thread with thread_write; add it with library_add only to read its full text." }, null, 2)
      }
      const highlights = await owlit.rpc.library.highlights({ id: paper.id })
      return JSON.stringify(
        {
          ...paper,
          pdf: !!paper.pdf,
          ...(paper.pdf ? {} : { noPdf: pdfFact(paper) }),
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
      const found = await owlit.rpc.library.searchOnline({
        q: str("query"),
        limit: num("limit") ?? 10,
        by: searcher(options),
        ...pickArgs(args, { source: "source", year: "year", sort: "sort", minCitations: "min_citations", type: "type", author: "author", venue: "venue", openAccess: "open_access" }),
      })
      return foundText(found, "Nothing found.")
    }
    case "library_related": {
      const kind = str("kind") as "references" | "cited_by" | "similar"
      const found = await owlit.rpc.library.related({
        ref: str("id"),
        kind,
        limit: num("limit") ?? 20,
        by: searcher(options),
        ...pickArgs(args, { year: "year", sort: "sort" }),
      })
      const what = { references: "References of", cited_by: "Papers citing", similar: "Papers like" }[kind]
      return foundText({ ...found, matched: `${what} ${found.matched ?? str("id")}` }, kind === "references" ? "No references known." : kind === "cited_by" ? "Nothing cites it yet, as far as the source knows." : "No similar papers found.")
    }
    case "library_journal": {
      const offset = num("offset") ?? 0
      const found = await owlit.rpc.library.journal({
        journal: str("journal"),
        year: str("year"),
        offset,
        limit: num("limit") ?? 50,
        by: searcher(options),
        ...pickArgs(args, { query: "query" }),
      })
      const total = found.total ?? found.papers.length
      const head = `${found.matched}, ${str("year")}: ${total} research article${total === 1 ? "" : "s"}${args.query ? ` with “${str("query")}”` : ""} (Crossref's full list, by issue date).`
      if (!found.papers.length) return offset && total ? `${head} Nothing after ${offset}.` : head
      const next = offset + found.papers.length < total ? ` Pass offset ${offset + found.papers.length} for the next.` : ""
      return `${head} ${offset + 1}–${offset + found.papers.length}:${next}\n${found.papers.map((p) => foundLine(p, 160)).join("\n")}`
    }
    case "library_add": {
      const refs = [...new Set((args.refs as string[]).map((r) => r.trim()).filter(Boolean))]
      if (!refs.length) return "library_add needs at least one ref."
      // One question for the lot: the user answers for the batch they asked for
      const refused = await consent(owlit, options, "add_paper", refs.length === 1 ? `Add ${refs[0]} to the Library` : `Add ${refs.length} papers to the Library`)
      if (refused) return refused
      const lines: string[] = []
      for (const ref of refs) {
        try {
          const { paper, existingId } = await owlit.rpc.library.resolve({ input: ref })
          if (existingId) {
            lines.push(`Already in the library as ${existingId}: ${paper.title}`)
            continue
          }
          const added = await owlit.rpc.library.add({ paper, addedBy: "agent", ...asker })
          lines.push(`Added ${added.id}: ${added.title}. Cite it as [${citeAs(added)}](owlit://library/${added.id}).`)
        } catch (error) {
          lines.push(`Couldn't add ${ref}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (lines.some((l) => l.startsWith("Added"))) lines.push("PDFs and text arrive by themselves. For a paper worth a digest, ask for one with library_request_digest.")
      return lines.join("\n")
    }
    case "library_remove": {
      const ids = [...new Set((args.ids as string[]).map((r) => r.trim()).filter(Boolean))]
      if (!ids.length) return "library_remove needs at least one id."
      // Changing the library either way: the role that may add may take back
      const refused = await consent(owlit, options, "add_paper", ids.length === 1 ? `Remove ${ids[0]} from the Library` : `Remove ${ids.length} papers from the Library`)
      if (refused) return refused
      const done = await owlit.rpc.library.removeByAgent({ ids, ...asker })
      return [...done.removed.map((id) => `Removed ${id}.`), ...done.refused.map((r) => `Kept ${r.id}: ${r.why}.`)].join("\n")
    }
    // Every note comes from the same background run, so all of them are written one way, in the
    // user's language, with the paper's figures; a chat's agent asks rather than writes its own
    case "library_request_digest": {
      const id = str("id")
      if (await owlit.rpc.library.digest({ id })) return `${id} has a digest already; read it with library_read part=digest.`
      await owlit.rpc.library.requestDigest({ id })
      return `Owlit is writing a digest for ${id}; it appears on the paper's page when done.`
    }
    case "docs_list": {
      const { files } = await owlit.rpc.docs.list()
      const docs = files.filter((f) => f.path.toLowerCase().endsWith(".md"))
      return docs.length ? docs.map((f) => f.path).join("\n") : "There are no docs yet."
    }
    case "docs_read": {
      if (/\.pdf$/i.test(str("path"))) {
        const { text, pages } = await owlit.rpc.docs.readPdf({ path: str("path"), ...(optStr("pages") ? { pages: optStr("pages") } : {}) })
        return optStr("pages") ? `${text}\n\n(The PDF has ${pages} pages.)` : text
      }
      return (await owlit.rpc.docs.read({ path: str("path") })).content
    }
    case "docs_delete": {
      const paths = (args.paths as string[]).filter(Boolean)
      if (!paths.length) return "Name at least one doc or folder to delete."
      const refused = await consent(owlit, options, "delete", `Delete ${paths.map(nameOf).join(", ")}`)
      if (refused) return refused
      const { deleted } = await owlit.rpc.agents.deleteDocs({ paths, ...asker })
      return `Deleted ${deleted.join(", ")}. They are in the Trash, and the user can undo it from the chat.`
    }
    case "docs_move": {
      const refused = await consent(owlit, options, "move", `Move ${nameOf(str("path"))} to ${str("to")}`)
      if (refused) return refused
      const moved = await owlit.rpc.agents.moveDoc({ path: str("path"), to: str("to"), ...asker })
      return `Moved ${str("path")} to ${moved.path}.`
    }
    case "docs_add_comment": {
      const { content } = await owlit.rpc.docs.read({ path: str("path") })
      const anchor = anchorOf(content, str("quote"))
      if (!anchor) return `That passage isn't in ${str("path")} word for word; quote it exactly as it appears.`
      const at = Date.now()
      const comment: DocComment = {
        id: randomUUID(),
        ...anchor,
        entries: [
          { id: randomUUID(), by: "owlit", text: str("comment"), at, ...(options.chatId ? { chatId: options.chatId } : {}) },
          // Owlit's own word under a point carried over from someone else
          ...(optStr("own") ? [{ id: randomUUID(), by: "owlit" as const, text: optStr("own")!, at, ...(options.chatId ? { chatId: options.chatId } : {}) }] : []),
        ],
        createdAt: at,
      }
      await owlit.rpc.comments.add({ path: str("path"), comment, agent: { ...asker, ...(options.run ? { run: options.run } : {}) } })
      return `Left a comment on "${anchor.quote.slice(0, 60)}${anchor.quote.length > 60 ? "…" : ""}" in ${str("path")}. The file itself is unchanged.`
    }
    case "owlit_help":
      return owlit.rpc.agents.guide(optStr("topic") ? { topic: str("topic") } : {})
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
    case "thread_list": {
      const all = await owlit.rpc.threads.list()
      if (!all.length) return "There are no threads yet."
      const lines = await Promise.all(
        all.map(async (c) => {
          const asked = (await owlit.rpc.threads.get({ id: c.id })).asked.text
          const size = `${c.papers} paper${c.papers === 1 ? "" : "s"}${c.columns ? `, ${c.columns} column${c.columns === 1 ? "" : "s"}` : ""}`
          return `- ${c.id} · ${c.title}${c.project ? ` · in ${c.project}` : ""} · ${size} · asked: ${asked}`
        }),
      )
      return lines.join("\n")
    }
    case "thread_read":
      return threadText(await owlit.rpc.threads.get({ id: str("id") }))
    case "thread_write": {
      const parsed = parseJsonArgs(args, ["rows", "memo", "groups"])
      if (typeof parsed === "string") return parsed
      const rows = (parsed.rows as RowArg[] | undefined)?.map(rowWrite)
      if (rows?.some((r) => typeof r === "string")) return rows.find((r) => typeof r === "string") as string
      const done = await owlit.rpc.threads.write({
        ...pickArgs(args, { id: "id", asked: "asked", title: "title", project: "project", note: "note", why: "why", grouping: "grouping", newGrouping: "new_grouping" }),
        ...(options.run && !options.chatId ? { run: options.run } : {}),
        ...(rows ? { rows: rows as ThreadRowWrite[] } : {}),
        ...(parsed.memo ? { memo: parsed.memo as { id?: string; text: string }[] } : {}),
        ...(parsed.groups ? { groups: parsed.groups as ThreadGroup[] } : {}),
        ...(Array.isArray(args.columns) ? { columns: (args.columns as string[]).map((question) => ({ question })) } : {}),
        ...(Array.isArray(args.remove_rows) ? { removeRows: args.remove_rows as string[] } : {}),
        ...asker,
      })
      const counts = [done.added ? `added ${done.added}` : "", done.updated ? `updated ${done.updated}` : ""].filter(Boolean).join(", ")
      const left = done.left.length ? ` Left out, because the user removed them: ${done.left.join(", ")}.` : ""
      const kept = done.userKept.length ? `\nKept as the user had it:\n${done.userKept.map((line) => `- ${line}`).join("\n")}` : ""
      return `Wrote “${done.title}” (${threadUri(done.id)})${counts ? `: ${counts}` : ""}.${left} Link it in your answer as [${done.title}](${threadUri(done.id)}).${kept}`
    }
    case "memory_write": {
      const op = str("op") as "add" | "replace" | "remove"
      const { line, before, versionId } = await owlit.rpc.memory.write({
        op,
        ...pickArgs(args, { id: "id", text: "text" }),
        ...(optStr("kind") ? { kind: optStr("kind") as MemoryKind } : {}),
        ...asker,
      })
      if (!versionId) return `Already kept as ${line?.id}: "${line?.text}". Nothing changed.`
      if (!line) return `Removed ${before?.id} ("${before?.text}") from the memory. Tell the user in a few words.`
      return `${before ? `Replaced ${line.id}` : `Kept as ${line.id}`}: "${line.text}". Tell the user in a few words what you'll keep in mind${before ? `, and that it replaces "${before.text}"` : ""}.`
    }
    case "activity_read": {
      const query = activityQueryOf(args)
      return activityText(await owlit.rpc.activity.query({ query }), query)
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

interface RowArg {
  id?: string
  answer?: string
  depth?: string
  quote?: string
  group?: string
  groups?: string[]
  cells?: Record<string, { text?: string; depth?: string; quote?: string; rel?: string; sentence?: string }>
}

// A row as the agent gives it (answer, depth and quote for the question; other columns in cells), as
// core takes it; or what to tell the agent
function rowWrite(r: RowArg): ThreadRowWrite | string {
  if (!r.id) return "Every row needs the paper's id, as a search gave it."
  // The page is found by owlit from the quote
  const cell = (c: { text?: string; depth?: string; quote?: string; rel?: string; sentence?: string }): Omit<ThreadCell, "at"> => ({
    text: c.text ?? "",
    depth: c.depth === "full" ? "full" : "abstract",
    ...(c.quote ? { passage: { quote: c.quote, page: 1 } } : {}),
    ...(c.rel === "supports" || c.rel === "challenges" || c.rel === "related" ? { rel: c.rel } : {}),
    ...(c.sentence ? { sentence: c.sentence } : {}),
  })
  const cells = Object.fromEntries(Object.entries(r.cells ?? {}).map(([col, c]) => [col, cell(c)]))
  if (r.answer) cells[QUESTION_COLUMN] = cell({ text: r.answer, depth: r.depth, quote: r.quote })
  return { id: r.id, ...(Object.keys(cells).length ? { cells } : {}), ...(r.group !== undefined ? { group: r.group } : {}), ...(Array.isArray(r.groups) ? { groups: r.groups.map(String) } : {}) }
}

function parseJsonArgs(args: Record<string, unknown>, keys: string[]): Record<string, unknown[] | undefined> | string {
  const out: Record<string, unknown[] | undefined> = {}
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined || raw === "") continue
    let value: unknown = raw
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw)
      } catch {
        return `${key} should be a JSON array.`
      }
    }
    if (!Array.isArray(value)) return `${key} should be a JSON array.`
    out[key] = value
  }
  return out
}

// A thread as the agent reads it: what the user sees, then what of it is the user's
function threadText(stored: Thread) {
  const c = shownThread(stored)
  const columns = c.columns.filter((col) => !col.hidden && col.kind !== "grouping")
  const groupings = c.columns.filter((col) => col.kind === "grouping")
  const groupName = new Map(groupings.flatMap((col) => (col.groups ?? []).map((g) => [`${col.id}:${g.id}`, g.name] as const)))
  // The user's own placements, which a write of yours doesn't change
  const userPut = (col: string, paper: string, group: string) => stored.yours.placed[placedKey(col, paper, group)]?.in === true
  const lines = [
    `${c.title} (${threadUri(c.id)})`,
    `Asked: ${c.asked.text}${c.project ? ` · project ${c.project}` : ""}${c.sources.length ? ` · looked in ${c.sources.join(", ")}` : ""}`,
    `Columns: ${columns.map((col) => `${col.id} = ${col.question}`).join("; ")}`,
    ...groupings.map((col) => `Grouping ${col.id} (${col.question})${(col.groups ?? []).length ? `: ${(col.groups ?? []).map((g) => `${g.id} = ${g.name}${g.parent ? ` (in ${g.parent})` : ""}`).join("; ")}` : ", no groups yet"}`),
    "",
    "Memo:",
    ...(c.memo.length ? c.memo.map((s) => `- [${s.id}] ${s.text}`) : ["(none yet)"]),
    "",
    `Papers (${c.rows.length}):`,
  ]
  for (const r of c.rows) {
    const p = r.paper
    const placed = groupings
      .filter((col) => r.in?.[col.id]?.length)
      .map((col) => `${groupings.length > 1 ? `${col.id}: ` : ""}in ${r.in![col.id]!.map((g) => `${g} (${groupName.get(`${col.id}:${g}`) ?? g})${userPut(col.id, r.id, g) ? " (the user put it here, keep it)" : ""}`).join(", ")}`)
    lines.push(`- ${r.id} · ${p.title} · ${[p.authors[0], p.year, p.venue].filter(Boolean).join(", ")}${placed.length ? ` · ${placed.join(" · ")}` : ""}`)
    for (const col of columns) {
      const cell = r.cells[col.id]
      if (cell) lines.push(`  ${col.id}: ${cell.rel ? `${cell.rel} ` : ""}${cell.text} [${cell.depth}${cell.passage ? `, p. ${cell.passage.page}` : ""}]`)
    }
  }
  const edits = Object.keys(stored.yours.edits)
  const removed = Object.entries(stored.yours.removed)
    .filter(([item]) => !item.startsWith("group:"))
    .map(([, r]) => r.text)
  if (edits.length) lines.push("", `The user rewrote (keep their words): ${edits.join(", ")}`)
  if (removed.length) lines.push("", "The user removed (never bring back):", ...removed.map((t) => `- ${t}`))
  // What the user did to the groups, which stays whatever you write
  const regrouped: string[] = []
  for (const [key, into] of Object.entries(stored.yours.merged)) {
    const [col, id] = key.split(":")
    const owlit = stored.columns.find((x) => x.id === col)?.groups?.find((g) => g.id === id)?.name
    if (groupings.some((x) => x.id === col)) regrouped.push(`- merged ${id}${owlit ? ` (${owlit})` : ""} into ${into}: papers you put in ${id} go in ${into}`)
  }
  for (const [item, r] of Object.entries(stored.yours.removed)) {
    const [, col, id] = item.split(":")
    if (item.startsWith("group:")) regrouped.push(`- ungrouped ${id} (${r.text})${groupings.length > 1 ? ` in ${col}` : ""}: leave it out`)
  }
  for (const [key, p] of Object.entries(stored.yours.placed)) {
    if (p.in) continue
    const [col, paper, group] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)]
    if (c.rows.some((r) => r.id === paper)) regrouped.push(`- took ${paper} out of ${group}${groupings.length > 1 ? ` (${col})` : ""}: don't put it back`)
  }
  if (regrouped.length) lines.push("", "The user changed the groups (keep it so):", ...regrouped)
  return lines.join("\n")
}

// The passage as it is in the doc, with a little text either side so it can be found again after edits
// Asks owlit whether the chat's role lets the agent do this, asking the user in the chat when it says so.
// Null to go ahead, or what to tell the agent. An agent outside owlit has no chat; its own permission
// prompt for this tool is the user's say.
async function consent(owlit: OwlitClient, options: OwlitMcpOptions, action: ConsentAction, title: string) {
  if (!options.chatId) return null
  const answer = await owlit.rpc.agents.consent({ chatId: options.chatId, action, title })
  return answer.allowed ? null : `Not done: ${answer.reason ?? "the user said no."}`
}

const nameOf = (p: string) => p.split("/").filter(Boolean).pop() ?? p

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
    pdfFact(p),
    p.text === "full" ? "full text" : "",
    p.hasDigest ? "digest" : "",
  ].filter(Boolean)
  return `- ${p.id} · ${p.title} · ${[shortAuthors(p.authors), p.year, p.venue].filter(Boolean).join(", ")} · ${facts.join(", ")}`
}

// Why a paper has no PDF, in words an agent can pass on, read off where core says it stands (its state
// and the ending of the try that says why), as the window shows it. A bare "no PDF" had an agent tell the
// user to set up the library proxy they already had, and say nothing of the papers waiting for the
// user's browser.
const DROP = "the user can drop the PDF on the paper"
const IN_BROWSER = "the user can press Get it in your browser on the paper, or drop the PDF on it"
const BY_ENDED: Record<PdfEnded, string> = {
  "no-copy": `no PDF: owlit found no copy it can download (it looks again on its own every few days); ${DROP}`,
  "no-access": `no PDF: the publisher offered access instead of the PDF, so the user's library doesn't seem to subscribe; ${DROP}`,
  "not-offered": `no PDF: the user's library proxy doesn't offer this paper; ${DROP}`,
  "not-there": `no PDF: the publisher has no PDF at the paper's address; ${DROP}`,
  check: `no PDF: the publisher stopped owlit with a check, which the user's own browser may get past; ${IN_BROWSER}`,
  "sign-in": `no PDF: the publisher wants a sign-in, which the user's own browser may have; ${IN_BROWSER}`,
  "nothing-came": `no PDF: the user's browser was sent for it and no PDF came; the user can press Open in your browser again on the paper, or drop the PDF on it`,
  // Not reasons for having no PDF; core never gives them as one
  pdf: `no PDF; ${DROP}`,
  offline: `no PDF yet (waiting for the network)`,
  // The extension's ending, never a reason for no PDF: such a paper is still finding (WAITS)
  "no-permission": `no PDF yet; ${DROP}`,
}

// A paper still finding while the owlit extension in the user's browser waits at its site for them: one
// sign-in, check or permission there covers every paper waiting at that site
const WAITS: Record<ExtensionWait["kind"], string> = {
  "sign-in": "no PDF yet: waits for the user's library sign-in in their browser (Home says so; one sign-in covers every such paper, and owlit goes on by itself)",
  check: "no PDF yet: waits for the user to pass a check at the publisher's site in their browser (Home says so; once passed, owlit goes on with every paper waiting there)",
  permission: "no PDF yet: waits for the user to let the owlit extension in their browser read the publisher's site, from the extension's button (Home says so)",
}
const WAITED: Partial<Record<PdfEnded, keyof typeof WAITS>> = { "sign-in": "sign-in", check: "check", "no-permission": "permission" }

export function pdfFact(p: Pick<Paper, "pdf" | "pdfState">) {
  if (p.pdf) return ""
  const s = p.pdfState
  if (!s || s.state === "finding") {
    // The extension's queue says where it is now; its last try says so before the queue has it again
    const waits = s?.extension ? s.extension.waits : s?.reason?.by === "extension" ? WAITED[s.reason.ended] : undefined
    if (waits) return WAITS[waits]
    if (s?.extension) return "no PDF yet (owlit is getting it through the user's browser)"
    return s?.reason?.ended === "offline" ? "no PDF yet (waiting for the network)" : "no PDF yet (owlit is looking)"
  }
  return BY_ENDED[s.reason?.ended ?? "no-copy"]
}

function shortAuthors(authors: string[]) {
  if (!authors.length) return ""
  const last = (name: string) => name.trim().split(/\s+/).at(-1)
  return authors.length > 2 ? `${last(authors[0])} et al.` : authors.map(last).join(" & ")
}

// A found paper in a line or two: what it is, then its summary (tldr) or the start of its abstract
function foundLine(p: FoundPaper, abstractChars = 300) {
  const where = [p.volume ? `vol. ${p.volume}${p.issue ? `(${p.issue})` : ""}` : ""].filter(Boolean)
  const facts = [
    [shortAuthors(p.authors), p.year, p.venue, ...where].filter(Boolean).join(", "),
    p.citationCount !== undefined ? `${p.citationCount} citations` : "",
    p.openPdf ? "free PDF" : "",
    p.inLibrary ? `already in the library as ${p.inLibrary}${p.hasPdf === false ? " (no PDF yet)" : ""}` : "",
  ].filter(Boolean)
  const about = p.tldr ? `TLDR: ${p.tldr}` : p.abstract ? `${p.abstract.slice(0, abstractChars)}${p.abstract.length > abstractChars ? "…" : ""}` : ""
  return `- ${p.id} · ${p.title} · ${facts.join(" · ")}` + (about ? `\n  ${about}` : "")
}

function foundText(found: FoundPapers, none: string) {
  const source = { openalex: "OpenAlex", s2: "Semantic Scholar", arxiv: "arXiv", crossref: "Crossref" }[found.source] ?? found.source
  const head = [found.matched, `from ${source}`, found.total !== undefined && found.total > found.papers.length ? `${found.papers.length} of ${found.total}` : "", found.note ?? ""].filter(Boolean).join(" · ")
  if (!found.papers.length) return `${none} (${head})`
  return `${head}\n${found.papers.map((p) => foundLine(p)).join("\n")}`
}

// The tool's optional arguments under their RPC names, leaving out the ones not given
function pickArgs(args: Record<string, unknown>, names: Record<string, string>) {
  return Object.fromEntries(Object.entries(names).flatMap(([to, from]) => (args[from] === undefined || args[from] === null || args[from] === "" ? [] : [[to, args[from]]])))
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
    if (prop.type === "array") {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return `${key} should be a list of strings.`
      continue
    }
    if (typeof value !== prop.type) return `${key} should be a ${prop.type}.`
    if (prop.enum && !prop.enum.includes(value as string)) return `${key} should be one of ${prop.enum.join(", ")}.`
  }
  return null
}

const text = (body: string): CallToolResult => ({ content: [{ type: "text", text: body }] })
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true })

// Who a search is by, so a thread's About can tell its batches apart
const searcher = (options: OwlitMcpOptions) => (options.chatId ? `chat:${options.chatId}` : options.run ? `run:${options.run}` : "agent")
