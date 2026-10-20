import { t } from "@lingui/core/macro"
import { chatOfFile, isOpenComment, isOwlit, isPerson, RpcErrorCode, type ChangeOrigin, type DocComment } from "@owlit/protocol"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { commentTouches, replyOnly, type Target } from "../agents/policy.ts"
import { newWriteId } from "../changes/record.ts"
import { pickFromText } from "../library/library.ts"
import { extractText, toMarkdown, UnreadablePdf } from "../library/text/extract.ts"
import { docPath, noParams, RpcFailure, type Caller, type Notifier, type Policy, type Router } from "../rpc/index.ts"
import { OWLIT_DIR } from "../workspace/paths.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { commentChanges, correctable, corrected, correctionOf, signed } from "./comments.ts"

interface Deps {
  router: Router
  notifier: Notifier
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // Owlit answers the person's reply under one of its comments, in the chat about it (Core.answerReply)
  answerReply: (ws: Workspace, path: string, id: string) => void
  // pdfium's wasm file (CoreOptions.pdfiumWasm)
  pdfiumWasm?: string
}

// docs.* and comments.*: a doc's text and the comments in its margin
export function registerDocs({ router, notifier, requireWorkspace, answerReply, pdfiumWasm }: Deps) {
  const docs = () => requireWorkspace().docs
  router.register("docs.list", noParams, "read", () => docs().list())
  router.register("docs.read", z.object({ path: docPath }), "read", ({ path }) => docs().read(path))
  // Any agent reads a PDF the user has in the workspace (an attachment, a file that isn't in the Library)
  // through owlit, with the page numbers it would cite; the Owlit engine has no other way to read one
  router.register("docs.readPdf", z.object({ path: docPath, pages: z.string().optional() }), "read", async ({ path: file, pages }) => {
    const ws = requireWorkspace()
    const relPath = ws.docs.resolve(file)
    // Of owlit's own folder, only the copies of files attached in chats are the user's to read
    if (relPath.split("/")[0].toLowerCase() === OWLIT_DIR && !chatOfFile(relPath)) {
      throw new RpcFailure(RpcErrorCode.InvalidParams, `${relPath} is owlit's own state, not a document.`, { path: relPath })
    }
    const bytes = await readFile(path.join(ws.root, relPath)).catch(() => {
      throw new RpcFailure(RpcErrorCode.NotFound, `There is no ${relPath} in the workspace.`, { path: relPath })
    })
    const text = await extractText(bytes, { wasmPath: pdfiumWasm }).catch((error) => {
      throw error instanceof UnreadablePdf ? new RpcFailure(RpcErrorCode.InvalidParams, `${relPath} isn't a PDF owlit can read.`, { path: relPath }) : error
    })
    const markdown = toMarkdown(text)
    if (!markdown.replace(/<!-- page \d+ -->/g, "").trim()) return { text: `${relPath} has no text to read: its pages are images (a scan).`, pages: text.pages.length }
    return pickFromText(markdown, { pages })
  })
  router.register(
    "docs.create",
    z.object({ path: docPath, content: z.string(), id: z.string().min(1).optional(), followsFirstLine: z.boolean().optional() }), "words",
    async ({ path, content, ...options }, caller) => {
      const made = await docs().create(path, content, options)
      await requireWorkspace().recorder.doc(caller, made.path, null, content, {}, { quiet: true })
      return made
    },
  )
  router.register(
    "docs.write",
    z.object({ path: docPath, content: z.string(), expectedModifiedAt: z.number(), force: z.boolean().optional() }), "words",
    ({ path, content, expectedModifiedAt, force }) => docs().write(path, content, expectedModifiedAt, force),
  )
  router.register("docs.rename", z.object({ path: docPath, name: z.string() }), "structure", ({ path, name }, caller) => movingDocs(path, caller, () => docs().rename(path, name)))
  router.register("docs.move", z.object({ path: docPath, folder: z.string() }), "structure", ({ path, folder }, caller) => movingDocs(path, caller, () => docs().move(path, folder)))
  router.register("docs.delete", z.object({ path: docPath }), "structure", async ({ path }, caller) => {
    const texts = await docs().textsUnder(path)
    await docs().delete(path)
    const writeId = newWriteId()
    for (const t of texts) await requireWorkspace().recorder.doc(caller, t.path, t.content, null, { origin: { writeId } }, { quiet: true })
    return null
  })
  router.register("docs.createFolder", z.object({ path: docPath }), "structure", ({ path }) => docs().createFolder(path))
  router.register(
    "docs.restore",
    z.object({ files: z.array(z.object({ id: z.string(), path: docPath, content: z.string() })), folders: z.array(docPath) }), "structure",
    async ({ files, folders }, caller) => {
      const restored = await docs().restore(files, folders)
      const writeId = newWriteId()
      for (const [i, file] of restored.files.entries()) await requireWorkspace().recorder.doc(caller, file.path, null, files[i]!.content, { origin: { writeId } }, { quiet: true })
      return restored
    },
  )
  router.register("docs.open", z.object({ path: docPath }), "admin", ({ path }) => docs().open(path))
  router.register("docs.reveal", z.object({ path: docPath }), "admin", ({ path }) => docs().reveal(path))

  const anchor = z.object({ quote: z.string(), prefix: z.string(), suffix: z.string() })
  const commentSchema = anchor.extend({
    id: z.string().min(1),
    entries: z.array(
      z.object({
        id: z.string().min(1),
        agent: z.string().optional(),
        text: z.string(),
        at: z.number(),
        editedAt: z.number().optional(),
        chatId: z.string().optional(),
      }),
    ),
    createdAt: z.number(),
    resolvedAt: z.number().optional(),
    foldedAt: z.number().optional(),
    source: z.object({ path: z.string(), label: z.string() }).optional(),
  })

  router.register("comments.all", noParams, "read", () => docs().commentsAll())
  // A comment is whoever started it (its first entry); others: who replied under it
  const commentTarget = async (path: string, id: string, { replies = false } = {}): Promise<Target> => {
    const was = (await docs().listComments(path)).find((c) => c.id === id)
    if (!was) return { what: "comment" }
    const by = was.entries[0]?.by
    return { what: "comment", by, was, ...(replies ? { touchedBy: was.entries.slice(1).map((e) => e.by) } : {}) }
  }
  const addComment: Policy<"comments.add"> = { touches: "own", target: ({ path, comment }) => commentTarget(path, comment.id) }
  router.register("comments.add", z.object({ path: docPath, comment: commentSchema }), addComment, async ({ path, comment }, caller) => {
    const agent = caller.kind !== "window"
    // Never over an existing comment (add replaces one with the same id)
    if ((await docs().listComments(path)).some((c) => c.id === comment.id)) throw new RpcFailure(RpcErrorCode.Conflict, agent ? "That comment is already there; an agent adds new ones." : t`That comment is already there.`)
    if (!agent) {
      const made = signed(comment, null, await requireWorkspace().recorder.actorOf(caller))
      await docs().addComment(path, made)
      notifier.notify("comments.changed", { path, comment: made })
      await recordComment(caller, path, null, made)
      return null
    }
    // The record a carried-over point names is checked and named by core (recordSource)
    const { source: claimed, ...own } = signed(comment, null, await requireWorkspace().recorder.actorOf(caller))
    const source = claimed ? await recordSource(caller, claimed.path) : undefined
    await agentComment(path, source ? { ...own, source } : own, caller)
    return null
  })
  const COMMENT_PUT: Policy<"comments.put"> = {
    touches: ({ comment }, target, who) => commentTouches(comment, target, who),
    target: async ({ path, comment }) => {
      const target = await commentTarget(path, comment.id)
      // A reply alone is a new entry of the caller's, whoever started the comment
      if (target.was && replyOnly(comment, target.was as DocComment)) return { what: "reply", was: target.was }
      return target
    },
  }
  router.register("comments.put", z.object({ path: docPath, comment: commentSchema }), COMMENT_PUT, async ({ path, comment: input }, caller) => {
    const was = (await docs().listComments(path)).find((c) => c.id === input.id) ?? null
    const comment = correcting(signed(input, was, await requireWorkspace().recorder.actorOf(caller)), was, caller)
    const before = await putComment(path, comment, caller)
    // A reply of the user's under one of Owlit's comments: Owlit answers it there
    const first = comment.entries[0]
    const last = comment.entries.at(-1)
    if (first && isOwlit(first.by) && last && isPerson(last.by) && !before?.entries.some((e) => e.id === last.id) && isOpenComment(comment)) {
      answerReply(requireWorkspace(), path, comment.id)
    }
    return before
  })
  router.register("comments.remove", z.object({ path: docPath, id: z.string() }), { touches: "own", target: ({ path, id }) => commentTarget(path, id, { replies: true }) }, async ({ path, id }, caller) => {
    const removed = await docs().removeComment(path, id)
    if (removed && caller.kind !== "window") notifier.notify("comments.removed", { path, id })
    await recordComment(caller, path, removed, null)
    return removed
  })
  router.register("comments.reanchor", z.object({ path: docPath, moved: z.record(z.string(), anchor) }), "words", ({ path, moved }) =>
    docs().reanchorComments(path, moved),
  )

  // The window renames or moves a doc or folder: each file under it recorded as leaving its old place and
  // arriving at the new one, sharing one writeId
  async function movingDocs(from: string, caller: Caller, move: () => Promise<{ path: string }>) {
    const ws = requireWorkspace()
    const texts = await ws.docs.textsUnder(from)
    const moved = await move()
    if (moved.path === from) return moved
    const writeId = newWriteId()
    for (const t of texts) {
      await ws.recorder.doc(caller, t.path, t.content, null, { origin: { writeId } }, { quiet: true })
      await ws.recorder.doc(caller, moved.path + t.path.slice(from.length), null, t.content, { origin: { writeId } }, { quiet: true })
    }
    return moved
  }

  // One of Owlit's comments, written as an agent's: recorded in the change log (Undo) and shown in the
  // chat's result card
  async function agentComment(path: string, comment: DocComment, caller: Caller) {
    const ws = requireWorkspace()
    await ws.docs.addComment(path, comment)
    notifier.notify("comments.changed", { path, comment })
    await ws.recorder.record(caller, { action: "create", target: { kind: "comment", path, part: comment.id }, after: comment }, { label: path.split("/").pop()!.replace(/\.md$/i, "") })
  }

  // A comment as it reads now, replacing the one with its id, and recorded. A window drew its own change
  // already; an agent's (a reply from the hidden chat about the comment, through comments_reply) reaches
  // the windows only through comments.changed. The comment as it was.
  async function putComment(path: string, comment: DocComment, caller: Caller) {
    const before = await requireWorkspace().docs.putComment(path, comment)
    if (caller.kind !== "window") notifier.notify("comments.changed", { path, comment })
    await recordComment(caller, path, before, comment)
    return before
  }

  // How a comment changed, one entry per comment or reply that did, sharing one writeId
  async function recordComment(caller: Caller, path: string, before: DocComment | null, after: DocComment | null, origin: Partial<ChangeOrigin> = {}) {
    const recorder = requireWorkspace().recorder
    const writeId = newWriteId()
    for (const { part, ...change } of commentChanges(before, after)) {
      await recorder.record(caller, { ...change, target: { kind: "comment", path, part }, origin: { ...origin, writeId } }, { quiet: true })
    }
  }

  // A point an agent carries over from a record of what people said (going through material): the
  // comment points back to the record, a doc its chat wrote with docs_write, as the change log says.
  // Core names the record; one not written yet is refused, so a comment never points at nothing.
  async function recordSource(caller: Caller, file: string) {
    const ws = requireWorkspace()
    const chatId = caller.kind === "socket" || caller.kind === "owlit" ? caller.chatId : undefined
    const rel = ws.docs.resolve(file)
    const made = chatId && (await ws.changes.list({ chatId, target: { kind: "doc", path: rel } })).some((c) => c.action === "create")
    if (!made) throw new RpcFailure(RpcErrorCode.InvalidParams, "Write the reading with docs_write first: each comment points back to it, a doc this chat wrote.")
    return { path: rel, label: rel.split("/").pop()!.replace(/\.md$/i, "") }
  }
}

// An agent's reply under its own comment that starts with CORRECT: (recipes/reply.ts) rewrites the
// comment's first entry instead of standing under it; the old words are kept as was. Under a comment that
// isn't that Owlit's to rewrite, it stands as a reply without the word.
function correcting(comment: DocComment, was: DocComment | null, caller: Caller): DocComment {
  if (caller.kind === "window" || !was) return comment
  const added = comment.entries.filter((e) => !was.entries.some((w) => w.id === e.id))
  const fix = added.length === 1 && isOwlit(added[0]!.by) ? correctionOf(added[0]!.text) : null
  if (!fix) return comment
  if (correctable(was) && was.entries[0]!.by === added[0]!.by) return corrected(was, fix, Date.now())
  return { ...comment, entries: comment.entries.map((e) => (e === added[0] ? { ...e, text: fix } : e)) }
}
