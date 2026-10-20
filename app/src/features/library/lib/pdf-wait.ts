import { t } from "@lingui/core/macro"
import { pdfWait, type ExtensionWait, type Paper, type PdfWait } from "@owlit/protocol"

// Where a paper without its PDF stands: one reading, in @owlit/protocol, shared with the agent's words
export { pdfWait, waitedFor, type PdfWait } from "@owlit/protocol"

// Whether a site the extension waits at is something only the user can do now, in what they started:
// Home's Waiting on you, the rail's dot, the amber line atop the Library. It is grey until the user asked
// for one of its papers (Look again). No paper waits on the user by itself: its row says
// Finding, and the site's line covers it.
export const waitsOnYou = (wait: ExtensionWait) => wait.askedFor

// The one name of each state, said the same in the row, the No PDF group and the card's title
export function pdfWord(w: PdfWait | undefined): string | undefined {
  switch (w) {
    // A thread's paper nobody has opened: having no PDF yet is no state worth a word
    case undefined:
    case "unsought":
      return undefined
    case "finding":
    case "offline":
    case "for-sign-in":
    case "for-check":
    case "for-permission":
      return t({ message: "Finding", comment: "a paper whose PDF owlit is looking for" })
    case "not-found":
      return t({ message: "No PDF found", comment: "owlit looked for the paper's PDF and found no copy" })
    case "no-access":
    case "not-offered":
      return t({ message: "No access", comment: "the user's library doesn't give them this paper" })
    case "not-there":
      return t({ message: "No PDF there", comment: "the publisher has no PDF of the paper" })
  }
}

// The paper had its PDF and the file was deleted outside owlit: nothing looks for it until the daily look
export const pdfGone = (p: Pick<Paper, "pdfState">) => p.pdfState?.reason?.ended === "pdf" && !p.pdfState.extension

// The title of a paper without its PDF, as its No PDF card and the paper card say it: the state's one
// name (pdfWord) with the site it is about. The site is where the extension has it, else the page the
// try that says why ended on.
export function noPdfTitle(p: Pick<Paper, "pdf" | "pdfState">): string {
  const wait = pdfWait(p) ?? "finding"
  const s = p.pdfState
  const site = s?.extension?.host ?? s?.reason?.host?.replace(/^www\./, "")
  switch (wait) {
    case "unsought":
      return t`No PDF yet`
    case "finding":
      return !s?.extension && pdfGone(p) ? t`The PDF is gone` : t`Finding a PDF…`
    case "offline":
      return t`Waiting for the network`
    case "for-sign-in":
      // The library's sign-in only through its proxy; a publisher's own login page is that site's
      if (s?.extension?.proxied || !site) return t`Waits for your library sign-in`
      return t`Waits for a sign-in at ${site}`
    case "for-check":
      return site ? t`Waits for a check at ${site}` : t`Waits for a check`
    case "for-permission":
      return site ? t`Waits for the extension to be allowed on ${site}` : t`Waits for the extension to be allowed`
    case "not-found":
      return t`No PDF found`
    case "no-access":
      return t`No access through your library`
    case "not-offered":
      return t`Your library doesn't offer this paper`
    case "not-there":
      return site ? t`${site} has no PDF of this paper` : t`The publisher has no PDF of this paper`
  }
}
