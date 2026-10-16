import type { Paper } from "../types"

// Where a paper without its PDF stands, the one reading of paper.noPdf that every place (its card, its
// row, the Needs you filter, the Library's line, Home and the rail) goes by. In the order the card
// tells them apart:
// - offered: a file arrived in Downloads and owlit isn't sure it is this paper's; the user says
// - run-stopped: the paper a run in the user's browser stopped on for them (a sign-in, a check)
// - page: its article page is open in their browser for them to save the PDF from
// - queued, opened: a run has it, waiting its turn or opened there with the file to come
// - missed: their browser was sent for it and nothing came
// - no-access: their browser reached the publisher (or the library's proxy) and was turned away
// - missing: the publisher has no PDF at the address it went to
// - browser: owlit couldn't get it alone and their browser is the way; not sent there yet
// - not-found: owlit looked and found no copy
// - not-yet: owlit hasn't looked
// undefined once it has its PDF. A page or a stopped run counts whatever sent the paper there: a
// publisher's hold, or the user picking their browser on a not-found card.
export type PdfWait = "offered" | "run-stopped" | "page" | "queued" | "opened" | "missed" | "no-access" | "missing" | "browser" | "not-found" | "not-yet"

export function pdfWait(p: Paper): PdfWait | undefined {
  if (p.pdf) return undefined
  const n = p.noPdf
  if (!n) return "not-yet"
  if (n.offered) return "offered"
  switch (n.fromBrowser?.state) {
    case "waiting":
      return "run-stopped"
    case "page":
    case "queued":
    case "opened":
      return n.fromBrowser.state
  }
  // Turned away outranks nothing coming: the publisher said why
  if (n.noAccess) return n.noAccess.missing ? "missing" : "no-access"
  if (n.fromBrowser?.state === "missed") return "missed"
  return n.needs ? "browser" : "not-found"
}

// Something only the user can do now: the rail's dot, Home's rows and the row's Needs you. Once their
// browser was turned away or nothing came of it, there is nothing for them to do now, so it leaves the
// amber rung and its card's Try again is all that is left. A run at work needs nothing of them.
export const waitsOnYou = (w: PdfWait | undefined) => w === "offered" || w === "run-stopped" || w === "page" || w === "browser"

// The Library's Needs you: what waits on the user, and a run's papers while it goes on, so they can be
// watched leaving the list
export const needsYou = (p: Paper) => {
  const w = pdfWait(p)
  return waitsOnYou(w) || w === "queued" || w === "opened"
}
