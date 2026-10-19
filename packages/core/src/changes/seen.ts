import { applySeen, unseenOf, type PersonId, type SeenKind, type SeenMark, type SeenMarks, type UnseenSources } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { Serial } from "../util.ts"

const KINDS: SeenKind[] = ["docs", "threads", "chats", "comments", "digests"]

// .owlit/seen/<person>.json: what each person last looked at, one file each, so a synced folder carries
// everyone's own. Marks only move forward: one older than the mark kept is ignored. Read and written
// through one Serial, so an unseen asked after a mark sees it.
export class Seen {
  private readonly dir: string
  private readonly now: () => number
  private readonly turn = new Serial()
  private readonly cache = new Map<PersonId, SeenMarks>()

  constructor(owlitDir: string, now: () => number = Date.now) {
    this.dir = path.join(owlitDir, "seen")
    this.now = now
  }

  get(person: PersonId, kinds: SeenKind[] = KINDS) {
    return this.turn.run(async () => {
      const marks = await this.read(person)
      return { since: marks.since, ...Object.fromEntries(KINDS.map((k) => [k, kinds.includes(k) ? marks[k] : {}])) } as SeenMarks
    })
  }

  mark(person: PersonId, mark: SeenMark) {
    return this.turn.run(async () => {
      const marks = await this.read(person)
      if (applySeen(marks, mark, mark.at ?? this.now())) await this.write(person, marks)
      return marks
    })
  }

  unseen(person: PersonId, sources: UnseenSources) {
    return this.turn.run(async () => unseenOf(await this.read(person), person, sources))
  }

  private async read(person: PersonId) {
    const cached = this.cache.get(person)
    if (cached) return cached
    const kept = await readJson<SeenMarks>(this.file(person)).catch(() => undefined)
    // A person's first marks: what came before them is not news to them
    const marks: SeenMarks = { since: this.now(), docs: {}, threads: {}, chats: {}, comments: {}, digests: {}, ...kept }
    if (!kept) await this.write(person, marks)
    this.cache.set(person, marks)
    return marks
  }

  private write(person: PersonId, marks: SeenMarks) {
    return writeJsonAtomic(this.file(person), marks)
  }

  private file(person: PersonId) {
    return path.join(this.dir, `${person}.json`)
  }
}
