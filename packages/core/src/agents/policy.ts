import { ROLE_TABLE, type ActorId, type CommentInput, type DocComment, type Role, type Touches } from "@owlit/protocol"
import type { Caller } from "../rpc/router.ts"

// One decision for everything a person or their Owlit asks of core: whether this caller may make a call
// that touches this class, on this target. The person at the window is never policed. A chat's agent gets
// the role's answer from protocol's ROLE_TABLE, where propose lands like allow (the change log marks it
// and offers Undo; nothing here waits on the person); a caller with no chat (a background run, the CLI,
// an agent outside owlit) has nobody behind it, so only read and own go through. own is decided on the
// target: a thing is Owlit's while Owlit made it and nobody else has touched it since.

// Whose thing a call's target is, as its record says
export interface Target {
  // Who made it: a comment's first entry, a paper's addedBy, a highlight's, a change's actor. Absent for a
  // thing that isn't there yet, which is the caller's to make.
  by?: ActorId
  // Others who touched it since it was made (the person starred a paper Owlit added, replied under its
  // comment); any of them makes it theirs
  touchedBy?: ActorId[]
  // What to call it in a refusal: "comment", "paper", "highlight", "change"
  what?: string
  // The thing as it is now, for a method whose class depends on what the call changes in it
  was?: unknown
}

export interface Who {
  caller: Caller
  // The caller as the change log names it (Recorder.actorOf)
  actor: ActorId
  // The chat's role; absent with no chat
  role?: Role
}

export type Decision = "allow" | { refuse: string }

// Said to the agent, word for word, as the tool's answer (core puts "Not done: " before it)
const REVIEWER = "Owlit works as Reviewer in this chat and changes nothing of the user's. Describe the change in your answer instead; if the user wants it made, they can choose Assistant or Co-author in the composer."
const ADMIN = "owlit's workspace, settings, chats, sharing and agents are the user's alone; Owlit's tools can't change them."
const RUN = "Owlit works on its own here, with nobody to ask, and changes nothing of the user's."
const COMMAND = "owlit's command can't change the user's workspace; use the app."

export function decide(who: Who, touches: Touches, target: Target = {}): Decision {
  if (who.caller.kind === "window") return "allow"
  if (touches === "read") return "allow"
  if (touches === "own") return own(who.actor, target)
  if (touches === "admin") return { refuse: ADMIN }
  if (!who.role) return { refuse: who.caller.kind === "socket" && who.caller.run ? RUN : COMMAND }
  if (ROLE_TABLE[touches][who.role] === "refuse") return { refuse: REVIEWER }
  return "allow"
}

// Owlit's own thing: made by this caller, or not there yet, and untouched by anyone else since
function own(actor: ActorId, target: Target): Decision {
  const what = target.what ?? "thing"
  if (target.by !== undefined && target.by !== actor) return { refuse: `That ${what} is the user's, not Owlit's to change; name it in your answer and let them decide.` }
  if (target.touchedBy?.some((other) => other !== actor)) return { refuse: `The user has changed that ${what} since, so it is theirs now; name it in your answer and let them decide.` }
  return "allow"
}

// The class of a change to a comment: the comment itself when it is new; an entry of the caller's own, or
// a reply under someone else's comment, and resolving it, are its marks (meta); editing or removing
// another's entry, or changing anything else of their comment, is their words
export function commentTouches(input: CommentInput, target: Target, who: Who): Touches {
  const was = target.was as DocComment | undefined
  if (!was) return "own"
  const mine = target.by === who.actor
  let worst: Touches = "own"
  const raise = (to: Touches) => {
    if (RANK[to] > RANK[worst]) worst = to
  }
  for (const e of input.entries) {
    const old = was.entries.find((w) => w.id === e.id)
    if (!old) raise(mine ? "own" : "meta")
    else if (old.text !== e.text || old.editedAt !== e.editedAt) raise(old.by === who.actor ? "own" : "words")
  }
  for (const old of was.entries) if (!input.entries.some((e) => e.id === old.id)) raise(old.by === who.actor ? "own" : "words")
  const { entries: _a, resolvedAt: resolvedWas, ...restWas } = was
  const { entries: _b, resolvedAt: resolvedNow, ...restNow } = input
  if (resolvedWas !== resolvedNow) raise(mine ? "own" : "meta")
  if (JSON.stringify(restWas) !== JSON.stringify(restNow)) raise(mine ? "own" : "words")
  return worst
}

const RANK: Record<Touches, number> = { read: 0, own: 1, meta: 2, words: 3, structure: 4, admin: 5 }
