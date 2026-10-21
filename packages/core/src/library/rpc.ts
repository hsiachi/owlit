import { t } from "@lingui/core/macro"
import { isOwlit, RpcErrorCode, type ActorId, type Highlight, type Paper, type PaperPatch, type ReadTrace, type ResultOf } from "@owlit/protocol"
import { z } from "zod"
import type { Journal } from "../activity/journal.ts"
import { readingOf, readJournal, traceOf } from "../activity/reading.ts"
import type { Target } from "../agents/policy.ts"
import type { ReadLog } from "../agents/read-from.ts"
import type { Turns } from "../agents/turns.ts"
import { newWriteId } from "../changes/record.ts"
import { sha1 } from "../fs-util.ts"
import { noParams, RpcFailure, type Caller, type Policy, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { noteRelPath } from "./state.ts"
import { wearOf } from "./wear.ts"

interface Deps {
  router: Router
  turns: Turns
  // What agents read of the library, by who asked
  reads: ReadLog
  journal: Journal
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // A change to a paper, recorded field by field (Core.updatePaper)
  updatePaper: (id: string, patch: PaperPatch, caller: Caller, origin?: { via: "auto" }) => Promise<Paper>
  // Owlit writing a paper's digest, as a chat about the paper (Core.requestDigest)
  requestDigest: (id: string, rewrite?: boolean) => Promise<ResultOf<"library.requestDigest">>
}

export function registerLibrary({ router, turns, reads, journal, requireWorkspace, updatePaper, requestDigest }: Deps) {
  const library = () => requireWorkspace().library
  router.register("library.resolve", z.object({ input: z.string().min(1) }), "read", ({ input }) => library().resolve(input))
  // A search's results are kept for hours; a thread's papers are in the Library: an agent filling a column a day
  // later still gets the whole abstract
  router.register("library.found", z.object({ id: z.string().min(1) }), "read", async ({ id }) => (await library().snapshot(id)) ?? null)
  router.register("library.known", z.object({ inputs: z.array(z.string()) }), "read", ({ inputs }) => library().known(inputs))
  router.register("library.list", noParams, "read", () => library().list())
  router.register("library.papers", noParams, "read", () => library().papers())
  router.register("library.get", z.object({ id: z.string().min(1) }), "read", ({ id }) => library().one(id))
  const paperId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  const ids = z.object({ doi: z.string(), arxiv: z.string(), s2: z.string(), openalex: z.string(), url: z.string() }).partial()
  const kind = z.enum(["article", "conference", "preprint", "book", "thesis", "other"])
  const resolved = z.object({
    id: paperId.optional(),
    title: z.string(),
    authors: z.array(z.string()),
    ids,
    year: z.number().optional(),
    venue: z.string().optional(),
    abstract: z.string().optional(),
    kind: kind.optional(),
  })
  // A paper added is the adder's own, whoever adds it (addedBy), until someone else touches it
  router.register(
    "library.add",
    z.object({ paper: resolved, chatId: z.string().optional() }), "own",
    async ({ paper }, caller) => {
      const ws = requireWorkspace()
      const { paper: added, existed } = await library().addNew(paper, await ws.recorder.actorOf(caller))
      // A paper the library had already isn't the adder's to take back
      if (!existed) await ws.recorder.record(caller, { action: "create", target: { kind: "paper", path: added.id } }, { label: added.title, quiet: caller.kind === "window" })
      return added
    },
  )
  const position = z.object({ page: z.number(), y: z.number() })
  const patch = z
    .object({
      title: z.string(),
      authors: z.array(z.string()),
      year: z.number().optional(),
      venue: z.string().optional(),
      abstract: z.string().optional(),
      kind: kind.optional(),
      ids,
      starred: z.boolean(),
      status: z.enum(["unread", "reading", "read"]),
      tags: z.array(z.string()),
      position,
      view: z.enum(["digest", "pdf"]),
      digestPosition: z.object({ y: z.number() }),
      lastOpenedAt: z.number(),
    })
    .partial()
  // A paper's marks (star, status, tags) and where it was left are meta; its details are the person's words
  const DETAILS = new Set<keyof PaperPatch>(["title", "authors", "year", "venue", "abstract", "kind", "ids"])
  router.register(
    "library.update",
    z.object({ id: paperId, patch }),
    { touches: ({ patch }) => ((Object.keys(patch) as (keyof PaperPatch)[]).some((f) => DETAILS.has(f)) ? "words" : "meta") },
    ({ id, patch }, caller) => updatePaper(id, patch, caller),
  )
  // The reader opened a paper: its status follows on its own, the person's all the same (via auto)
  router.register("library.opened", z.object({ id: paperId }), "meta", async ({ id }, caller) => {
    const paper = await library().get(id)
    if (!paper) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the library.`)
    return updatePaper(id, { lastOpenedAt: Date.now(), ...(paper.status === "unread" ? { status: "reading" as const } : {}) }, caller, { via: "auto" })
  })
  router.register("library.remove", z.object({ ids: z.array(paperId) }), "structure", async ({ ids }, caller) => {
    const ws = requireWorkspace()
    const titles = new Map(await Promise.all(ids.map(async (id) => [id, (await ws.library.get(id))?.title] as const)))
    await library().remove(ids)
    const writeId = newWriteId()
    for (const [id, title] of titles) if (title !== undefined) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: title, quiet: true })
    return null
  })
  // An agent's own additions; each removal is a change the user can undo. The library's own check
  // (addedBy, and nothing of the user's on the paper) holds past the log's keep window too.
  router.register("library.removeByAgent", z.object({ ids: z.array(z.string()) }), { touches: "own", target: ({ ids }) => papersTarget(ids) }, async ({ ids }, caller) => {
    const ws = requireWorkspace()
    // Named as the user knows them, while they are still there to read
    const titles = new Map(await Promise.all(ids.map(async (id) => [id, (await ws.library.get(id))?.title ?? id] as const)))
    const done = await ws.library.removeByAgent(ids)
    const writeId = newWriteId()
    for (const id of done.removed) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: titles.get(id) ?? id })
    return done
  })
  router.register("library.restore", z.object({ ids: z.array(paperId) }), "structure", async ({ ids }, caller) => {
    const ws = requireWorkspace()
    const here = new Set((await Promise.all(ids.map(async (id) => ((await ws.library.get(id)) ? id : null)))).filter(Boolean))
    const restored = await library().restore(ids)
    const writeId = newWriteId()
    for (const p of restored) if (!here.has(p.id)) await ws.recorder.record(caller, { action: "create", target: { kind: "paper", path: p.id }, origin: { writeId } }, { label: p.title, quiet: true })
    return restored
  })
  router.register("library.trash", noParams, "read", () => library().trash())
  router.register("library.refresh", z.object({ id: paperId }), "meta", ({ id }) => library().refresh(id))
  const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  const highlight = z.object({
    id: z.string().min(1),
    paperId,
    page: z.number().int().nonnegative(),
    rects: z.array(rect.extend({ page: z.number().int().nonnegative() })),
    text: z.string(),
    color: z.enum(["yellow", "green", "blue", "pink"]),
    comment: z.string().optional(),
    createdAt: z.number(),
  })
  // A highlight's owner is whoever added it; one not there yet is the caller's to make
  const highlightTarget = async (paperId: string, id: string): Promise<Target> => {
    const was = (await library().highlights(paperId).catch(() => [] as Highlight[])).find((h) => h.id === id)
    return { what: "highlight", ...(was ? { by: was.addedBy, was } : {}) }
  }
  const HIGHLIGHT_PUT: Policy<"library.putHighlight"> = {
    touches: (_params, target, who) => (target.by === undefined || target.by === who.actor ? "own" : "words"),
    target: ({ highlight }) => highlightTarget(highlight.paperId, highlight.id),
  }
  router.register("library.putHighlight", z.object({ highlight, chatId: z.string().optional() }), HIGHLIGHT_PUT, async ({ highlight, chatId }, caller) => {
    // The window draws an agent's highlight for the chat it came from; a program names no chat this way
    // (rpc/socket.ts)
    const by: Caller = chatId && caller.kind === "window" ? { kind: "owlit", chatId } : caller
    return (await library().putHighlight(highlight, await requireWorkspace().recorder.actorOf(by))).highlight
  })
  router.register("library.removeHighlight", z.object({ paperId, id: z.string() }), { touches: "own", target: ({ paperId, id }) => highlightTarget(paperId, id) }, ({ paperId, id }) =>
    library().removeHighlight(paperId, id),
  )

  router.register("library.importPdf", z.object({ path: z.string().min(1) }), "own", async ({ path }, caller) => {
    const done = await library().importPdf(path)
    if (!done.existed) await requireWorkspace().recorder.record(caller, { action: "create", target: { kind: "paper", path: done.paper.id } }, { label: done.paper.title, quiet: true })
    return done
  })
  router.register("library.digest", z.object({ id: paperId }), "read", ({ id }) => library().digest(id))
  router.register("library.digestSource", z.object({ id: paperId }), "read", ({ id }) => library().digestSource(id))
  router.register("library.requestDigest", z.object({ id: z.string().min(1), rewrite: z.boolean().optional() }), "own", ({ id, rewrite }) => requestDigest(id, rewrite))
  router.register(
    "library.writeDigest",
    z.object({ id: z.string().min(1), summary: z.string(), details: z.string() }),
    "own",
    async ({ id, summary, details }, caller) => {
      const ws = requireWorkspace()
      const chatId = caller.kind === "window" ? undefined : caller.chatId
      // The agent and model of the turn that writes it, and the pictures that chat sent, when it is the
      // chat about this paper
      const turn = chatId ? turns.inFlight().find((t) => t.chatId === chatId) : undefined
      const chat = chatId ? await ws.chats.get(chatId).catch(() => null) : null
      const canonical = (await ws.library.canonical(id)) ?? id
      const pictures = chatId && chat?.about?.kind === "paper" && chat.about.id === canonical ? turns.picturesSent(chatId) : undefined
      const by = turn?.message.connectorId ?? chat?.connectorId ?? "unknown"
      const model = turn?.message.modelId ?? chat?.modelId
      const done = await ws.library.writeDigest(id, { summary, details }, { by, ...(model ? { model } : {}), ...(pictures !== undefined ? { pictures } : {}) })
      await ws.recorder.record(
        caller,
        {
          action: done.before === null ? "create" : "update",
          target: { kind: "paper", path: done.id, part: "digest" },
          ...(done.beforeRecord ? { before: done.beforeRecord } : {}),
          after: done.record,
          afterHash: sha1(done.text),
          ...(done.before !== null ? { content: done.before } : {}),
        },
        { label: done.title },
      )
      return { id: done.id }
    },
  )
  router.register("library.figures", z.object({ id: paperId }), "read", ({ id }) => library().figures(id))
  // An agent looking at a figure or a page: a read, recorded as one of that page (read-from.ts)
  router.register(
    "library.figure",
    z.object({ id: z.string().min(1), figure: z.string().min(1).optional(), page: z.number().int().min(1).optional(), asker: z.string().optional() }),
    "read",
    async ({ id, figure, page, asker }) => {
      const picture = await library().figurePicture(id, { figure, page })
      const paperId = (await library().canonical(id)) ?? id
      if (asker) reads.record({ asker, paperId, part: "text", pages: String(picture.page), at: Date.now() })
      return picture
    },
  )
  router.register("library.pagePicture", z.object({ id: paperId, page: z.number().int().min(0) }), "read", ({ id, page }) => library().pagePicture(id, page))
  router.register(
    "library.read",
    z.object({ id: paperId, part: z.enum(["text", "digest", "note"]), pages: z.string().optional(), section: z.string().optional(), asker: z.string().optional() }), "read",
    async ({ id, part, pages, section, asker }) => {
      const read = await library().read(id, part, { pages, section })
      // Only what was there to read counts as read; a whole text cut at a page counts as the pages that came
      if (asker && read.text.trim()) {
        const got = read.upTo ? `1-${read.upTo}` : pages
        reads.record({ asker, paperId: id, part, ...(got ? { pages: got } : {}), ...(section ? { section } : {}), ...(read.pages ? { of: read.pages } : {}), at: Date.now() })
      }
      return read
    },
  )
  const year = z.string().max(20).optional()
  const sort = z.enum(["relevance", "citations", "newest"]).optional()
  router.register(
    "library.searchOnline",
    z.object({
      q: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
      by: z.string().optional(),
      source: z.enum(["openalex", "s2", "arxiv"]).optional(),
      year,
      sort,
      minCitations: z.number().int().nonnegative().optional(),
      type: z.enum(["article", "review", "preprint", "book"]).optional(),
      author: z.string().min(1).optional(),
      venue: z.string().min(1).optional(),
      openAccess: z.boolean().optional(),
    }), "read",
    ({ q, by, ...options }) => library().searchOnline(q, options, by),
  )
  router.register(
    "library.related",
    z.object({ ref: z.string().min(1), kind: z.enum(["references", "cited_by", "similar"]), limit: z.number().int().positive().max(100).optional(), year, sort, by: z.string().optional() }), "read",
    ({ ref, kind, by, ...options }) => library().related(ref, kind, options, by),
  )
  router.register(
    "library.journal",
    z.object({
      journal: z.string().min(1),
      year: z.string().min(4).max(20),
      query: z.string().optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(200).optional(),
      by: z.string().optional(),
    }), "read",
    ({ journal, year, by, ...options }) => library().journal(journal, year, options, by),
  )
  router.register("library.highlights", z.object({ id: paperId }), "read", ({ id }) => library().highlights(id))
  router.register(
    "library.import",
    z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1), collectionsAsTags: z.boolean().optional(), parse: z.boolean().optional() }), "own",
    ({ source, path, collectionsAsTags, parse }) => library().imports.start(source, path, { collectionsAsTags, parse }),
  )
  router.register("library.previewImport", z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1) }), "read", ({ source, path }) =>
    library().imports.preview(source, path),
  )
  router.register("library.continueImport", z.object({ id: z.string().min(1) }), "own", ({ id }) => library().imports.continue(id))
  router.register("library.imports", noParams, "read", () => library().imports.list())
  router.register("library.findZotero", noParams, "read", () => library().imports.findZotero())
  router.register("library.importAnswer", z.object({ id: z.string().min(1), parse: z.boolean() }), "own", ({ id, parse }) => library().imports.answer(id, parse))
  router.register("library.dismissImport", z.object({ id: z.string().min(1) }), "own", async ({ id }) => {
    await library().imports.dismiss(id)
    return null
  })
  router.register("library.text", z.object({ id: paperId }), "read", ({ id }) => library().text(id))
  router.register("library.findPassage", z.object({ id: paperId, quote: z.string().min(1).max(4000) }), "read", async ({ id, quote }) => {
    const page = await requireWorkspace().findPassage(id, quote)
    return typeof page === "number" ? { page } : null
  })
  router.register("library.passage", z.object({ id: paperId, quote: z.string().min(1).max(4000) }), "read", ({ id, quote }) => requireWorkspace().passage(id, quote))
  // What has been read of a paper, for its reader: what Owlit's answers cited of it, and where the person stayed
  router.register("library.wear", z.object({ id: paperId }), "read", async ({ id }) => {
    const ws = requireWorkspace()
    return wearOf(id, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases: await ws.library.aliases() })
  })
  router.register("library.trace", z.object({ ids: z.array(paperId).max(500) }), "read", async ({ ids }) => {
    const ws = requireWorkspace()
    await journal.flush()
    const [aliases, entries] = await Promise.all([ws.library.aliases(), readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])])
    const readings = readingOf(entries, (id) => aliases[id] ?? id)
    const out: Record<string, ReadTrace> = {}
    for (const id of ids) out[id] = traceOf(readings.get(aliases[id] ?? id), (await ws.library.get(id))?.status)
    return out
  })
  router.register("library.fetchPdf", z.object({ id: paperId }), "meta", ({ id }) => library().fetchPdf(id))
  router.register("library.fetchPdfs", z.object({ ids: z.array(paperId) }), "meta", ({ ids }) => library().fetchPdfs(ids))
  router.register("library.attachPdf", z.object({ id: paperId, path: z.string().min(1) }), "meta", ({ id, path }) =>
    library().attachPdf(id, path),
  )
  router.register("library.setNote", z.object({ paperId, content: z.string() }), "words", async ({ paperId, content }, caller) => {
    const before = (await library().read(paperId, "note")).text
    const note = await library().setNote(paperId, content)
    await requireWorkspace().recorder.saved(caller, noteRelPath(paperId), before || null, content)
    return note
  })

  // Whose papers these are: who added them (a person's or an outside addition names the owner before an
  // Owlit's; every adder counts as having touched the batch, so papers of two Owlits aren't one's), and
  // whoever else changed one since it was added, from the log
  async function papersTarget(ids: string[]): Promise<Target> {
    const ws = requireWorkspace()
    const papers = (await Promise.all(ids.map((id) => ws.library.get(id)))).filter((p): p is Paper => p !== null)
    const changes = await ws.changes.list({ target: { kind: "paper" } })
    const adders = [...new Set(papers.map((p) => p.addedBy))]
    const touchedBy: ActorId[] = [...adders]
    for (const p of papers) {
      const added = changes.findLast((c) => c.target.path === p.id && c.action === "create")
      for (const c of changes) if (c.target.path === p.id && c.actor !== p.addedBy && (!added || c.at > added.at)) touchedBy.push(c.actor)
    }
    const theirs = papers.find((p) => !isOwlit(p.addedBy))
    const by = theirs?.addedBy ?? adders[0]
    return { what: theirs ? `paper ${theirs.id}` : "paper", ...(by ? { by } : {}), touchedBy }
  }
}
