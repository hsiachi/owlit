import type { Absence, ActivityEvent } from "@owlit/protocol"

// Whether the user is here or away, as their activity says, and the last stretch they were away: what
// Home's Since you left counts from.

// The window in the background this long is the user away (the window reports it as idle)
export const AWAY_MS = 30_000

export class Presence {
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
    // Closing a doc is the window's doing as often as the user's (a reload or a window closing closes
    // what was open too), so it doesn't say they are here
    if (event.kind === "doc.closed") return
    if (event.kind !== "idle") {
      this.here(event.at)
      this.since = null
      return
    }
    // The window reports the background time once it is long enough to count
    if (event.seconds * 1000 >= AWAY_MS && this.since === null) {
      this.since = event.at - event.seconds * 1000
      this.heard?.(this.since, true)
    }
  }

  // The user was last heard from at lastHere, before owlit (or this workspace) started: away since then
  resume(lastHere: number | undefined, now: number) {
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

  // The last stretch the user was away that has ended
  get lastAway() {
    return this.away
  }
}
