import type { CitationPassage, CitedWork } from "@owlit/protocol"
import { findQuote, squash } from "./quotes.ts"

// Where a cited sentence sits in a paper, for its card: the section heading above it, its page and a
// sentence either side, from text.md (toMarkdown's shape: blocks apart by a blank line, a page marker
// as its own block, "## " headings, Markdown tables) or from the abstract.

// The neighbours are cut to this many characters, at a word; the card shows them in grey around the quote
const NEIGHBOUR_CHARS = 95

type Kind = "heading" | "table" | "caption" | "figure" | "text"

interface Block {
  page: number
  kind: Kind
  text: string
  // A table's number, read from its caption right before or after it
  table?: string
}

const TABLE_CAPTION = /^(?:Table|Tab\.)\s*([0-9]+|[IVXLC]+)\b/i

function blocksOf(textMd: string): Block[] {
  const blocks: Block[] = []
  let page = 1
  for (const raw of textMd.split(/\n\s*\n/)) {
    const text = raw.trim()
    if (!text) continue
    const marker = /^<!-- page (\d+) -->$/.exec(text)
    if (marker) {
      page = Number(marker[1])
      continue
    }
    const kind: Kind = /^#{1,6}\s/.test(text)
      ? "heading"
      : text.split("\n").every((l) => l.trim().startsWith("|"))
        ? "table"
        : /^\*[^]*\*$/.test(text)
          ? "figure"
          : "text"
    blocks.push({ page, kind, text: kind === "heading" ? text.replace(/^#{1,6}\s+/, "") : text })
  }
  // A caption beside a table names it, and is the table's, not a sentence of the text
  for (const [i, b] of blocks.entries()) {
    if (b.kind !== "table") continue
    for (const j of [i - 1, i + 1]) {
      const near = blocks[j]
      const number = near && near.kind !== "heading" && near.kind !== "table" ? TABLE_CAPTION.exec(near.text.replace(/^\*/, ""))?.[1] : undefined
      if (number) {
        b.table = number
        near!.kind = "caption"
        break
      }
    }
  }
  return blocks
}

// A run of text cut into sentences. A full stop ends one only before what starts a sentence (a capital,
// maybe after a quote mark or bracket), and not after an abbreviation that is usually followed by more
// of the same sentence; CJK full stops always end one.
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<!\b(?:e\.g|i\.e|al|Fig|Figs|Eq|Eqs|cf|vs|Sec|No|Dr|Mr|Ms|resp|approx|ca)\.)(?<=[.!?])\s+(?=["“‘'(\[]?\p{Lu})|(?<=[。！？])/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

// The end of a sentence before the quote, or the start of one after it, cut at a word
const tail = (s: string) => (s.length <= NEIGHBOUR_CHARS ? s : "…" + s.slice(s.length - NEIGHBOUR_CHARS).replace(/^\S*\s/, ""))
const head = (s: string) => (s.length <= NEIGHBOUR_CHARS ? s : s.slice(0, NEIGHBOUR_CHARS).replace(/\s\S*$/, "") + "…")

// The sentences [start, end] of a list that hold the quote, the fewest that do; null when none do
function sentencesHolding(sentences: string[], want: string): [number, number] | null {
  const end = sentences.findIndex((_, j) => squash(sentences.slice(0, j + 1).join(" ")).includes(want))
  if (end < 0) return null
  let start = 0
  while (start < end && squash(sentences.slice(start + 1, end + 1).join(" ")).includes(want)) start++
  return [start, end]
}

// What stands next to a run of blocks, in one direction: a sentence of the nearest text block, a table
// as "[Table n]", nothing past a heading (the section starts or ends there). Figure captions are skipped.
function neighbour(blocks: Block[], from: number, step: -1 | 1): string | undefined {
  for (let i = from + step; i >= 0 && i < blocks.length; i += step) {
    const b = blocks[i]!
    if (b.kind === "heading") return undefined
    if (b.kind === "figure") continue
    if (b.kind === "table") return b.table ? `[Table ${b.table}]` : undefined
    if (b.kind === "caption") {
      const table = blocks[i + step]
      return table?.kind === "table" && table.table ? `[Table ${table.table}]` : undefined
    }
    const sentences = sentencesOf(b.text)
    const s = step < 0 ? sentences.at(-1) : sentences[0]
    return s && (step < 0 ? tail(s) : head(s))
  }
  return undefined
}

// Where a quote sits in a paper's text.md: the page it starts on, the heading above it and the sentence
// either side. Null when it isn't there within one block or two next to each other (findQuote may still
// find its page across a heading or a table).
export function passageIn(textMd: string, quote: string): CitationPassage | null {
  const want = squash(quote)
  if (!want) return null
  const blocks = blocksOf(textMd)
  const text = (b: Block | undefined) => b?.kind === "text"
  let first = blocks.findIndex((b) => text(b) && squash(b.text).includes(want))
  let last = first
  if (first < 0) {
    first = blocks.findIndex((b, i) => text(b) && text(blocks[i + 1]) && squash(`${b.text} ${blocks[i + 1]!.text}`).includes(want))
    if (first < 0) return null
    last = first + 1
  }
  const run = blocks.slice(first, last + 1)
  const sentences = run.map((b) => sentencesOf(b.text))
  const all = sentences.flat()
  const [start, end] = sentencesHolding(all, want) ?? [0, all.length - 1]
  const section = blocks.slice(0, first).findLast((b) => b.kind === "heading")?.text
  // The page of the block the quote starts in: the run's second block when it starts there
  const page = start >= sentences[0]!.length ? run[1]!.page : run[0]!.page
  const before = start > 0 ? tail(all[start - 1]!) : neighbour(blocks, first, -1)
  const after = end < all.length - 1 ? head(all[end + 1]!) : neighbour(blocks, last, 1)
  return { page, ...(section ? { section } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) }
}

// Where a quote sits in a paper's abstract, with the sentence either side; null when it isn't there
export function passageInAbstract(abstract: string | undefined, quote: string): CitationPassage | null {
  const want = squash(quote)
  if (!abstract || !want || !squash(abstract).includes(want)) return null
  const sentences = sentencesOf(abstract)
  const [start, end] = sentencesHolding(sentences, want) ?? [0, sentences.length - 1]
  const before = start > 0 ? tail(sentences[start - 1]!) : undefined
  const after = end < sentences.length - 1 ? head(sentences[end + 1]!) : undefined
  return { abstract: true, ...(before ? { before } : {}), ...(after ? { after } : {}) }
}

// Where a cited sentence is in a paper: in its abstract first (a sentence of the abstract is the paper's
// summary of itself, however its text repeats it), else in its text, with only the page when the words
// cross what passageIn joins; null when neither holds it (text: null when owlit has none)
export function placeOf(quote: string, paper: { abstract?: string; text: string | null }): CitationPassage | null {
  const inAbstract = passageInAbstract(paper.abstract, quote)
  if (inAbstract) return inAbstract
  if (paper.text === null) return null
  const page = findQuote(paper.text, quote)
  if (page === null) return null
  return passageIn(paper.text, quote) ?? { page }
}

// An author-year reference inside parentheses: "(Reicherts et al., 2021)", "(Suchman 1987; Dourish, 2004)"
const AUTHOR_YEAR = /\((?=[^()]*\p{Lu}[\p{L}'’-]+[^()]*\b(?:19|20)\d{2}[a-z]?\b)[^()]*\)/gu
// One in running text: "Reicherts et al. (2021)", "Kim and Lee (2020)"
const NARRATIVE = /\b\p{Lu}[\p{L}'’-]+(?:\s+(?:et al\.?|(?:and|&)\s+\p{Lu}[\p{L}'’-]+))?\s+\((?:19|20)\d{2}[a-z]?\)/gu
// A numbered one: "[12]", "[3, 4]", "[3–5]"
const NUMBERED = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g

// The works a cited sentence cites itself, by string match: a sentence like that may hold the paper's
// report of someone else's finding. A numbered marker's first number is looked up in the reference
// list of textMd, when given.
export function citesOtherIn(quote: string, textMd?: string | null): CitedWork[] {
  const found: { at: number; work: CitedWork }[] = []
  for (const m of quote.matchAll(AUTHOR_YEAR)) found.push({ at: m.index, work: { marker: m[0] } })
  for (const m of quote.matchAll(NARRATIVE)) found.push({ at: m.index, work: { marker: m[0] } })
  for (const m of quote.matchAll(NUMBERED)) {
    const reference = textMd ? referenceOf(textMd, Number(/^\d+/.exec(m[1]!)![0])) : undefined
    found.push({ at: m.index, work: { marker: m[0], ...(reference ? { reference } : {}) } })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.work)
}

// The start of entry n in a paper's reference list ("[12] A. Author. Title …"), when its entries are
// numbered in brackets
function referenceOf(textMd: string, n: number): string | undefined {
  const at = textMd.search(/^#{1,6}\s*(?:\d+\.?\s*)?(?:References|Bibliography|Literature Cited|参考文献)\s*$/im)
  if (at < 0) return undefined
  const list = textMd.slice(at).replace(/<!-- page \d+ -->/g, " ").replace(/\s+/g, " ")
  const entry = new RegExp(`\\[${n}\\]\\s*(.+?)(?=\\s\\[\\d+\\]|$)`).exec(list)?.[1]?.trim()
  return entry ? head(entry) : undefined
}
