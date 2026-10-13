import { t } from "@lingui/core/macro"
import { i18n } from "@/lib/i18n"
import { starters } from "./starters"

const TITLE_MAX = 80

// A starter chip puts its stem in the composer ("What do my papers say about "); a person who then types a
// whole question of their own ("Compare how …") would get a title of both. When what follows the stem
// starts with a capitalised word and runs longer than a few words, it reads as their own sentence and stands
// alone. An acronym ("RAG benchmarks") or a mention ("@[Niu et al. 2023]", checked before mentions become
// their labels) finishes the stem's sentence instead.
function withoutStem(text: string) {
  for (const { prompt } of starters) {
    const stem = i18n._(prompt).trim()
    if (!text.startsWith(stem)) continue
    const rest = text.slice(stem.length).trim()
    if (/^\p{Lu}\p{Ll}/u.test(rest) && rest.length > 20) return rest
  }
  return text
}

// A chat's title is its first question, cut at a word when it runs long and ended with an ellipsis, so a
// title that fits its row (Home, the panel header) still reads as cut rather than ending mid-word; a row
// too narrow for it truncates with CSS, which adds its own ellipsis to the shortened words
export const titleFrom = (text: string) => {
  const title = withoutStem(text.replace(/\s+/g, " ").trim()).replace(/@\[([^\]]+)\]/g, "$1")
  if (title.length <= TITLE_MAX) return title || t`New chat`
  const head = title.slice(0, TITLE_MAX)
  const space = head.lastIndexOf(" ")
  // A single word longer than half the room is cut as it is, not dropped
  const cut = space > TITLE_MAX / 2 ? head.slice(0, space) : head
  // "…, and how were" would end on a comma; the ellipsis stands for the rest
  return `${cut.replace(/[\s,;:(\[{\-–—]+$/, "")}…`
}
