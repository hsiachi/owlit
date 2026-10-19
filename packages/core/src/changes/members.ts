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
