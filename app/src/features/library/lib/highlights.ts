import type { Highlight, HighlightColor } from "../types"

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"]

export const HIGHLIGHT_LABEL: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
}

export const HIGHLIGHT_VAR: Record<HighlightColor, string> = {
  yellow: "var(--highlight-yellow)",
  green: "var(--highlight-green)",
  blue: "var(--highlight-blue)",
  pink: "var(--highlight-pink)",
}

// The deeper version, for the bar beside a highlight in the list
export const HIGHLIGHT_MARK: Record<HighlightColor, string> = {
  yellow: "var(--highlight-yellow-mark)",
  green: "var(--highlight-green-mark)",
  blue: "var(--highlight-blue-mark)",
  pink: "var(--highlight-pink-mark)",
}

// Text pulled off a PDF arrives one line per entry. Join lines back into prose: a word broken
// with a hyphen at a line end is mended, other line ends become spaces.
export function cleanPdfText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\r/g, "")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

// Reading order: by page, then top to bottom, then left to right
export function compareHighlights(a: Highlight, b: Highlight): number {
  const ra = a.rects[0]
  const rb = b.rects[0]
  return a.page - b.page || (ra?.y ?? 0) - (rb?.y ?? 0) || (ra?.x ?? 0) - (rb?.x ?? 0)
}

export function paperHighlights(all: Record<string, Highlight>, paperId: string): Highlight[] {
  return Object.values(all)
    .filter((h) => h.paperId === paperId)
    .sort(compareHighlights)
}

// One highlight as a Markdown quote with its page, and the comment under it
export function highlightMarkdown(h: Highlight): string {
  const quote = `> ${h.text} (p. ${h.page + 1})`
  return h.comment ? `${quote}\n\n${h.comment}` : quote
}

export function highlightsMarkdown(hs: Highlight[]): string {
  return hs.map(highlightMarkdown).join("\n\n")
}
