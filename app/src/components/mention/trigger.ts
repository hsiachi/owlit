// When "@" (or the IME's full-width "＠") starts a mention, in docs, notes and the composer alike: at the
// start of a line, after a space or bracket, or right after a CJK character or punctuation mark, since
// Chinese puts no space before it. The query that follows has no spaces. Not after a Latin letter or
// digit, so an email address stays text.
export const MENTION_TRIGGER = /(?:^|[\s([　-〿぀-ヿ㐀-鿿豈-﫿！-？])[@＠]([^\s@＠[\]()]{0,40})$/

// The mention being typed at the end of `before` (the text up to the cursor), if one is
export function mentionAtEnd(before: string): { query: string; length: number } | null {
  const m = MENTION_TRIGGER.exec(before)
  return m ? { query: m[1]!, length: m[1]!.length + 1 } : null
}
