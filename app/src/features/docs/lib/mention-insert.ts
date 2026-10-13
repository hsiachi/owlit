// The text a picked mention becomes in a doc, in place of the typed "@query". A mention mid-sentence is
// followed by whatever was already there: a space is added only when the next character would otherwise
// run into the link (a word, or the end of the line, where the writer goes on typing), never before a
// space or punctuation, which once left "2023 ." on screen and a double space in the file.
export function mentionInsertion(label: string, uri: string, next: string): string {
  const link = `[${label}](${uri})`
  return next === "" || next === "\n" || /[\p{L}\p{N}]/u.test(next) ? `${link} ` : link
}
