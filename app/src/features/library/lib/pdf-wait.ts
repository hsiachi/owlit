import { t } from "@lingui/core/macro"
import type { ExtensionWait, Paper, PdfEnded, PdfTry } from "@owlit/protocol"

// Where a paper without its PDF stands, read off what core keeps (paper.pdfState) and never worked out
// again: its state, the ending of the try that says why, and where the extension has it.
// Every place goes by this one reading, so the row, the No PDF groups, the card, Home and the rail agree.
// - finding, offline: owlit is looking, or waits for the network
// - for-sign-in, for-check, for-permission: still finding; the extension in the user's browser waits at
//   the paper's site for one sign-in, one passed check, or being allowed to read it (a line per site,
//   ExtensionView.waits, covers every such paper)
// - not-found, no-access, not-offered, not-there, nothing-came: no PDF, for that reason
// - for-browser: a page stopped owlit with a check or a sign-in; the user's browser may get past it
export type PdfWait =
  | "finding"
  | "offline"
  | "for-sign-in"
  | "for-check"
  | "for-permission"
  | "not-found"
  | "no-access"
  | "not-offered"
  | "not-there"
  | "for-browser"
  | "nothing-came"

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
  "no-permission": "for-permission",
}

const BY_WAIT: Record<ExtensionWait["kind"], PdfWait> = { "sign-in": "for-sign-in", check: "for-check", permission: "for-permission" }
const WAITED: Partial<Record<PdfEnded, ExtensionWait["kind"]>> = { "sign-in": "sign-in", check: "check", "no-permission": "permission" }

// What the extension's try waited for, when it stopped where only the user gets through
export const waitedFor = (t: PdfTry | undefined) => (t?.by === "extension" ? WAITED[t.ended] : undefined)

export function pdfWait(p: Pick<Paper, "pdf" | "pdfState">): PdfWait | undefined {
  if (p.pdf) return undefined
  const s = p.pdfState
  if (!s || s.state === "finding") {
    // The extension's queue says where it is now (fetching again once the user got through); its last
    // try says so after a restart, before the queue has it again
    const waits = s?.extension ? s.extension.waits : waitedFor(s?.reason)
    if (waits) return BY_WAIT[waits]
    return s?.reason?.ended === "offline" ? "offline" : "finding"
  }
  return BY_ENDED[s.reason?.ended ?? "no-copy"]
}

// Whether a site the extension waits at is something only the user can do now, in what they started:
// Home's Waiting on you, the rail's dot, the amber line atop the Library. It is grey until the user asked
// for one of its papers (Find PDF, Look again). No paper waits on the user by itself: its row says
// Finding, and the site's line covers it.
export const waitsOnYou = (wait: ExtensionWait) => wait.askedFor

// The one name of each state, said the same in the row, the No PDF group and the card's title
export function pdfWord(w: PdfWait | undefined): string | undefined {
  switch (w) {
    case undefined:
      return undefined
    case "finding":
    case "offline":
    case "for-sign-in":
    case "for-check":
    case "for-permission":
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
  }
}
