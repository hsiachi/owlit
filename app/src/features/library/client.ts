import type { Paper, ResolvedPaper } from "./types"

// The part of the library the desktop shell will eventually do for the UI: turning a
// reference or a file into metadata, and finding a PDF. Records themselves live in the store.
export interface LibraryClient {
  // DOI, arXiv id / URL, or any URL → metadata. Rejects with a sentence when it cannot.
  resolve(input: string): Promise<ResolvedPaper>
  // Metadata read from a dropped PDF
  importPdf(file: File): Promise<ResolvedPaper>
  // Look for an open-access PDF for an existing paper. Rejects with a sentence when none is found.
  fetchPdf(paper: Paper): Promise<Paper["pdf"]>
}
