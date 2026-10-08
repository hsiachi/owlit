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

// Obsidian's [[wikilinks]] and ![[embeds]], read before ordinary links so "[[" isn't taken as one
export const Wikilinks: MarkdownConfig = {
  defineNodes: [
    { name: "Wikilink", style: tags.link },
    { name: "Embed", style: tags.link },
  ],
  parseInline: [
    {
      name: "Wikilink",
      parse(cx, next, pos) {
        const embed = next === 33 /* ! */ && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91
        if (!embed && !(next === 91 /* [ */ && cx.char(pos + 1) === 91)) return -1
        const open = pos + (embed ? 3 : 2)
        for (let i = open; i < cx.end - 1; i++) {
          const c = cx.char(i)
          if (c === 10 || c === 91) return -1
          if (c === 93 && cx.char(i + 1) === 93) return i === open ? -1 : cx.addElement(cx.elt(embed ? "Embed" : "Wikilink", pos, i + 2))
        }
        return -1
      },
      before: "Link",
    },
  ],
}

// $inline$ and $$block$$ math. An opening $ can't be followed by a space and a closing one can't follow a
// space or come before a digit, so "$5 and $10" stays money.
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: tags.special(tags.string) },
    { name: "MathMark", style: tags.processingInstruction },
    { name: "BlockMath", block: true, style: tags.special(tags.string) },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== 36 /* $ */ || cx.char(pos + 1) === 36) return -1
        const first = cx.char(pos + 1)
        if (first === -1 || first === 32 || first === 9) return -1
        for (let i = pos + 1; i < cx.end; i++) {
          const c = cx.char(i)
          if (c === 92 /* \ */) {
            i++
            continue
          }
          if (c !== 36) continue
          const before = cx.char(i - 1)
          const after = cx.char(i + 1)
          if (before === 32 || before === 9 || (after >= 48 && after <= 57)) return -1
          return cx.addElement(cx.elt("InlineMath", pos, i + 1, [cx.elt("MathMark", pos, pos + 1), cx.elt("MathMark", i, i + 1)]))
        }
        return -1
      },
    },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      parse(cx, line) {
        if (!line.text.slice(line.pos).startsWith("$$")) return false
        const start = cx.lineStart + line.pos
        const rest = line.text.slice(line.pos + 2)
        let end = cx.lineStart + line.text.length
        // $$ x $$ on one line
        if (rest.trim().length > 2 && rest.trimEnd().endsWith("$$")) {
          cx.nextLine()
          cx.addElement(cx.elt("BlockMath", start, end))
          return true
        }
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length
          if (line.text.trimEnd().endsWith("$$")) {
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt("BlockMath", start, end))
        return true
      },
      before: "FencedCode",
    },
  ],
}
