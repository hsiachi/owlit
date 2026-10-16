import { t } from "@lingui/core/macro"
import type { Paper, PdfEnded, PdfState } from "@owlit/protocol"

// Where a paper without its PDF stands, read off what core keeps (paper.pdfState) and never worked out
// again: its state, the ending of the try that says why, and a run in the user's browser that has it.
// Every place goes by this one reading, so the row, the No PDF groups, the card, Home and the rail agree.
// - finding, offline: owlit is looking, or waits for the network
// - not-found, no-access, not-offered, not-there, nothing-came: no PDF, for that reason
// - for-browser: a page stopped owlit with a check or a sign-in; the user's browser may get past it
// - queued, opened: a run in the user's browser has it, waiting its turn or opened there
// - page, run-stopped, offered: that run waits on the user (an article page to save from, a sign-in or
//   a check in their browser, a downloaded file to confirm)
export type PdfWait =
  | "finding"
  | "offline"
  | "not-found"
  | "no-access"
  | "not-offered"
  | "not-there"
  | "for-browser"
  | "nothing-came"
  | "queued"
  | "opened"
  | "page"
  | "run-stopped"
  | "offered"

const BY_ENDED: Record<PdfEnded, PdfWait> = {
  "no-copy": "not-found",
  "no-access": "no-access",
  "not-offered": "not-offered",
  "not-there": "not-there",
  check: "for-browser",
  "sign-in": "for-browser",
  "nothing-came": "nothing-came",
  // Not reasons for having no PDF; core never gives them as one
  pdf: "not-found",
  offline: "offline",
}

const BY_RUN: Record<NonNullable<PdfState["run"]>["state"], PdfWait> = { queued: "queued", opened: "opened", page: "page", waiting: "run-stopped" }

export function pdfWait(p: Pick<Paper, "pdf" | "pdfState">): PdfWait | undefined {
  if (p.pdf) return undefined
  const s = p.pdfState
  if (s?.run) return s.run.offered ? "offered" : BY_RUN[s.run.state]
  if (!s || s.state === "finding") return s?.reason?.ended === "offline" ? "offline" : "finding"
  return BY_ENDED[s.reason?.ended ?? "no-copy"]
}

// Something only the user can do now, in the run they started: Home's rows, the rail's dot, the row's
// amber word. A page that stopped owlit is the user's browser's chance, not their move, so it isn't.
export const waitsOnYou = (w: PdfWait | undefined) => w === "page" || w === "run-stopped" || w === "offered"

// The one name of each state, said the same in the row, the No PDF group and the card's title
export function pdfWord(w: PdfWait | undefined): string | undefined {
  switch (w) {
    case undefined:
      return undefined
    case "finding":
    case "offline":
      return t({ message: "Finding", comment: "a paper whose PDF owlit is looking for" })
    case "not-found":
      return t({ message: "Not found", comment: "owlit looked for the paper's PDF and found no copy" })
    case "no-access":
    case "not-offered":
      return t({ message: "No access", comment: "the user's library doesn't give them this paper" })
    case "not-there":
      return t({ message: "No PDF there", comment: "the publisher has no PDF of the paper" })
    case "for-browser":
      return t({ message: "For your browser", comment: "a paper whose publisher stopped owlit with a check or a sign-in; the user's own browser may get it" })
    case "nothing-came":
      return t({ message: "Nothing came", comment: "the user's browser was sent for the PDF and none arrived" })
    case "queued":
    case "opened":
      return t({ message: "In your browser…", comment: "a paper being got from the user's browser now" })
    case "page":
    case "run-stopped":
    case "offered":
      return t({ message: "Needs you", comment: "a paper being got from the user's browser that waits on them" })
  }
}
