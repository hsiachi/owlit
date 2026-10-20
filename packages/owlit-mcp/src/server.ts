// owlit-mcp: an MCP server giving agents owlit's library, docs and chats, through the open workspace's
// socket. owlit hands it to every agent it runs; it can also be configured in an agent outside owlit.

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { connect, OwlitNotRunning, type OwlitClient } from "@owlit/client"
import {
  threadUri,
  OWLIT_TOOLS,
  QUESTION_COLUMN,
  shownThread,
  type CommentInput,
  type ThreadCell,
  type ThreadColumn,
  type ThreadGroup,
  type ThreadRead,
  type ThreadRowWrite,
  type ThreadWrite,
  type DocComment,
  type FoundPaper,
  type FoundPapers,
  type HighlightColor,
  type MemoryKind,
  type ReadStatus,
  type Paper,
  pdfWait,
  type PdfEnded,
  type ToolSpec,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { activityQueryOf, activityText } from "./activity.ts"

export interface OwlitMcpOptions {
  workspace: string
  // The chat this agent is answering in, when owlit started it for one
  chatId?: string
  // Where the socket is when not in the temp folder (tests)
  socketDir?: string
  // Told to the agent when it connects; owlit's rules for agents
  instructions?: string
}

// When owlit wasn't running to give its rules
const FALLBACK_INSTRUCTIONS =
  "owlit is the user's research workspace: their papers (library_*), their Markdown docs (docs_*) and the comments on them (comments_*), their chats (chats_*) and threads (thread_*). Cite papers as [Author Year](owlit://library/<id>)."

// Started for no chat, owlit-mcp serves an agent outside owlit (the `owlit mcp` command), which
// core lets read and refuses every change (agents/policy.ts); the rules that follow are written for Owlit
// inside the app, so this goes first
export const OUTSIDE_INSTRUCTIONS =
  "You are reading the user's owlit workspace from outside owlit. Through these tools you can read their papers, docs, comments, chats and threads, but you can't change anything in it from here: when a change would help, say what it is, and the user makes it in the owlit app or asks Owlit there. The rules below are written for Owlit inside the app; what they say about reading and citing applies to you, what they say about changing things doesn't."

export function createServer(options: OwlitMcpOptions) {
  const outside = !options.chatId
  const instructions = options.instructions ?? FALLBACK_INSTRUCTIONS
  const server = new Server({ name: "owlit", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: outside ? `${OUTSIDE_INSTRUCTIONS}\n\n${instructions}` : instructions })
  let client: Promise<OwlitClient> | null = null
  // Connected on first use, and again after owlit closed and opened again
  const owlit = async () => {
    client ??= connect(options.workspace, { dir: options.socketDir, as: options.chatId ? { chatId: options.chatId } : {} }).catch((error) => {
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
      // Claude Code names the tool call an MCP request is for; it is the same id as the ACP tool call
      const toolCallId = request.params._meta?.["claudecode/toolUseId"]
      return text(await run(spec.name, args, await owlit(), options, typeof toolCallId === "string" ? toolCallId : undefined))
    } catch (error) {
      if (error instanceof OwlitNotRunning) {
        client = null
        return failure(error.message)
      }
      const message = error instanceof Error ? error.message : String(error)
      // Core names the method it checked, which the agent never saw; the tool is what it called
      return failure(message.replace(/^[\w.]+ got parameters it can't use/, `${spec.name} got parameters it can't use`))
    }
  })
  return server
}

async function run(tool: string, args: Record<string, unknown>, owlit: OwlitClient, options: OwlitMcpOptions, toolCallId?: string): Promise<string> {
  const str = (key: string) => args[key] as string
  const num = (key: string) => args[key] as number | undefined
  const optStr = (key: string) => (args[key] as string | undefined) || undefined
  // The chat this agent is answering in, so the window keeps it in view
  const asker = options.chatId ? { chatId: options.chatId } : {}
  // The tool call a change comes from, for the change log (the chat is the connection's, said at auth);
  // the chat again for the methods that take it as a param. Whether a change may be made at all is core's
  // policy to decide, by the connection's chat and its role; a refusal comes back as the tool's answer.
  const writer = { ...asker, ...(toolCallId ? { toolCallId } : {}) }
  switch (tool) {
    case "library_list": {
      const { papers } = await owlit.rpc.library.list()
      const extension = await hasExtension(owlit)
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
      return shown.map((p) => paperLine(p, extension)).join("\n") + more
    }
    case "library_get": {
      // Any id the paper goes by: a search's, or one it had before it moved or a copy was folded into it
      const [[here], { papers, notes }] = await Promise.all([owlit.rpc.library.known({ inputs: [str("id")] }), owlit.rpc.library.list()])
      const paper = papers.find((p) => p.id === (here ?? str("id")))
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
          ...(paper.pdf ? {} : { noPdf: pdfFact(paper, await hasExtension(owlit)) }),
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
      // Signed like a search, so the chat's answer can say what it read
      const { text, pages } = await owlit.rpc.library.read({ id: str("id"), part, pages: args.pages as string | undefined, section: args.section as string | undefined, asker: searcher(options) })
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
      const lines: string[] = []
      for (const ref of refs) {
        try {
          const { paper, existingId, learned } = await owlit.rpc.library.resolve({ input: ref })
          if (existingId) {
            const taught = learned?.length ? ` It now knows the paper's ${learned.map((k) => ID_NAMES[k]).join(" and ")} too, and looks for its PDF there when it has none.` : ""
            lines.push(`Already in the library as ${existingId}: ${paper.title}.${taught}`)
            continue
          }
          const added = await owlit.rpc.library.add({ paper, ...writer })
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
      const done = await owlit.rpc.library.removeByAgent({ ids, ...writer })
      return [...done.removed.map((id) => `Removed ${id}.`), ...done.refused.map((r) => `Kept ${r.id}: ${r.why}.`)].join("\n")
    }
    case "library_update": {
      const ids = [...new Set((args.ids as string[]).map((r) => r.trim()).filter(Boolean))]
      const patch = {
        ...(typeof args.starred === "boolean" ? { starred: args.starred } : {}),
        ...(optStr("status") ? { status: optStr("status") as ReadStatus } : {}),
        ...(Array.isArray(args.tags) ? { tags: [...new Set((args.tags as string[]).map((t) => t.trim()).filter(Boolean))] } : {}),
      }
      if (!ids.length) return "library_update needs at least one id."
      if (!Object.keys(patch).length) return "library_update needs starred, status or tags."
      const lines: string[] = []
      for (const id of ids) {
        try {
          const p = await owlit.rpc.library.update({ id, patch, ...writer })
          lines.push(`${p.id}: ${[p.starred ? "starred" : "not starred", p.status, p.tags.length ? `tags ${p.tags.join(", ")}` : "no tags"].join(", ")}.`)
        } catch (error) {
          lines.push(`Couldn't change ${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return lines.join("\n")
    }
    case "library_unmark": {
      const wanted = str("quote").replace(/\s+/g, " ").trim()
      const highlights = await owlit.rpc.library.highlights({ id: str("id") })
      const found = highlights.find((h) => h.text.replace(/\s+/g, " ").trim() === wanted)
      if (!found) return `No highlight in ${str("id")} reads that way; quote the passage as you marked it.`
      await owlit.rpc.library.removeHighlight({ paperId: str("id"), id: found.id, ...writer })
      return `Removed the highlight on p. ${found.page + 1} of ${str("id")}.`
    }
    // Every digest is written the same way, in a chat of its own about the paper, in the user's language
    // and with the paper's figures; a chat's agent asks for one rather than writing its own
    case "library_request_digest": {
      const id = str("id")
      const asked = await owlit.rpc.library.requestDigest({ id })
      if ("chatId" in asked) return `Owlit is writing a digest for ${id}; it appears on the paper's page when done.`
      if ("gettingText" in asked) return `owlit is reading the text of ${id} first; then Owlit writes its digest, which appears on the paper's page when done.`
      if (asked.heldBack === "has-digest") return `${id} has a digest already; read it with library_read part=digest.`
      return `No digest: the paper has no PDF or text in owlit.`
    }
    case "library_write_digest": {
      const done = await owlit.rpc.library.writeDigest({ id: str("id"), summary: str("summary"), details: str("details"), ...writer })
      return `Wrote the digest of ${done.id}; it shows on the paper's page.`
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
    case "docs_write": {
      const { path: written, created } = await owlit.rpc.agents.writeDoc({ path: str("path"), content: str("content"), ...writer })
      return `${created ? "Wrote the new doc" : "Rewrote your doc"} ${written}. The user sees it among their docs and can undo it.`
    }
    case "docs_delete": {
      const paths = (args.paths as string[]).filter(Boolean)
      if (!paths.length) return "Name at least one doc or folder to delete."
      const { deleted } = await owlit.rpc.agents.deleteDocs({ paths, ...writer })
      return `Deleted ${deleted.join(", ")}. They are in the Trash, and the user can undo it from the chat.`
    }
    case "docs_move": {
      const moved = await owlit.rpc.agents.moveDoc({ path: str("path"), to: str("to"), ...writer })
      return `Moved ${str("path")} to ${moved.path}.`
    }
    case "docs_comments": {
      const comments = ((await owlit.rpc.comments.all())[str("path")] ?? []).filter((c) => !c.foldedAt)
      if (!comments.length) return `There are no comments on ${str("path")}.`
      const me = owlitOf(comments)
      const who = (by: string) => (by === me ? "Owlit (you)" : by.startsWith("o_") ? "Owlit" : by === "other" ? "someone" : "the user")
      return [...comments.filter((c) => !c.resolvedAt), ...comments.filter((c) => c.resolvedAt)]
        .map((c) => [`- ${c.id}${c.resolvedAt ? " (resolved)" : ""} on "${c.quote.replace(/\s+/g, " ").slice(0, 80)}"`, ...c.entries.map((e) => `  ${who(e.by)}: ${e.text}`)].join("\n"))
        .join("\n")
    }
    case "comments_reply":
    case "comments_resolve": {
      const comment = ((await owlit.rpc.comments.all())[str("path")] ?? []).find((c) => c.id === str("id"))
      if (!comment) return `There is no comment ${str("id")} on ${str("path")}; docs_comments lists them.`
      if (tool === "comments_resolve" && comment.resolvedAt) return `That comment is already resolved.`
      const at = Date.now()
      const entry = { id: randomUUID(), text: tool === "comments_reply" ? str("text") : str("reply"), at, ...(options.chatId ? { chatId: options.chatId } : {}) }
      // Core signs the new entry as this agent's Owlit and decides, by the chat's role, whether it may
      await owlit.rpc.comments.put({ path: str("path"), comment: { ...comment, entries: [...comment.entries, entry], ...(tool === "comments_resolve" ? { resolvedAt: at } : {}) }, ...writer })
      return tool === "comments_reply" ? `Replied under the comment on "${comment.quote.slice(0, 60)}". The user sees it beside the doc.` : `Resolved the comment on "${comment.quote.slice(0, 60)}" with your reply. The user can reopen it with Undo.`
    }
    case "comments_remove": {
      const removed = await owlit.rpc.comments.remove({ path: str("path"), id: str("id"), ...writer })
      return removed ? `Removed your comment on "${removed.quote.slice(0, 60)}".` : `There is no comment ${str("id")} on ${str("path")}.`
    }
    case "docs_add_comment": {
      const { content } = await owlit.rpc.docs.read({ path: str("path") })
      const anchor = anchorOf(content, str("quote"))
      if (!anchor) return `That passage isn't in ${str("path")} word for word; quote it exactly as it appears.`
      const at = Date.now()
      // Core signs each entry as this agent's Owlit
      const comment: CommentInput = {
        id: randomUUID(),
        ...anchor,
        entries: [
          { id: randomUUID(), text: str("comment"), at, ...(options.chatId ? { chatId: options.chatId } : {}) },
          // Owlit's own word under a point carried over from someone else
          ...(optStr("own") ? [{ id: randomUUID(), text: optStr("own")!, at, ...(options.chatId ? { chatId: options.chatId } : {}) }] : []),
        ],
        createdAt: at,
        // The reading it carries the point over from; core checks it and names it
        ...(optStr("record") ? { source: { path: optStr("record")!, label: "" } } : {}),
      }
      await owlit.rpc.comments.add({ path: str("path"), comment, ...writer })
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
      return all
        .map((c) => {
          const size = `${c.papers} paper${c.papers === 1 ? "" : "s"}${c.columns ? `, ${c.columns} column${c.columns === 1 ? "" : "s"}` : ""}`
          return `- ${c.id} · ${c.title}${c.project ? ` · in ${c.project}` : ""} · ${size}\n  Asked: ${c.question}${c.one ? `\n  ${c.one}` : ""}`
        })
        .join("\n")
    }
    case "thread_read":
      return threadText(await owlit.rpc.threads.get({ id: str("id") }))
    case "thread_write": {
      const write = threadWriteOf(args)
      if (typeof write === "string") return write
      const done = await owlit.rpc.threads.write({ ...write, ...writer })
      const counts = [done.added ? `added ${done.added}` : "", done.updated ? `updated ${done.updated}` : ""].filter(Boolean).join(", ")
      const wrote = `Wrote “${done.title}” (${threadUri(done.id)})${counts ? `: ${counts}` : ""}. Link it in your answer as [${done.title}](${threadUri(done.id)}).`
      return done.left?.length ? `${wrote}\nLeft out, the rest went in; fix these and write them again:\n- ${done.left.join("\n- ")}` : wrote
    }
    case "thread_edit": {
      // The title is Owlit's own, so it goes through a write of its own (a threads.edit rename is the
      // user's)
      await owlit.rpc.threads.write({ id: str("id"), title: str("title").trim(), ...writer })
      const thread = await owlit.rpc.threads.get({ id: str("id") })
      return `“${thread.title}” (${threadUri(thread.id)}).`
    }
    case "memory_write": {
      const op = str("op") as "add" | "replace" | "remove"
      const { line, before, changeId } = await owlit.rpc.memory.write({
        op,
        ...pickArgs(args, { id: "id", text: "text" }),
        ...(optStr("kind") ? { kind: optStr("kind") as MemoryKind } : {}),
        ...writer,
      })
      if (!changeId) return `Already kept as ${line?.id}: "${line?.text}". Nothing changed.`
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
  is?: string
  answer?: string
  depth?: string
  quote?: string
  found_by?: string
  group?: string
  groups?: string[]
  cells?: Record<string, { text?: string; depth?: string; quote?: string; rel?: string; sentence?: string }>
}

// thread_write's arguments as core takes them (rows, groups as JSON text or arrays), or what to tell the agent
export function threadWriteOf(args: Record<string, unknown>): ThreadWrite | string {
  const parsed = parseJsonArgs(args, ["rows", "groups"])
  if (typeof parsed === "string") return parsed
  const rows = (parsed.rows as RowArg[] | undefined)?.map(rowWrite)
  const problem = rows?.find((r) => typeof r === "string")
  if (problem) return problem
  return {
    ...pickArgs(args, { id: "id", asked: "asked", title: "title", project: "project", report: "report", one: "one", note: "note", grouping: "grouping", newGrouping: "new_grouping" }),
    ...(rows ? { rows: rows as ThreadRowWrite[] } : {}),
    ...(parsed.groups ? { groups: parsed.groups as ThreadGroup[] } : {}),
    ...(Array.isArray(args.columns) ? { columns: (args.columns as string[]).map((question) => ({ question })) } : {}),
    ...(Array.isArray(args.remove_rows) ? { removeRows: args.remove_rows as string[] } : {}),
  }
}

// A row as the agent gives it (what it is, how it was found, answer, depth and quote for the question;
// other columns in cells), as core takes it; or what to tell the agent
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
  return {
    id: r.id,
    ...(typeof r.is === "string" && r.is.trim() ? { is: r.is } : {}),
    ...(typeof r.found_by === "string" && r.found_by.trim() ? { foundBy: r.found_by } : {}),
    ...(Object.keys(cells).length ? { cells } : {}),
    ...(r.group !== undefined ? { group: r.group } : {}),
    ...(Array.isArray(r.groups) ? { groups: r.groups.map(String) } : {}),
  }
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

// A thread as the agent reads it: the question and later ones, the columns (a comparison with its
// sentences; one out of the user's sight marked so), the groupings with their groups, the report, and each
// paper as what it is · how it bears on the question · how it was found · its groups, then its other answers
export function threadText(stored: ThreadRead) {
  const c = shownThread(stored)
  const asks = c.columns.filter((col) => col.kind !== "grouping")
  const groupings = c.columns.filter((col) => col.kind === "grouping")
  const groupName = new Map(groupings.flatMap((col) => (col.groups ?? []).map((g) => [`${col.id}:${g.id}`, g.name] as const)))
  const hidden = (col: ThreadColumn) => (col.hidden ? " (hidden from the user)" : "")
  const columnLine = (col: ThreadColumn) =>
    col.kind === "compare"
      ? `${col.id}${hidden(col)} = set against sentences of ${col.doc ?? col.question}: ${(col.sentences ?? []).map((l) => `${l.id} «${l.text}»`).join("; ")}`
      : `${col.id}${hidden(col)} = ${col.question}`
  const answer = (cell: ThreadCell) => `${cell.text} [${cell.depth}${cell.passage ? `, p. ${cell.passage.page}` : ""}]`
  const lines = [
    `${c.title} (${threadUri(c.id)})`,
    `Asked: ${c.asked.text}${c.project ? ` · project ${c.project}` : ""}${c.sources.length ? ` · looked in ${c.sources.join(", ")}` : ""}`,
    ...(c.alsoAsked?.length ? [`Later questions added here: ${c.alsoAsked.map((a) => `«${a.text}»`).join("; ")}`] : []),
    `Columns: ${asks.map(columnLine).join("; ")}`,
    ...groupings.map(
      (col) =>
        `Grouping ${col.id} (${col.question})${(col.groups ?? []).length ? `: ${(col.groups ?? []).map((g) => `${g.id} = ${g.name}${g.one ? ` (${g.one})` : ""}${g.parent ? ` [in ${g.parent}]` : ""}`).join("; ")}` : ", no groups yet"}`,
    ),
    "",
    "Report:",
    c.report || "(none yet)",
    "",
    `Papers (${c.rows.length}):`,
  ]
  for (const r of c.rows) {
    const p = r.paper
    const q = r.cells[QUESTION_COLUMN]
    const placed = groupings
      .filter((col) => r.in?.[col.id]?.length)
      .map((col) => `${groupings.length > 1 ? `${col.id}: ` : ""}in ${r.in![col.id]!.map((g) => `${g} (${groupName.get(`${col.id}:${g}`) ?? g})`).join(", ")}`)
    const facts = [p.authors[0], p.year, p.venue].filter(Boolean).join(", ")
    const parts = [`- ${r.id} · ${p.title}${facts ? ` (${facts})` : ""}`, r.is ?? "what it is: not said", q ? answer(q) : "no answer yet", ...(r.foundBy ? [`found by ${r.foundBy}`] : []), ...placed]
    lines.push(parts.join(" · "))
    for (const col of asks) {
      const cell = r.cells[col.id]
      if (!cell || col.id === QUESTION_COLUMN) continue
      const said = col.sentences?.find((l) => l.id === cell.sentence)?.text
      const sentence = cell.sentence ? ` ${cell.sentence}${said ? ` «${said}»` : ""}` : ""
      lines.push(`  ${col.id}: ${cell.rel ? `${cell.rel}${sentence}: ` : ""}${answer(cell)}`)
    }
  }
  return lines.join("\n")
}

// This agent's Owlit, as its own entries in these comments name it; none when it hasn't written one
function owlitOf(comments: DocComment[]): string | undefined {
  return comments.flatMap((c) => c.entries).find((e) => e.by.startsWith("o_"))?.by
}

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

function paperLine(p: Paper, extension: boolean) {
  const facts = [
    p.status,
    p.starred ? "starred" : "",
    p.tags.length ? `tags: ${p.tags.join(" ")}` : "",
    pdfFact(p, extension),
    p.text === "full" ? "full text" : "",
    p.hasDigest ? "digest" : "",
  ].filter(Boolean)
  return `- ${p.id} · ${p.title} · ${[shortAuthors(p.authors), p.year, p.venue].filter(Boolean).join(", ")} · ${facts.join(", ")}`
}

// Why a paper has no PDF, in words an agent can pass on, read off where core says it stands (its state
// and the ending of the try that says why), as the window shows it: with only "no PDF", an agent
// suggests a library proxy the user already has, and can't say which sign-in a paper waits for.
const DROP = "the user can drop the PDF on the paper"
// A paper with no PDF, by its state's reason; a not-found that an older record's check or sign-in gave
// says so, since an agent may be asked why
const NO_PDF: Record<"not-found" | "no-access" | "not-offered" | "not-there", string> = {
  "not-found": `no PDF: owlit found no copy it can download (it looks again on its own every few days); ${DROP}`,
  "no-access": `no PDF: the publisher offered access instead of the PDF, so the user's library doesn't seem to subscribe; ${DROP}`,
  "not-offered": `no PDF: the user's library proxy doesn't offer this paper; ${DROP}`,
  "not-there": `no PDF: the publisher has no PDF at the paper's address; ${DROP}`,
}
const OWN_LOOK: Partial<Record<PdfEnded, string>> = {
  check: `no PDF: the publisher stopped owlit's own look with a check; ${DROP}`,
  "sign-in": `no PDF: the publisher wanted a sign-in from owlit's own look; ${DROP}`,
}

// A paper still finding while the owlit extension in the user's browser waits at its site for them: one
// sign-in, check or permission there covers every paper waiting at that site
const WAITS = {
  "for-sign-in": "no PDF yet: waits for the user's library sign-in in their browser (Home says so; one sign-in covers every such paper, and owlit goes on by itself)",
  "for-check": "no PDF yet: waits for the user to pass a check at the publisher's site in their browser (Home says so; once passed, owlit goes on with every paper waiting there)",
  "for-permission": "no PDF yet: waits for the user to let the owlit extension in their browser read the publisher's site, from the extension's button (Home says so)",
} as const

// Without a browser extension allowed to connect, owlit has nothing more to try: an agent can say what
// would. extension: one is (or owlit couldn't say).
const NO_EXTENSION = " (with the owlit extension the user's browser could try; Settings › Papers › Browser extension)"

// A sign-in is the library's only through its proxy; the queue says which, and before the queue has the
// paper again (owlit restarted) it isn't known
const SIGN_IN_AT = (host: string) =>
  `no PDF yet: waits for the user to sign in at ${host} in their browser (Home says so; one sign-in covers every paper waiting there, and owlit goes on by itself)`
const SIGN_IN_UNKNOWN = "no PDF yet: waits for the user's sign-in (the library's or the publisher's) in their browser (Home says so; one sign-in covers every such paper, and owlit goes on by itself)"

// Why a paper has no PDF, in words an agent can pass on, from the window's own reading (pdfWait): with
// only "no PDF", an agent suggests a library proxy the user already has, and can't say which sign-in a
// paper waits for
export function pdfFact(p: Pick<Paper, "pdf" | "pdfState">, extension: boolean) {
  const wait = pdfWait(p)
  const s = p.pdfState
  switch (wait) {
    case undefined:
      return ""
    case "finding":
      return s?.extension ? "no PDF yet (owlit is getting it through the user's browser)" : "no PDF yet (owlit is looking)"
    case "offline":
      return "no PDF yet (waiting for the network)"
    case "for-sign-in":
      if (!s?.extension) return SIGN_IN_UNKNOWN
      return s.extension.proxied ? WAITS[wait] : SIGN_IN_AT(s.extension.host)
    case "for-check":
    case "for-permission":
      return WAITS[wait]
    default:
      return ((s?.reason && OWN_LOOK[s.reason.ended]) ?? NO_PDF[wait]) + (extension ? "" : NO_EXTENSION)
  }
}

// Whether the user allowed a browser's extension to connect; true when owlit couldn't say, so nothing
// is suggested on a guess
async function hasExtension(owlit: OwlitClient) {
  const view = await owlit.rpc.extension.get().catch(() => undefined)
  return !view || view.paired.length > 0
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

const ID_NAMES = { arxiv: "arXiv id", s2: "Semantic Scholar id", openalex: "OpenAlex id" } as const
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
const searcher = (options: OwlitMcpOptions) => (options.chatId ? `chat:${options.chatId}` : "agent")
