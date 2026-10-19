import { JOURNALED_KINDS, owlitOf, type ActivityEvent, type JournaledCoreEvent, type EvaluationRecord, type FeedbackRecord, type LookedRecord, type PersonId } from "@owlit/protocol"
import type { ActivityBus } from "./bus.ts"
import { appendJsonl } from "../fs-util.ts"

type Unsigned = ActivityEvent | EvaluationRecord | LookedRecord | JournaledCoreEvent | FeedbackRecord

// Appends the coarse events to <workspace>/.owlit/journal.jsonl, one JSON object per line, in the
// order they arrived. Fine-grained ones (page turns) never reach the disk; reading time does, already
// settled into 30-second pieces by the window.
export class Journal {
  private writing: Promise<void> = Promise.resolve()
  private unsubscribe: () => void
  private file: () => string | null
  private person: () => Promise<PersonId>

  // file: where the journal of the open workspace lives, or null when none is open. person: the profile's
  // id; the window's events and feedback are theirs, Owlit's decisions and traces their Owlit's.
  // recording: whether the user lets owlit note what they do; off, their events still reach every other
  // listener (Owlit's rules)
  constructor(bus: ActivityBus, file: () => string | null, person: () => Promise<PersonId>, recording: () => boolean = () => true) {
    this.file = file
    this.person = person
    this.unsubscribe = bus.subscribe(JOURNALED_KINDS, (event) => {
      const target = file()
      if (target && recording()) this.append(target, event, "person")
    })
  }

  // The actor is resolved in the write queue, so lines stay in the order they arrived
  private append(file: string, entry: Unsigned, by: "person" | "owlit") {
    this.writing = this.writing
      .then(async () => {
        const person = await this.person()
        await appendJsonl(file, { ...entry, actor: by === "person" ? person : owlitOf(person) })
      })
      .catch((error) => console.error(`[core] could not write ${file}`, error))
  }

  // Each decision Owlit's rules took, with or without an action: the held-back log
  evaluation(entry: EvaluationRecord) {
    const target = this.file()
    if (target) this.append(target, entry, "owlit")
  }

  // What Owlit's rules heard from core and looked at in the workspace, so a replay hears and finds the same
  trace(entry: JournaledCoreEvent | LookedRecord) {
    const target = this.file()
    if (target) this.append(target, entry, "owlit")
  }

  // What the user did with Owlit's work, and the dial
  feedback(entry: FeedbackRecord) {
    const target = this.file()
    if (target) this.append(target, entry, "person")
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
