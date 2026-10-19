import { t } from "@lingui/core/macro"
import { isOwlit, owlitOf, type ActorId, type OwlitId, type PersonId, type Roster } from "@owlit/protocol"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"

// The profile id dev:web runs as, with no core to mint one, and its person and their Owlit, the mock
// data's authors
export const WEB_PROFILE_ID = "0000000a"
export const WEB_ME: PersonId = `p_${WEB_PROFILE_ID}`
export const WEB_OWLIT: OwlitId = owlitOf(WEB_ME)

// Who made a change, as the viewer reads it: "you" for their own id (me), a person's name from the
// workspace's roster, "Owlit" for any person's Owlit, "outside owlit" when owlit couldn't tell
function actorLabel(actor: ActorId, me: PersonId | undefined, roster: Roster): string {
  if (actor === me) return t({ message: "you", comment: "who made a change: the person reading" })
  if (isOwlit(actor)) return "Owlit"
  if (actor === "other") return t({ message: "outside owlit", comment: "who made a change: another program, or someone owlit doesn't know" })
  const member = roster[actor]
  return (member?.kind === "person" && member.name) || t({ message: "someone else", comment: "who made a change: a person in the workspace who gave no name" })
}

const personOf = (id: string | undefined): PersonId | undefined => (id ? `p_${id}` : undefined)

// The profile's id as the settings last said it (features/settings/store.ts sets it)
const useProfileId = create<{ id?: string }>(() => ({}))
export const setProfileId = (id: string | undefined) => useProfileId.setState({ id })

// The person at this window, as the change log names them; undefined until the settings have loaded
export const me = () => personOf(useProfileId.getState().id)
export const useMe = () => personOf(useProfileId((s) => s.id))

// What the window shows as written by this person's Owlit before core has signed it (an agent's mark)
export const myOwlit = (): ActorId => {
  const person = me()
  return person ? owlitOf(person) : "other"
}

// The open workspace's roster, read when first needed and again after the workspace or a name changed
let roster: Roster = {}
let asked = false
if (isDesktop) {
  const forget = () => {
    asked = false
  }
  onNotify("workspace.opened", forget)
  onNotify("settings.changed", forget)
}
function rosterNow() {
  if (isDesktop && !asked) {
    asked = true
    rpc.members
      .get()
      .then((r) => {
        roster = r
      })
      .catch(() => {
        asked = false
      })
  }
  return roster
}

// actorLabel for the person at this window
export const nameOf = (actor: ActorId) => actorLabel(actor, me(), rosterNow())
