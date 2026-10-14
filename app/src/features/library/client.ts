import { t } from "@lingui/core/macro"
import type { Paper, ResolvedPaper } from "./types"

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
  // The publisher's page shown to the user (Check now), in the room window.owlit.setPublisherView was
  // given; resolves with the paper once they're through or have cancelled. Desktop only.
  checkPublisher?(paper: Paper): Promise<Paper>
  // The paper in the user's own browser; a PDF of it they save to Downloads soon after becomes its file.
  // Resolves with the paper (noPdf.inBrowser). Desktop only.
  openInBrowser?(paper: Paper): Promise<Paper>
  // The user's answer about a downloaded PDF owlit offered (noPdf.inBrowser.offered)
  takeDownload?(paper: Paper, take: boolean): Promise<Paper>
}

type Needs = NonNullable<NonNullable<Paper["noPdf"]>["needs"]>

// fetchPdf found no PDF because the publisher wants the user first, or isn't letting owlit's browser in,
// or lets only the user's own browser in
export class PublisherNeedsUser extends Error {
  readonly needs: Needs
  constructor(needs: Needs) {
    super(
      needs === "sign-in"
        ? t`The publisher wants you to sign in.`
        : needs === "blocked"
          ? t`The publisher isn't letting owlit in.`
          : needs === "browser"
            ? t`ACM gives this PDF to your browser.`
            : t`The publisher wants a quick check.`,
    )
    this.name = "PublisherNeedsUser"
    this.needs = needs
  }
}
