import type { ActorId, Change, ChangeAction, ChangeOrigin, ChangeTarget, Notifications, ProfileSettings } from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { sha1 } from "../fs-util.ts"
import type { Caller } from "../rpc/index.ts"
import { changeId, type ChangeLog } from "./log.ts"

export interface RecordInput {
  action: ChangeAction
  target: ChangeTarget
  // via defaults by caller (window: editor, a program or Owlit: tool, the watcher: watcher); chatId
  // defaults to the caller's
  origin?: Partial<ChangeOrigin>
  before?: unknown
  after?: unknown
  afterHash?: string
  undoes?: string
  // A doc's or thread's text from before, kept in its own file rather than inline
  content?: string
}

// What changes.added says besides the change; quiet: nothing is said (the editor already showed the
// edit, or a run Owlit made while the user was away lands without a word)
export interface Say {
  label?: string
  thread?: Notifications["changes.added"]["thread"]
  quiet?: boolean
}

// Shared by the entries of one write that has no tool call to name it
export const newWriteId = () => randomBytes(4).toString("hex")

const VIA: Record<Caller["kind"], ChangeOrigin["via"]> = { window: "editor", socket: "tool", owlit: "tool", watcher: "watcher" }

// The one way a change gets into the log: works out who made it from the caller, stamps it and says so
export class Recorder {
  private readonly log: ChangeLog
  private readonly profile: () => Promise<ProfileSettings>
  private readonly added: (notification: Notifications["changes.added"]) => void

  constructor(log: ChangeLog, options: { profile: () => Promise<ProfileSettings>; added?: (notification: Notifications["changes.added"]) => void }) {
    this.log = log
    this.profile = options.profile
    this.added = options.added ?? (() => {})
  }

  // The window is the profile's person. A program on the socket working for a chat or run is that
  // person's Owlit; one working for neither (the CLI, an agent outside owlit) can't be told from a person
  // at a terminal, so it is other. A change the watcher saw is Owlit's only when a turn claimed the file.
  async actorOf(caller: Caller): Promise<ActorId> {
    const id = (await this.profile()).id
    if (!id) return "other"
    if (caller.kind === "window") return `p_${id}`
    if (caller.kind === "owlit") return `o_${id}`
    if (caller.kind === "watcher") return caller.chatId ? `o_${id}` : "other"
    return caller.chatId || caller.run ? `o_${id}` : "other"
  }

  async record(caller: Caller, input: RecordInput, say: Say = {}): Promise<Change> {
    const at = Date.now()
    const { content, origin = {}, ...rest } = input
    const chatId = origin.chatId ?? (caller.kind === "window" ? undefined : caller.chatId)
    const change: Change = {
      id: changeId(at, input.target.path),
      at,
      actor: await this.actorOf(caller),
      ...rest,
      origin: { ...origin, via: origin.via ?? VIA[caller.kind], ...(chatId ? { chatId } : {}), writeId: origin.writeId ?? origin.toolCallId ?? newWriteId() },
    }
    await this.log.append(change, content)
    if (!say.quiet) this.say(change, say)
    return change
  }

  // Says a change recorded quietly, once it turned out to need saying
  say(change: Change, say: Omit<Say, "quiet"> = {}) {
    this.added({ change, ...(say.label ? { label: say.label } : {}), ...(say.thread ? { thread: say.thread } : {}) })
  }

  // A doc's change from its text on each side: no text before is a create, none after a delete
  doc(caller: Caller, rel: string, before: string | null, after: string | null, extra: Pick<RecordInput, "origin" | "undoes"> = {}, say: Say = {}) {
    return this.record(
      caller,
      {
        action: before === null ? "create" : after === null ? "delete" : "update",
        target: { kind: "doc", path: rel },
        ...extra,
        ...(after !== null ? { afterHash: sha1(after) } : {}),
        ...(before !== null ? { content: before } : {}),
      },
      say,
    )
  }
}
