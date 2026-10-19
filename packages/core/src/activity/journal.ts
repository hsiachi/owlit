import { JOURNALED_KINDS, type ActivityEvent, type PersonId } from "@owlit/protocol"
import type { ActivityBus } from "./bus.ts"
import { appendJsonl } from "../fs-util.ts"

// Appends the coarse events to <workspace>/.owlit/journal.jsonl, one JSON object per line, in the
// order they arrived. Fine-grained ones (page turns) never reach the disk; reading time does, already
// settled into 30-second pieces by the window.
export class Journal {
  private writing: Promise<void> = Promise.resolve()
  private unsubscribe: () => void
  private person: () => Promise<PersonId>

  // file: where the journal of the open workspace lives, or null when none is open. person: the profile's
  // id, whose the window's events are. recording: whether the user lets owlit note what they do; off,
  // their events still reach every other listener (the read-in-full check on a visit's end)
  constructor(bus: ActivityBus, file: () => string | null, person: () => Promise<PersonId>, recording: () => boolean = () => true) {
    this.person = person
    this.unsubscribe = bus.subscribe(JOURNALED_KINDS, (event) => {
      const target = file()
      if (target && recording()) this.append(target, event)
    })
  }

  // The actor is resolved in the write queue, so lines stay in the order they arrived
  private append(file: string, event: ActivityEvent) {
    this.writing = this.writing
      .then(async () => appendJsonl(file, { ...event, actor: await this.person() }))
      .catch((error) => console.error(`[core] could not write ${file}`, error))
  }

  // Resolves once everything published so far is on disk
  flush() {
    return this.writing
  }

  async dispose() {
    this.unsubscribe()
    await this.writing
  }
}
