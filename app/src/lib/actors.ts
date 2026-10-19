import { t } from "@lingui/core/macro"
import { isOwlit, type ActorId, type PersonId, type Roster } from "@owlit/protocol"

// Who made a change, as the viewer reads it: "you" for their own id (me), a person's name from the
// workspace's roster, "Owlit" for any person's Owlit, "outside owlit" when owlit couldn't tell
export function actorLabel(actor: ActorId, me: PersonId | undefined, roster: Roster): string {
  if (actor === me) return t({ message: "you", comment: "who made a change: the person reading" })
  if (isOwlit(actor)) return "Owlit"
  if (actor === "other") return t({ message: "outside owlit", comment: "who made a change: another program, or someone owlit doesn't know" })
  const member = roster[actor]
  return (member?.kind === "person" && member.name) || t({ message: "someone else", comment: "who made a change: a person in the workspace who gave no name" })
}
