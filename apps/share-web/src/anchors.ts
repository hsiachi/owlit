import { anchorAt, findAnchor, type ShareAnchor } from "@owlit/protocol"

// Comments on the drawn doc. A comment is anchored on the words the reader selected, with a little text
// either side (the author's owlit finds the same words in the Markdown, protocol's locateInMarkdown); here
// those words are found again in the page's text after every redraw.

interface TextMap {
  text: string
  nodes: { node: Text; start: number }[]
}

function textMap(root: Element): TextMap {
  const nodes: TextMap["nodes"] = []
  let text = ""
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // KaTeX draws math twice, once for screen readers (MathML); only what shows counts
    if (node.parentElement?.closest(".katex-mathml")) continue
    nodes.push({ node, start: text.length })
    text += node.data
  }
  return { text, nodes }
}

function pointAt(map: TextMap, offset: number): { node: Text; offset: number } | null {
  for (let i = map.nodes.length - 1; i >= 0; i--) {
    const { node, start } = map.nodes[i]
    if (start <= offset) return { node, offset: Math.min(offset - start, node.data.length) }
  }
  return null
}

function offsetOf(map: TextMap, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = map.nodes.find((n) => n.node === node)
    return entry ? entry.start + offset : null
  }
  // A point between elements: the first text after it
  const child = node.childNodes[offset]
  const after = child ? map.nodes.find((n) => child === n.node || child.contains(n.node)) : undefined
  if (after) return after.start
  const inside = map.nodes.filter((n) => node.contains(n.node))
  const last = inside[inside.length - 1]
  return last ? last.start + last.node.data.length : null
}

// The selection inside root as an anchor, or null when it isn't inside root or holds no words
export function anchorOfRange(root: Element, range: Range): ShareAnchor | null {
  if (!root.contains(range.commonAncestorContainer)) return null
  const map = textMap(root)
  const from = offsetOf(map, range.startContainer, range.startOffset)
  const to = offsetOf(map, range.endContainer, range.endOffset)
  if (from === null || to === null || to <= from) return null
  // Spaces at either end are part of no word
  let a = from
  let b = to
  while (a < b && /\s/.test(map.text[a])) a++
  while (b > a && /\s/.test(map.text[b - 1])) b--
  return a < b ? anchorAt(map.text, a, b) : null
}

// Where each anchor's words are now in root; missing from the map when they are gone
export function rangesFor(root: Element, anchors: { id: string; anchor: ShareAnchor }[]): Map<string, Range> {
  const map = textMap(root)
  const found = new Map<string, Range>()
  for (const { id, anchor } of anchors) {
    const at = findAnchor(map.text, anchor)
    if (at === null) continue
    const start = pointAt(map, at)
    const end = pointAt(map, at + anchor.quote.length)
    if (!start || !end) continue
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    found.set(id, range)
  }
  return found
}

// The anchor under a click, if any
export function rangeAtPoint(ranges: Map<string, Range>, x: number, y: number): string | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  const caret = doc.caretPositionFromPoint?.(x, y)
  const point = caret ? { node: caret.offsetNode, offset: caret.offset } : (() => {
    const r = document.caretRangeFromPoint?.(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  })()
  if (!point) return null
  for (const [id, range] of ranges) {
    try {
      // The caret sits between characters: a click just past the last one isn't on the passage
      const atEnd = range.endContainer === point.node && range.endOffset === point.offset
      if (range.isPointInRange(point.node, point.offset) && !atEnd) return id
    } catch {
      // A point in another tree than the range's
    }
  }
  return null
}

// Underlines drawn with the CSS Custom Highlight API, so the page's own DOM (React's) is never touched.
// Where the browser lacks it, comments are still listed and open from the list.
type HighlightRegistry = Map<string, unknown>
const registry = (): HighlightRegistry | null => (typeof CSS !== "undefined" && "highlights" in CSS ? ((CSS as unknown as { highlights: HighlightRegistry }).highlights) : null)
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

export function paint(name: string, ranges: Range[]) {
  const highlights = registry()
  if (!highlights || !HighlightCtor) return
  if (ranges.length) highlights.set(name, new HighlightCtor(...ranges))
  else highlights.delete(name)
}
