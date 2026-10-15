import { JOURNALED_KINDS, type AgentRecord, type JournalEntry } from "@owlit/protocol"
import type { ActivityBus } from "./bus.ts"
import { appendJsonl } from "../fs-util.ts"

// Appends the coarse events to <workspace>/.owlit/journal.jsonl, one JSON object per line, in the
// order they arrived. Fine-grained ones (page turns, idle, closing a doc) never reach the disk; reading
// time does, already settled into 30-second pieces by the window.
export class Journal {
  private writing: Promise<void> = Promise.resolve()
  private unsubscribe: () => void
  private file: () => string | null

  // file: where the journal of the open workspace lives, or null when none is open
  constructor(bus: ActivityBus, file: () => string | null) {
    this.file = file
    this.unsubscribe = bus.subscribe(JOURNALED_KINDS, (event) => {
      const target = file()
      if (target) this.append(target, { ...event, actor: "user" })
    })
  }

  private append(file: string, entry: JournalEntry) {
    this.writing = this.writing
      .then(async () => {
        await appendJsonl(file, entry)
      })
      .catch((error) => console.error(`[core] could not write ${file}`, error))
  }

  // What core itself saw an agent do (it never comes from a window)
  record(entry: AgentRecord) {
    const target = this.file()
    if (target) this.append(target, { ...entry, actor: "agent" })
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

