// Library domain types. A paper is one record: facts about it plus the user's judgement
// (star, status, tags). Highlights and notes are separate records keyed by paper.

export type ReadStatus = "unread" | "reading" | "read"

export type HighlightColor = "yellow" | "green" | "blue" | "pink"

export interface PaperIds {
  doi?: string
  arxiv?: string
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
  addedAt: number
  // "agent" + unread is the Inbox view, once agents can add papers
  addedBy: "user" | "agent"
  starred: boolean
  // unread on add; reading is set automatically when the PDF is first opened; read is manual
  status: ReadStatus
  tags: string[]
  // Reading position, so a paper reopens where it was left
  lastOpenedAt?: number
  lastPage?: number
}

// Page-space rectangle, as EmbedPDF's selection reports it
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Highlight {
  id: string
  paperId: string
  // 0-based
  page: number
  rects: Rect[]
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

// What a reference resolves to before it becomes a Paper
export type ResolvedPaper = Pick<Paper, "title" | "authors" | "ids"> &
  Partial<Pick<Paper, "year" | "venue" | "abstract" | "pdf">>
