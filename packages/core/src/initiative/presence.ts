import type { Absence, ActivityEvent } from "@owlit/protocol"

// Where the user is, as their activity says: the doc they have open, when they last typed in it, and
// whether they are away. It is what Owlit's one rule of manners rests on: it never works on the page the
// user is in, and holds what it found until they stop or leave.

// Typing this recently counts as writing in the doc
export const TYPING_MS = 30_000
// The window in the background this long is the user away (the window reports it as idle)
export const AWAY_MS = 30_000

export class Presence {
  // The doc open in the window, if any
  private doc: string | null = null
  private editedAt = new Map<string, number>()
  // Since when the user is away: from the moment the window went to the background, until their next
  // activity (coming back to the window is one); null while they are here
  private since: number | null = null
  // The last stretch away that has ended
  private away: Absence | null = null
  // Told each time the user is heard from (left: the time they went away, as soon as it is known), and
  // when they come back from a stretch away
  heard?: (at: number, left: boolean) => void
  cameBack?: (away: Absence) => void

  hear(event: ActivityEvent) {
    // Closing a doc is the window's doing as often as the user's (below), so it doesn't say they are here
    if (event.kind !== "idle" && event.kind !== "doc.closed") this.here(event.at)
    switch (event.kind) {
      case "doc.opened":
        this.doc = event.path
        this.since = null
        return
      case "doc.closed":
        // A reload or a window closing closes what was open too
        if (this.doc === event.path) this.doc = null
        return
      case "doc.edited":
        this.editedAt.set(event.path, event.at)
        this.since = null
        return
      case "idle":
        // The window reports the background time once it is long enough to count
        if (event.seconds * 1000 >= AWAY_MS && this.since === null) {
          this.since = event.at - event.seconds * 1000
          this.heard?.(this.since, true)
        }
        return
      default:
        this.since = null
    }
  }

  // The user was last heard from at lastHere, before owlit (or this workspace) started: away since then
  resume(lastHere: number | undefined, now: number) {
    this.doc = null
    this.since = null
    this.away = lastHere !== undefined && now - lastHere >= AWAY_MS ? { from: lastHere, to: now } : null
  }

  // Heard from at this time: a stretch away, if they were away, ends here
  private here(at: number) {
    if (this.since !== null) {
      this.away = { from: this.since, to: at }
      this.cameBack?.(this.away)
    }
    this.heard?.(at, false)
  }

  // The user is writing in this doc now: it is open, they are here, and they typed lately
  writingIn(path: string, now: number) {
    return this.since === null && this.doc === path && now - (this.editedAt.get(path) ?? 0) < TYPING_MS
  }

  // The user is here with this doc open, reading or writing it
  inDoc(path: string) {
    return this.since === null && this.doc === path
  }

  get openDoc() {
    return this.doc
  }

  get isAway() {
    return this.since !== null
  }

  // When the current away stretch began, while the user is away
  get awaySince() {
    return this.since
  }

  // The last stretch the user was away that has ended
  get lastAway() {
    return this.away
  }
}
