import type { Paper, ResolvedPaper } from "@owlit/protocol"

// A looked-up paper, with the id of the one the library already has for it, if any
export type Resolved = ResolvedPaper & { existingId?: string }

// The part of the library that core does for the UI in the desktop app (and a mock does on its own): turning
// a reference or a file into metadata, and finding a PDF. Records themselves live in the store.
export interface LibraryClient {
  // DOI, arXiv id / URL, or any URL → metadata. Rejects with a sentence when it cannot.
  resolve(input: string): Promise<Resolved>
  // Metadata guessed from a dropped PDF, without core. In the desktop app core imports the file itself
  // (importPdf in ./disk).
  importPdf?(file: File): Promise<ResolvedPaper>
  // Looks for the paper's PDF now and waits: the PDF, or where getting it stands afterwards. Rejects
  // with a sentence only when owlit couldn't look (offline).
  fetchPdf(paper: Paper): Promise<Pick<Paper, "pdf" | "pdfState">>
  // A PDF the user has, as the paper's file
  attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]>
}
