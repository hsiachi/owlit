import type { ActivityEvent } from "@owlit/protocol"
import { z } from "zod"

const at = z.number().int().nonnegative()
const id = z.string().min(1)
const page = z.number().int().positive()
const seconds = z.number().int().positive()
const mark = z.discriminatedUnion("what", [
  z.object({ what: z.literal("starred"), to: z.boolean() }),
  z.object({ what: z.literal("status"), to: z.enum(["unread", "reading", "read"]) }),
  z.object({ what: z.literal("tags"), to: z.array(z.string()) }),
])

// Runtime check of what the renderer sends; mirrors ActivityEvent in protocol
export const activityEvent: z.ZodType<ActivityEvent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paper.opened"), at, paperId: id }),
  z.object({ kind: z.literal("paper.closed"), at, paperId: id }),
  z.object({ kind: z.literal("paper.page"), at, paperId: id, page }),
  z.object({ kind: z.literal("paper.focus"), at, paperId: id, view: z.enum(["digest", "pdf"]), seconds }),
  z.object({ kind: z.literal("paper.dwell"), at, paperId: id, page, seconds }),
  z.object({ kind: z.literal("paper.marked"), at, paperId: id, mark }),
  z.object({ kind: z.literal("highlight.added"), at, paperId: id, highlightId: id }),
  z.object({ kind: z.literal("highlight.removed"), at, paperId: id, highlightId: id }),
  z.object({ kind: z.literal("note.edited"), at, paperId: id }),
  z.object({ kind: z.literal("doc.opened"), at, path: id }),
  z.object({ kind: z.literal("doc.closed"), at, path: id }),
  z.object({ kind: z.literal("doc.edited"), at, path: id }),
  z.object({ kind: z.literal("chat.sent"), at, chatId: id }),
  z.object({ kind: z.literal("chat.ended"), at, chatId: id }),
  z.object({ kind: z.literal("idle"), at, seconds: z.number().nonnegative() }),
])
