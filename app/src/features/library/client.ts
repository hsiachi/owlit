import { t } from "@lingui/core/macro"
import type { Paper, ResolvedPaper } from "@owlit/protocol"

// A looked-up paper, with the id of the one the library already has for it, if any
export type Resolved = ResolvedPaper & { existingId?: string }

// The part of the library the desktop shell will eventually do for the UI: turning a
// reference or a file into metadata, and finding a PDF. Records themselves live in the store.
export interface LibraryClient {
  // DOI, arXiv id / URL, or any URL → metadata. Rejects with a sentence when it cannot.
  resolve(input: string): Promise<Resolved>
  // Metadata guessed from a dropped PDF, without core. In the desktop app core imports the file itself
  // (importPdf in ./disk).
  importPdf?(file: File): Promise<ResolvedPaper>
  // Look for an open-access PDF for an existing paper. Rejects with a sentence when none is found.
  fetchPdf(paper: Paper): Promise<Paper["pdf"]>
  // A PDF the user has, as the paper's file
  attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]>
  // The user's answer about a downloaded PDF owlit offered (noPdf.offered)
  takeDownload?(paper: Paper, take: boolean): Promise<Paper>
}

// fetchPdf found no PDF owlit can get alone: the user's own browser is the way
export class PublisherNeedsUser extends Error {
  readonly needs: "browser"
  constructor(needs: "browser") {
    super(t`Your browser can get this PDF.`)
    this.name = "PublisherNeedsUser"
    this.needs = needs
  }
}
