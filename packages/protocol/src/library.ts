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
  // ACL Anthology id, which also names its PDF there: W06-1314, 2023.acl-long.1
  acl?: string
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
  // Digests an agent wrote (library/papers/<id>/digest.md), and when (digest.json's at, else the
  // file's time), so the note can be signed with its age
  hasDigest?: boolean
  digestAt?: number
  // The digest no longer matches how owlit writes them: an older way of writing (format), or
  // another language than Settings now asks for (language). Rewriting is the user's call.
  digestOutdated?: "format" | "language"
  // How well its text was read: full (MinerU) or basic (pdfium's text layer); absent before either
  text?: "full" | "basic"
  // No PDF could be found: the routes tried ("arxiv", "publisher:acm", "unpaywall/repository", …), and
  // whether the user's own browser is the way (browser): the publisher's page wanted a person (a check,
  // a sign-in), or the publisher lets only that browser in (the ACM)
  noPdf?: {
    tried: string[]
    at: number
    needs?: "browser"
    // What owlit opens in the user's browser for it: the PDF, which their browser saves by itself, or
    // the article page, where they save it
    browserOpens?: "pdf" | "page"
    // Being got from the user's browser (library.getInBrowser): waiting its turn, opened there and
    // waiting for the file, its article page opened there for them to save the PDF from, opened with
    // nothing arriving, or the paper the run stopped on for the user. browser is that browser's name;
    // why, what its tab showed when the run stopped (a sign-in, a check, a page still at the PDF, one
    // owlit can't tell), with that page's title and host.
    fromBrowser?: {
      state: "queued" | "opened" | "page" | "missed" | "waiting"
      browser?: string
      why?: "sign-in" | "check" | "on-pdf" | "unknown"
      page?: { title: string; host: string }
    }
    // The user's browser reached the publisher and it said no (refused: the library proxy said it
    // hasn't got it; missing: the publisher has no PDF at that address), with the page it showed. Kept
    // until a PDF comes or the paper is tried again.
    noAccess?: { refused: boolean; missing?: boolean; host?: string; title?: string; at: number }
    // A PDF that arrived in Downloads (file name) owlit isn't sure is this paper's, for them to confirm
    offered?: string
  }
  addedAt: number
  // "agent" + unread is the Inbox view, once agents can add papers
  addedBy: "user" | "agent"
  starred: boolean
  // unread on add; reading is set once the person has read in it (not on a mere open); read is manual
  status: ReadStatus
  tags: string[]
  kind?: PaperKind
  // How often other works cite it, as a service counted it (openalex, else s2 or crossref) and when
  citations?: { count: number; source: string; at: number }
  // When the person last read in it, which a glance doesn't count as; Up next's Reading group goes by it
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

// A figure or table of a paper as a picture (library/papers/<id>/figures/), from MinerU's reading of
// the PDF. A digest shows one by its id: ![Figure 3](figure-3).
export interface PaperFigure {
  // figure-3, table-2, figure-s1
  id: string
  kind: "figure" | "table"
  // "Figure 3", as its caption numbers it
  label: string
  caption: string
  // 0-based
  page: number
  // Where it sits, PDF points from the page's top-left corner
  rect: Rect
  // The picture, served from the workspace
  url: string
}

// What has been read of a paper, for its reader to show: the sentences Owlit's answers rested on, and the
// pages the person stayed on (seconds at the top of the screen, by 1-based page)
export interface PaperWear {
  cited: CitedPassage[]
  pages: Record<number, number>
}

// A sentence of the paper an answer in a chat rested on, word for word as the agent gave it in the
// citation's link title: [Rong et al. 2017](owlit://library/<id>#p4 "the sentence")
export interface CitedPassage {
  quote: string
  page?: number
  chatId: string
  chatTitle: string
  messageId: string
  at: number
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
  // Absent: the user's own
  addedBy?: "agent"
  createdAt: number
}

export interface PaperNote {
  paperId: string
  content: string
  updatedAt: number
}

