import type { ActorId, Change, ChangeAction, ChangeOrigin, ChangeTarget, Notifications, ProfileSettings } from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { sha1 } from "../fs-util.ts"
import type { Caller } from "../rpc/index.ts"
import { Serial } from "../util.ts"
import { changeId, type ChangeLog } from "./log.ts"

export interface RecordInput {
  action: ChangeAction
  target: ChangeTarget
  // via defaults by caller (window: editor, a program or Owlit: tool, the watcher: apply when the claim
  // was accepted, else watcher); chatId and toolCallId default to the caller's
  origin?: Partial<ChangeOrigin>
  before?: unknown
  after?: unknown
  afterHash?: string
  undoes?: string
  // A doc's text from before, kept in its own file rather than inline
  content?: string
}

// What changes.added says besides the change; quiet: nothing is said (the person made it where they see
// it, or it is told another way: a chat's card, a batch's own toast, the place it lands)
export interface Say {
  label?: string
  thread?: Notifications["changes.added"]["thread"]
  quiet?: boolean
}

// The reply a chat's change belongs to: the one whose tool call made it, else the one whose turn is running
export type ReplyOrigin = (chatId: string, toolCallId?: string) => string | undefined

// Shared by the entries of one write that has no tool call to name it
export const newWriteId = () => randomBytes(4).toString("hex")

// Saves of one person's typing session on a doc this close together are one entry
export const FOLD_MS = 30 * 60_000

const VIA: Record<Exclude<Caller["kind"], "watcher">, ChangeOrigin["via"]> = { window: "editor", socket: "tool", owlit: "tool" }

// The one way a change gets into the log: works out who made it from the caller, stamps it and says so.
// Entries are appended one at a time in the order recorded, so a change seen on disk lands before the
// save that follows it.
export class Recorder {
  private readonly log: ChangeLog
  private readonly profile: () => Promise<ProfileSettings>
  private readonly added: (notification: Notifications["changes.added"]) => void
  private readonly replyOf: ReplyOrigin
  private readonly now: () => number
  private readonly turn = new Serial()
  // Each doc's newest entry, read from the log the first time it is needed and kept current after
  private readonly newest = new Map<string, Change | null>()

  constructor(log: ChangeLog, options: { profile: () => Promise<ProfileSettings>; added?: (notification: Notifications["changes.added"]) => void; replyOf?: ReplyOrigin; now?: () => number }) {
    this.log = log
    this.profile = options.profile
    this.added = options.added ?? (() => {})
    this.replyOf = options.replyOf ?? (() => undefined)
    this.now = options.now ?? Date.now
  }

  // The window is the profile's person. A program on the socket working for a chat is that
  // person's Owlit; one working for none (the CLI, an agent outside owlit) can't be told from a person
  // at a terminal, so it is other. A change the watcher saw is Owlit's only when a tool call named the file.
  async actorOf(caller: Caller): Promise<ActorId> {
    const id = (await this.profile()).id
    if (!id) return "other"
    if (caller.kind === "window") return `p_${id}`
    if (caller.kind === "owlit") return `o_${id}`
    if (caller.kind === "watcher") return caller.toolCallId ? `o_${id}` : "other"
    return caller.chatId ? `o_${id}` : "other"
  }

  record(caller: Caller, input: RecordInput, say: Say = {}): Promise<Change> {
    return this.turn.run(async () => {
      const change = await this.append(caller, input)
      if (!say.quiet) this.say(change, say)
      return change
    })
  }

  // Says a change recorded quietly, once it turned out to need saying
  say(change: Change, say: Omit<Say, "quiet"> = {}) {
    this.added({ change, ...(say.label ? { label: say.label } : {}), ...(say.thread ? { thread: say.thread } : {}) })
  }

  // A doc's change from its text on each side: no text before is a create, none after a delete
  doc(caller: Caller, rel: string, before: string | null, after: string | null, extra: Pick<RecordInput, "origin" | "undoes"> = {}, say: Say = {}) {
    return this.record(caller, docInput(rel, before, after, extra), say)
  }

  // The person's save of a doc in the editor. Saves on one doc with no other author's entry between them
  // and less than FOLD_MS apart are one entry (an update: a new doc's first session is its own, so undoing
  // it doesn't take the doc away): the first save appends it, later ones move its until and
  // afterHash, and its file keeps the text from before the first. A save that writes what the doc's newest
  // entry already left is that entry coming back through an open editor (an agent's edit the window took
  // in), and records nothing. Said nowhere: the person saw it as they typed.
  saved(caller: Caller, rel: string, before: string | null, after: string) {
    return this.turn.run(async () => {
      const afterHash = sha1(after)
      const last = await this.newestOf(rel)
      if (before === after || last?.afterHash === afterHash) return null
      const actor = await this.actorOf(caller)
      const at = this.now()
      if (last && last.actor === actor && last.origin.via === "editor" && !last.undoes && last.action === "update" && at - (last.until ?? last.at) < FOLD_MS) {
        const folded: Change = { ...last, until: at, afterHash }
        await this.log.replace(folded)
        this.newest.set(rel, folded)
        return folded
      }
      return this.append(caller, docInput(rel, before, after))
    })
  }

  private async append(caller: Caller, input: RecordInput): Promise<Change> {
    const at = this.now()
    const { content, origin = {}, ...rest } = input
    const from: { chatId?: string; toolCallId?: string } = caller.kind === "window" ? {} : caller
    const chatId = origin.chatId ?? from.chatId
    const toolCallId = origin.toolCallId ?? from.toolCallId
    const replyId = origin.replyId ?? (chatId ? this.replyOf(chatId, toolCallId) : undefined)
    const via = origin.via ?? (caller.kind === "watcher" ? (caller.accepted ? "apply" : "watcher") : VIA[caller.kind])
    const change: Change = {
      id: changeId(at, input.target.path),
      at,
      actor: await this.actorOf(caller),
      ...rest,
      origin: { ...origin, via, ...(chatId ? { chatId } : {}), ...(replyId ? { replyId } : {}), ...(toolCallId ? { toolCallId } : {}), writeId: origin.writeId ?? toolCallId ?? newWriteId() },
    }
    await this.log.append(change, content)
    if (change.target.kind === "doc") this.newest.set(change.target.path, change)
    return change
  }

  private async newestOf(rel: string) {
    if (!this.newest.has(rel)) this.newest.set(rel, (await this.log.list({ target: { kind: "doc", path: rel } }))[0] ?? null)
    return this.newest.get(rel)!
  }
}

function docInput(rel: string, before: string | null, after: string | null, extra: Pick<RecordInput, "origin" | "undoes"> = {}): RecordInput {
  return {
    action: before === null ? "create" : after === null ? "delete" : "update",
    target: { kind: "doc", path: rel },
    ...extra,
    ...(after !== null ? { afterHash: sha1(after) } : {}),
    ...(before !== null ? { content: before } : {}),
  }
}
