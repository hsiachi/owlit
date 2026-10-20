import type { ActorId, Member, PersonId, ProfileSettings, Roster } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { Serial } from "../util.ts"

// .owlit/members.json: who the ids in the change log are. Each person who opens the workspace adds
// themselves and their Owlit; nothing is ever removed, so old entries keep their names.
export class Members {
  private readonly file: string
  private readonly turn = new Serial()

  constructor(owlitDir: string) {
    this.file = path.join(owlitDir, "members.json")
  }

  async get(): Promise<Roster> {
    return (await readJson<Roster>(this.file).catch(() => undefined)) ?? {}
  }

  // Adds or renames the profile's person and their Owlit
  ensure(profile: ProfileSettings) {
    return this.turn.run(async () => {
      if (!profile.id) return
      const person: PersonId = `p_${profile.id}`
      const roster = await this.get()
      const me: Member = { kind: "person", ...(profile.name ? { name: profile.name } : {}) }
      const owlit: Member = { kind: "assistant", of: person }
      const key = `o_${profile.id}`
      if (JSON.stringify(roster[person]) === JSON.stringify(me) && JSON.stringify(roster[key]) === JSON.stringify(owlit)) return
      await writeJsonAtomic(this.file, { ...roster, [person]: me, [key]: owlit })
    })
  }

  // A person's name; undefined for an Owlit, other, or a person who gave none
  async nameOf(actor: ActorId) {
    const member = (await this.get())[actor]
    return member?.kind === "person" ? member.name : undefined
  }
}

// Authors as owlit wrote them before actor ids: "user" was the person, "agent" and "owlit" their Owlit
const OLD_WORDS: Record<string, Member["kind"]> = { user: "person", agent: "assistant", owlit: "assistant" }

// Reads an author that may be in an older shape as an actor id. A data file from before ids names the
// one person who used the workspace then, taken to be the roster's first person (and their Owlit the
// first assistant); "other" while members.json names none. missing: whose a thing with no author at all
// is, where an older owlit wrote none for that one. The roster is read only when an old word is met, and
// once per reader.
export function oldActors(owlitDir: string) {
  let roster: Promise<Roster> | undefined
  return async (value: unknown, missing?: Member["kind"]): Promise<ActorId> => {
    if (typeof value === "string" && /^[po]_/.test(value)) return value as ActorId
    if (value === "other") return "other"
    const kind = typeof value === "string" ? OLD_WORDS[value] : value === undefined ? missing : undefined
    if (!kind) return "other"
    roster ??= new Members(owlitDir).get()
    const id = Object.entries(await roster).find(([, member]) => member?.kind === kind)?.[0]
    return id && /^[po]_/.test(id) ? (id as ActorId) : "other"
  }
}
