const TITLE_MAX = 80

// A chat's title is its first question, cut at a word when it runs long and ended with an ellipsis, so a
// title that fits its row (Home, the panel header) still reads as cut rather than ending mid-word; a row
// too narrow for it truncates with CSS, which adds its own ellipsis to the shortened words
export const titleFrom = (text: string) => {
  const t = text.replace(/@\[([^\]]+)\]/g, "$1").replace(/\s+/g, " ").trim()
  if (t.length <= TITLE_MAX) return t || "New chat"
  const head = t.slice(0, TITLE_MAX)
  const space = head.lastIndexOf(" ")
  // A single word longer than half the room is cut as it is, not dropped
  const cut = space > TITLE_MAX / 2 ? head.slice(0, space) : head
  // "…, and how were" would end on a comma; the ellipsis stands for the rest
  return `${cut.replace(/[\s,;:(\[{\-–—]+$/, "")}…`
}