// A collection brought in at once: a Zotero library, a BibTeX file, a folder of PDFs
export type ImportSource = "zotero" | "bibtex" | "folder"

// What an import has done so far. Its task (import.<source>) carries the progress and the state.
export interface ImportSummary {
  id: string
  taskId: string
  source: ImportSource
  // The file or folder it reads
  path: string
  createdAt: number
  // How many papers the collection holds, once it has been read
  total?: number
  // The papers it added, by id; their PDFs may still be on the way
  added: string[]
  // How many the library had already
  existed: number
  failed: { key: string; title?: string; error: string }[]
  finishedAt?: number
  // Whether MinerU reads the added papers' PDFs; false when the user said not to for this import
  parse?: boolean
  // The Library's line about it was put away
  dismissed?: boolean
}

// What an import would do, read before it starts
export interface ImportPreview {
  total: number
  withPdf: number
  // How many the library has already
  known: number
  // Zotero's collections that hold any of the papers
  collections: number
  // MinerU would read every new PDF unless told not to, and there are enough to ask
  asksParse: boolean
}

// What a reference resolves to before it becomes a Paper. id is the one it will have in the library.
export type ResolvedPaper = Pick<Paper, "title" | "authors" | "ids"> &
  Partial<Pick<Paper, "id" | "year" | "venue" | "abstract" | "pdf" | "kind">>

// Where a search outside the library looks. Each has filters the others lack, so they are asked one at
// a time and a filter the chosen one can't apply is refused rather than applied to its results after.
export type OnlineSource = "openalex" | "s2" | "arxiv"

export interface OnlineFilters {
  // 2023, 2019-2023, 2023- or -2023
  year?: string
  sort?: "relevance" | "citations" | "newest"
  minCitations?: number
  // article: a journal or conference paper
  type?: "article" | "review" | "preprint" | "book"
  author?: string
  venue?: string
  // Only papers with a free full text
  openAccess?: boolean
}

// A paper found outside the library (or in it already: inLibrary is its id, hasPdf whether it has the file)
export type FoundPaper = ResolvedPaper & {
  inLibrary?: string
  hasPdf?: boolean
  citationCount?: number
  tldr?: string
  // A free PDF is known
  openPdf?: boolean
  // Where it sits in a journal
  volume?: string
  issue?: string
}

export interface FoundPapers {
  papers: FoundPaper[]
  // How many there are in all, when the service says
  total?: number
  // Who answered: openalex, s2, arxiv or crossref
  source: string
  // What the answer stands for, when the request had to be interpreted ("venue: Proceedings of the CHI
  // Conference…", "Information Processing & Management (ISSN 0306-4573)")
  matched?: string
  // What the agent should know about the list ("Semantic Scholar gives the first 1000; sorted among those")
  note?: string
}

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
  // When citationCount was counted; absent on records from before counts were kept current, which
  // fetchedAt dates
  citationsAt?: number
  // Open-access PDF links the services know, best first
  pdfUrls?: string[]
  // Where each field came from: "openalex" | "s2" | "arxiv" | "pdf" | …
  fields: Partial<Record<string, string>>
  // When the services were last asked
  fetchedAt?: number
  // Which round of metadata checks the record has had (core's METADATA_CHECKS); an older one is
  // looked up again in the background when the workspace opens
  checked?: number
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
  // A paper that moved to another id (a local file given its DOI): old id → new id
  renamed?: Record<string, string>
}

// A paper in .owlit/trash/ (removed by the user, or taken back by an agent), as library.trash lists it;
// library.restore brings it back whole
export interface TrashedPaper {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  removedAt: number
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
  // code and list: lines kept as lines (MinerU's code blocks, keeping their indentation, and list items)
  kind: "paragraph" | "heading" | "table" | "figure" | "formula" | "code" | "list" | "other"
  rect: Rect
  lines: TextLine[]
}

export interface TextLine {
  rect: Rect
  text: string
}
