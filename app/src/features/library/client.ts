import type { Paper, ResolvedPaper } from "@owlit/protocol"

// A looked-up paper, with the id of the one the library already has for it, if any, and the kinds of
// id core added to that one from the lookup (Library.learnIds)
export type Resolved = ResolvedPaper & { existingId?: string; learned?: LearnedId[] }

export type LearnedId = "arxiv" | "s2" | "openalex"

// The part of the library that core does for the UI: turning a reference into metadata, and finding a
// PDF. Records themselves live in the store; a dropped PDF goes to core whole (importPdf in ./disk).
export interface LibraryClient {
  // DOI, arXiv id / URL, or any URL → metadata. Rejects with a sentence when it cannot.
  resolve(input: string): Promise<Resolved>
  // Looks for the paper's PDF now and waits: the PDF, or where getting it stands afterwards. Rejects
  // with a sentence only when owlit couldn't look (offline).
  fetchPdf(paper: Paper): Promise<Pick<Paper, "pdf" | "pdfState">>
  // A PDF the user has, as the paper's file
  attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]>
}
