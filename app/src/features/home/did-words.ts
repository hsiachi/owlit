import { t } from "@lingui/core/macro"
import { nameOf } from "@/lib/actors"
import { ago } from "@/lib/time"
import type { Place } from "./places"

// What was done there and when, as one phrase: "edited 2 h ago", "Owlit wrote yesterday", "read Oct 9"
export function didWords(place: Place) {
  const when = ago(place.at, { inSentence: true })
  switch (place.did) {
    case "edited":
      return t`edited ${when}`
    case "owlit-wrote":
      return t`Owlit wrote ${when}`
    case "owlit-edited":
      return t`Owlit edited ${when}`
    case "others-edited": {
      if (place.by === "other") return t({ message: `changed outside owlit ${when}`, comment: "Home: when another program last changed a doc" })
      const who = nameOf(place.by!)
      return t({ message: `${who} edited ${when}`, comment: "Home: a person's name, then when they last changed a doc" })
    }
    case "read":
      return t`read ${when}`
  }
  return ago(place.at)
}
