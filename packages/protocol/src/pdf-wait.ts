import type { ExtensionWait } from "./extension.ts"
import type { Paper, PdfEnded, PdfTry } from "./library.ts"

// Where a paper without its PDF stands, read off what core keeps (paper.pdfState) and never worked out
// again: its state, the ending of the try that says why, and where the extension has it. The window
// (the row, the No PDF groups, the card, Home, the rail) and the agent's words (owlit-mcp's pdfFact) go
// by this one reading, so they agree.
// - unsought: nobody has looked for it yet (a thread's paper, until it is opened or read)
// - finding, offline: owlit is looking, or waits for the network
// - for-sign-in, for-check, for-permission: still finding; the extension in the user's browser waits at
//   the paper's site for one sign-in, one passed check, or being allowed to read it (a line per site,
//   ExtensionView.waits, covers every such paper)
// - not-found, no-access, not-offered, not-there: no PDF, for that reason. A check or a sign-in that
//   stopped owlit itself (only older records have one) is not-found: it waits on nobody
export type PdfWait = "unsought" | "finding" | "offline" | "for-sign-in" | "for-check" | "for-permission" | "not-found" | "no-access" | "not-offered" | "not-there"

const BY_ENDED: Record<PdfEnded, PdfWait> = {
  "no-copy": "not-found",
  "no-access": "no-access",
  "not-offered": "not-offered",
  "not-there": "not-there",
  check: "not-found",
  "sign-in": "not-found",
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
  if (s?.unsought) return "unsought"
  if (!s || s.state === "finding") {
    // The extension's queue says where it is now (fetching again once the user got through); its last
    // try says so after a restart, before the queue has it again
    const waits = s?.extension ? s.extension.waits : waitedFor(s?.reason)
    if (waits) return BY_WAIT[waits]
    return s?.reason?.ended === "offline" ? "offline" : "finding"
  }
  return BY_ENDED[s.reason?.ended ?? "no-copy"]
}
