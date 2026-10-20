// When "@" (or the IME's full-width "＠") starts a mention, in docs, notes and the composer alike: at the
// start of a line, after a space or bracket, or right after a CJK character or punctuation mark, since
// Chinese puts no space before it. Not after a Latin letter or digit, so an email address stays text.
// The query that follows is one word, or in a doc several ("@vaswani attention"), one space apart: it
// ends at a punctuation mark (a name's hyphen or apostrophe aside), a bracket, a line's end or two spaces.
// A composer or a note sends or breaks the line on Enter, so a popup that stayed open over the words
// typed after a mention would be in the way there.
export const MENTION_TRIGGER = /(?:^|[\s([　-〿぀-ヿ㐀-鿿豈-﫿！-？])[@＠]((?:[^\s@＠[\]()\p{P}]|[-'’]|[ \t](?![ \t]))*)$/u
// How long a query may grow before @ is taken for text
const QUERY_MAX = 40

// The mention being typed at the end of `before` (the text up to the cursor), if one is; words: the query
// may run to several words
export function mentionAtEnd(before: string, { words = false } = {}): { query: string; length: number } | null {
  const m = MENTION_TRIGGER.exec(before)
  if (!m || m[1]!.length > QUERY_MAX || /^\s/.test(m[1]!) || (!words && /\s/.test(m[1]!))) return null
  return { query: m[1]!, length: m[1]!.length + 1 }
}
