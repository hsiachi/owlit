import { isOwlit, type Change, type Proposal, type ProposalHunk } from "@owlit/protocol"
import { sha1 } from "../fs-util.ts"
import { hunks } from "./hunks.ts"
import type { ChangeLog } from "./log.ts"

// How many characters either side of a passage go with it, for finding it in the doc as it reads now
const CONTEXT = 24
// Hunks this close together are one passage: a comma put in and the word after it swapped read as one
// change, and are kept or undone as one
const JOIN = 3

// What one change to a doc put in and took out, passage by passage, each with the text either side of
// it as the change left it (stopping at the neighbouring passages)
export function proposalHunks(before: string, after: string): ProposalHunk[] {
  // Each hunk's span in `before` and in `after`, neighbours joined
  const spans: { bf: number; bt: number; af: number; at: number }[] = []
  let shift = 0
  for (const h of hunks(before, after)) {
    const af = h.from + shift
    const at = af + h.insert.length
    shift += h.insert.length - (h.to - h.from)
    const last = spans.at(-1)
    if (last && af - last.at <= JOIN) {
      last.bt = h.to
      last.at = at
    } else spans.push({ bf: h.from, bt: h.to, af, at })
  }
  return spans.map((s, i) => {
    const prev = spans[i - 1]?.at ?? 0
    const next = spans[i + 1]?.af ?? after.length
    return { insert: after.slice(s.af, s.at), removed: before.slice(s.bf, s.bt), before: after.slice(Math.max(prev, s.af - CONTEXT), s.af), after: after.slice(s.at, Math.min(next, s.at + CONTEXT)) }
  })
}

// Owlit's changes to a doc since the text the person last had on screen (the one whose sha1 is hash,
// else those from `since` on), each still standing (not undone) and as its passages, for the doc to mark.
// A doc Owlit made since is one whole proposal with no passages: marks are for edits to words that were
// there before, and every word of a new doc is Owlit's.
// current: the doc as the window has it, which the newest entry left. Nothing when the log no longer
// keeps the text the person saw: a gap shows nothing rather than everything.
export async function docProposals(log: ChangeLog, rel: string, current: string, base: { hash?: string; since?: number }): Promise<Proposal[]> {
  if (base.hash !== undefined && sha1(current) === base.hash) return []
  const entries = (await log.list({ target: { kind: "doc", path: rel } })).reverse()
  const befores = await Promise.all(entries.map(async (e) => (e.action === "create" ? "" : await log.content(e.id))))
  const after = (i: number) => (i + 1 < entries.length ? (befores[i + 1] ?? "") : current)
  let start: number
  if (base.hash !== undefined) {
    start = -1
    for (let i = entries.length - 1; i >= 0 && start < 0; i--) {
      if (entries[i]!.afterHash === base.hash) start = i + 1
      else if (befores[i] !== null && sha1(befores[i]!) === base.hash) start = i
    }
    if (start < 0) return []
  } else start = entries.findIndex((e) => e.at >= (base.since ?? 0))
  if (start < 0) return []
  let out: Proposal[] = []
  let whole: Proposal | undefined
  for (let i = start; i < entries.length; i++) {
    const e = entries[i]!
    if (!isOwlit(e.actor) || e.undoes || e.action === "delete" || befores[i] === null || undone(e, entries)) continue
    const said = { id: e.id, at: e.at, actor: e.actor, ...(e.origin.chatId ? { chatId: e.origin.chatId } : {}) }
    if (e.action === "create") {
      // What came before a doc made again isn't in it
      whole = { ...said, hunks: [], whole: { also: [] } }
      out = [whole]
      continue
    }
    if (whole) {
      whole.whole!.also.push(e.id)
      continue
    }
    const parts = proposalHunks(befores[i]!, after(i))
    if (parts.length) out.push({ ...said, hunks: parts })
  }
  return out
}

// Whether an entry is taken back now: the newest undo of it that isn't itself undone
const undone = (e: Change, all: Change[]): boolean => all.some((c) => c.undoes === e.id && !undone(c, all))
