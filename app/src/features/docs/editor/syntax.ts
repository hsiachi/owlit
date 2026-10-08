import { tags } from "@lezer/highlight"
import type { MarkdownConfig } from "@lezer/markdown"

// Obsidian's ==highlight==, parsed the way GFM parses ~~strikethrough~~ so the live preview can hide its marks
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" }
const space = /\s|^$/
const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}]/u

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": tags.special(tags.content) } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = space.test(before)
        const sAfter = space.test(after)
        const pBefore = punctuation.test(before)
        const pAfter = punctuation.test(after)
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter))
      },
      after: "Emphasis",
    },
  ],
}
