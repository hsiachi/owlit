import { mentionLink } from "@owlit/protocol"

// The text a picked mention becomes in a doc, in place of the typed "@query". A mention mid-sentence is
// followed by whatever was already there: a space is added only when the next character is a letter or a
// digit, which would otherwise run into the link. Never at the end of a line, before a space or before
// punctuation: a trailing space there once left "Zheng et al. 2023 ." when the writer typed the stop.
export function mentionInsertion(label: string, uri: string, next: string): string {
  const link = mentionLink(label, uri)
  return /[\p{L}\p{N}]/u.test(next) ? `${link} ` : link
}
