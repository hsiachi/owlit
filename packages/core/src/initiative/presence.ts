import type { ActivityEvent } from "@owlit/protocol"

// Where the user is, as their activity says: the doc they have open, when they last typed in it, and
// whether the window has been in the background a while. It is what Owlit's one rule of manners rests
// on: it never works on the page the user is writing in, and holds what it found until they stop or leave.

// Typing this recently counts as writing in the doc
export const TYPING_MS = 30_000

export class Presence {
  // The doc open in the window, if any
  private doc: string | null = null
  private editedAt = new Map<string, number>()
  private away = false

  hear(event: ActivityEvent) {
    switch (event.kind) {
      case "doc.opened":
        this.doc = event.path
        this.away = false
        return
      case "doc.closed":
        if (this.doc === event.path) this.doc = null
        return
      case "doc.edited":
        this.editedAt.set(event.path, event.at)
        this.away = false
        return
      case "idle":
        // The window reports the background time once it is long enough to count
        if (event.seconds >= TYPING_MS / 1000) this.away = true
        return
      default:
        this.away = false
    }
  }

  // The user is writing in this doc now: it is open, the window is in front, and they typed lately
  writingIn(path: string, now: number) {
    return !this.away && this.doc === path && now - (this.editedAt.get(path) ?? 0) < TYPING_MS
  }

  get openDoc() {
    return this.doc
  }

  get isAway() {
    return this.away
  }
}
