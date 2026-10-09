// Library domain types. A paper is one record: facts about it plus the user's judgement
// (star, status, tags). Highlights and notes are separate records keyed by paper.

export type ReadStatus = "unread" | "reading" | "read"

export type HighlightColor = "yellow" | "green" | "blue" | "pink"

// What kind of publication it is, which decides the BibTeX entry type. Filled by the resolver;
// unknown papers fall back on their ids (arXiv only → preprint).
export type PaperKind = "article" | "conference" | "preprint" | "book" | "thesis" | "other"

export interface PaperIds {
  // Lowercase, without a doi.org prefix
  doi?: string
  // Without a version: 2408.00447, hep-th/9901001
  arxiv?: string
  // Semantic Scholar's paperId (40 hex)
  s2?: string
  // OpenAlex work id: W2741809807
  openalex?: string
  url?: string
}

export interface PaperPdf {
  // Object URL (dropped file) or a remote URL; one PDF per paper for now
  url: string
  pages?: number
}

export interface Paper {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  ids: PaperIds
  pdf?: PaperPdf
  // No PDF could be found: the routes tried ("arxiv", "publisher:acm", "unpaywall/repository", …)
  noPdf?: { tried: string[]; at: number }
  addedAt: number
  // "agent" + unread is the Inbox view, once agents can add papers
  addedBy: "user" | "agent"
  starred: boolean
  // unread on add; reading is set automatically when the PDF is first opened; read is manual
  status: ReadStatus
  tags: string[]
  kind?: PaperKind
  lastOpenedAt?: number
  // Reading position, so a paper reopens where it was left
  position?: ReadingPosition
}

// The top of what was on screen: a 1-based page and a distance from that page's top edge in
// PDF points, so it survives a change of zoom or window width
export interface ReadingPosition {
  page: number
  y: number
}

// Rectangle in PDF points from the page's top-left corner, as EmbedPDF's selection reports it
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PageRect extends Rect {
  // 0-based
  page: number
}

export interface Highlight {
  id: string
  paperId: string
  // 0-based page the highlight starts on; a selection across a page break keeps one record
  page: number
  // One rect per line, in reading order
  rects: PageRect[]
  text: string
  color: HighlightColor
  comment?: string
  createdAt: number
}

export interface PaperNote {
  paperId: string
  content: string
  updatedAt: number
}

// What a reference resolves to before it becomes a Paper. id is the one it will have in the library.
export type ResolvedPaper = Pick<Paper, "title" | "authors" | "ids"> &
  Partial<Pick<Paper, "id" | "year" | "venue" | "abstract" | "pdf" | "kind">>

// library/papers/<id>/paper.json: what the paper is, as the services and the file say. Regenerable;
// what the user changed by hand lives in .owlit/papers/<id>/state.json (overrides) and wins.
export interface PaperRecord {
  version: 1
  id: string
  ids: PaperIds
  title: string
  authors: string[]
  year?: number
  // ISO date of first publication
  date?: string
  venue?: string
  abstract?: string
  kind?: PaperKind
  // Semantic Scholar's one-sentence summary
  tldr?: string
  citationCount?: number
  // Open-access PDF links the services know, best first
  pdfUrls?: string[]
  // Where each field came from: "openalex" | "s2" | "arxiv" | "pdf" | …
  fields: Partial<Record<string, string>>
  // When the services were last asked
  fetchedAt?: number
}

// .owlit/papers/<id>/state.json: what the user thinks of a paper and did with it. Kept forever,
// travels with the workspace. Highlights sit beside it in highlights.jsonl, the note in note.md.
export interface PaperState {
  version: 1
  addedAt: number
  addedBy: Paper["addedBy"]
  starred: boolean
  status: ReadStatus
  tags: string[]
  position?: ReadingPosition
  lastOpenedAt?: number
  // Fields the user corrected by hand; they win over paper.json and survive a metadata refresh
  overrides?: PaperOverrides
}

// null: the user cleared a field the record has
export type PaperOverrides = Partial<Pick<PaperRecord, "title" | "authors" | "kind">> & {
  year?: number | null
  venue?: string | null
  abstract?: string | null
  ids?: Partial<PaperIds>
}

// What library.update may change: the user's judgement and position, or a field they correct
export type PaperPatch = Partial<Omit<Paper, "id" | "pdf" | "addedAt" | "addedBy">>

// library.changed: papers core changed on its own (a task, another program, an agent); the window
// takes them as they are. Removed ids are gone from the library.
export interface LibraryChange {
  papers: Paper[]
  removed: string[]
}

// library/papers/<id>/text.json: the paper's full text with where each line sits, so a passage can be
// found and outlined on the page. Rects are PDF points from the page's top-left corner, as highlights
// are. pdfium writes it in seconds; MinerU's version replaces it when it comes (better order, tables,
// formulas), and the pdfium one stays as text.pdfium.json.
export interface PaperText {
  version: 1
  source: "pdfium" | "mineru" | "mineru-legacy"
  // Almost no text layer: a scan waiting for OCR (MinerU)
  needsOcr?: boolean
  pages: TextPage[]
}

export interface TextPage {
  // 0-based
  index: number
  width: number
  height: number
  blocks: TextBlock[]
}

export interface TextBlock {
  kind: "paragraph" | "heading" | "table" | "figure" | "formula" | "other"
  rect: Rect
  lines: TextLine[]
}

export interface TextLine {
  rect: Rect
  text: string
}
