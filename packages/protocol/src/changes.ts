// The change log: every change to something in the workspace, whoever made it, in .owlit/versions/.

// Who made a change: p_<8 hex> a person, o_<8 hex> that person's Owlit (minted together from the
// profile), "other" when owlit couldn't tell (another program, or a person not in the roster)
export type PersonId = `p_${string}`
export type OwlitId = `o_${string}`
export type ActorId = PersonId | OwlitId | "other"

export type ChangeAction = "create" | "update" | "delete"

export interface ChangeTarget {
  kind: "doc" | "comment" | "paper" | "thread" | "memory"
  // The doc's path, the comment's doc path, the paper's id, the thread's id, "memory"
  path: string
  // The piece inside it: a comment's id (<comment>/<entry> for one entry), a paper's field (status,
  // overrides.title…), a thread item (row:…, cell:…, memo:…, title), a memory line's id; absent when the
  // whole thing was created, deleted or changed
  part?: string
}

export interface ChangeOrigin {
  // editor: a window's save or op; tool: an agent through owlit's fs or tools; apply: the user
  // accepting an agent's proposed edit; watcher: a change seen on disk; auto: something the app did on
  // its own on the actor's action
  via: "editor" | "tool" | "apply" | "watcher" | "auto"
  // The chat or run it came from
  chatId?: string
  toolCallId?: string
  // The initiative rule that started the run
  ruleId?: string
  // Shared by the entries of one write (the toolCallId when there is one)
  writeId?: string
}

export interface Change {
  // <at>-<rand>-<path>; also the name of the file holding a doc's text from before
  id: string
  at: number
  // A folded session's last save
  until?: number
  actor: ActorId
  action: ChangeAction
  target: ChangeTarget
  origin: ChangeOrigin
  // The value on each side, inline for everything but a doc (a comment, a paper's field, a thread's
  // item, a memory line); a doc's text from before is in the file named by id instead
  before?: unknown
  after?: unknown
  // A doc's sha1 after the change, to tell whether it changed since
  afterHash?: string
  // This change takes back that one; redo is the undo of the undo
  undoes?: string
}

// changes.list: every field given must match
export interface ChangeFilter {
  target?: Partial<ChangeTarget>
  // target.path, whatever the kind
  path?: string
  chatId?: string
  actor?: ActorId
  since?: number
}

// .owlit/members.json: names for the ids in the log
export type Member = { kind: "person"; name?: string } | { kind: "assistant"; of: PersonId }
export type Roster = Record<string, Member>

export const isPerson = (actor: ActorId): actor is PersonId => actor.startsWith("p_")
export const isOwlit = (actor: ActorId): actor is OwlitId => actor.startsWith("o_")
export const owlitOf = (person: PersonId): OwlitId => `o_${person.slice(2)}`
export const personOf = (owlit: OwlitId): PersonId => `p_${owlit.slice(2)}`
