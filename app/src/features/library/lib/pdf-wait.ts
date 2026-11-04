import { t } from "@lingui/core/macro"
import { pdfWait, type ExtensionWait, type Paper, type PdfWait } from "@owlit/protocol"
import { clock, MINUTE } from "@/lib/time"

// Where a paper without its PDF stands: one reading, in @owlit/protocol, shared with the agent's words
export { pdfWait, waitedFor, type PdfWait } from "@owlit/protocol"

// Whether a site the extension waits at is something only the user can do now, in what they started:
// Home's Waiting on you, the rail's dot, the amber mark atop the Library. It is grey until the user asked
// for one of its papers (Look again, Get PDFs). No paper waits on the user by itself: the site's row
// covers it.
export const waitsOnYou = (wait: ExtensionWait) => wait.askedFor

// The one name of each state, said the same in the row, the No PDF group and the card: a few words, so it
// fits the list's column, in the sense of the Library's PDF block's rows
export function pdfWord(w: PdfWait | undefined): string | undefined {
  switch (w) {
    case undefined:
      return undefined
    case "finding":
    case "offline":
      return t({ message: "Finding", comment: "a paper whose PDF owlit is looking for" })
    case "for-sign-in":
      return t({ message: "Needs sign-in", comment: "the PDF waits for the user to sign in (to their library, or at the publisher) in their browser" })
    case "for-check":
      return t({ message: "Needs verification", comment: "the PDF waits for the user to pass the site's 'verify you are human' check in their browser" })
    case "for-permission":
      return t({ message: "Needs permission", comment: "the PDF waits for the user to allow the owlit browser extension on the publisher's site" })
    case "blocked":
      return t({ message: "Blocked", comment: "the publisher's site turned the user's browser away" })
    case "manual":
      return t({ message: "Needs manual download", comment: "owlit couldn't open the publisher's page in the user's browser; the user downloads the PDF there by hand" })
    case "skipped":
      return t({ message: "You found none", comment: "the user looked at the publisher's page in their browser and found no PDF there (they pressed Skip)" })
    case "stopped":
      return t({ message: "Stopped", comment: "the user stopped getting the paper's PDF (Stop on Get PDFs)" })
    case "not-found":
      return t({ message: "No PDF found", comment: "owlit looked for the paper's PDF and found no copy" })
    case "no-access":
    case "not-offered":
      return t({ message: "No access", comment: "the user's library doesn't give them this paper" })
    case "not-there":
      return t({ message: "No PDF there", comment: "the publisher has no PDF of the paper" })
  }
}

// What a list row says of a paper without its PDF: its state's word, and Waiting while it is in line at
// the extension, which owlit's own looking (Finding) isn't, with about how long through the library's
// proxy, which takes one paper at a time for every publisher; Can't reach site while the site its last
// fetch went to didn't answer, until owlit tries it again; Waiting for Dia while the browser the
// extension is in (away, useBrowserAway) isn't open
export function pdfColumnWord(p: Pick<Paper, "pdf" | "pdfState">, away?: string): string | undefined {
  const wait = pdfWait(p)
  const at = p.pdfState?.extension
  if (away && withExtension(p)) return t({ message: `Waiting for ${away}`, comment: "the paper is with the owlit extension in this browser (e.g. Dia), which isn't open" })
  if (unreachable(p) && (wait === "finding" || wait === "offline")) return t({ message: "Can't reach site", comment: "the publisher's site (or the library's proxy) didn't answer the user's browser; owlit tries it again later by itself" })
  const turn = minutesInLine(p)
  if (wait === "finding" && turn !== undefined) return t({ message: `In line · about ${turn} min`, comment: "a paper waiting its turn at the library's proxy, which the owlit browser extension goes through one paper at a time; turn: minutes until its turn" })
  if (wait === "finding" && at && !at.fetching) return t({ message: "Waiting", comment: "a paper in line for the owlit browser extension, which fetches one paper at a time per site" })
  return pdfWord(wait)
}

// The minutes until a paper in line through the library's proxy gets its turn, at least one; undefined
// for any other paper
export function minutesInLine(p: Pick<Paper, "pdf" | "pdfState">): number | undefined {
  const at = p.pdfState?.extension
  if (p.pdf || !at || at.wait || at.fetching || at.unreachable || at.turnAt === undefined) return undefined
  return Math.max(1, Math.ceil((at.turnAt - Date.now()) / MINUTE))
}

// The extension has the paper in line or out for a try, under no wait
export const withExtension = (p: Pick<Paper, "pdf" | "pdfState">) => !p.pdf && !!p.pdfState?.extension && !p.pdfState.extension.wait

// The site that didn't answer the paper's last fetch through the extension, and when owlit tries it
// again: while the extension has the paper in line, held back for it
export const unreachable = (p: Pick<Paper, "pdfState">) => (p.pdfState?.extension && !p.pdfState.extension.wait ? p.pdfState.extension.unreachable : undefined)

// The paper had its PDF and the file was deleted outside owlit: nothing looks for it until the daily look
export const pdfGone = (p: Pick<Paper, "pdfState">) => p.pdfState?.reason?.ended === "pdf" && !p.pdfState.extension

// The title of a paper without its PDF, as its No PDF card and the paper card say it: the state in the
// sentence the Library's PDF block and Home say it in, with the site it is about. The site is where the
// wait it is under has the user act, else where the extension has it, else the page the try that says
// why ended on. wait: the paper's wait (by PdfState.extension.wait); a sign-in at the library proxy's own
// is the library's. away: the extension's browser, while it isn't open (useBrowserAway).
export function noPdfTitle(p: Pick<Paper, "pdf" | "pdfState">, wait?: Pick<ExtensionWait, "at" | "proxied">, away?: string): string {
  const state = pdfWait(p) ?? "finding"
  const s = p.pdfState
  const site = wait?.at ?? s?.extension?.at ?? s?.reason?.host?.replace(/^www\./, "")
  if (away && withExtension(p)) return t({ message: `Waiting for ${away} to open`, comment: "the paper is with the owlit extension in this browser (e.g. Dia), which isn't open" })
  const off = unreachable(p)
  if (off && (state === "finding" || state === "offline")) {
    const { at } = off
    const time = clock(off.until)
    return t({ message: `Can't reach ${at} right now · trying again at ${time}`, comment: "the site didn't answer the user's browser; time: when owlit tries it again, e.g. 14:05" })
  }
  const turn = minutesInLine(p)
  if (turn !== undefined && state === "finding") return t({ message: `In line through your library · about ${turn} min`, comment: "the paper waits its turn at the library's proxy, which the owlit browser extension goes through one paper at a time; turn: minutes until its turn" })
  switch (state) {
    case "finding":
      return !s?.extension && pdfGone(p) ? t`The PDF is gone` : t`Finding a PDF…`
    case "offline":
      return t`Waiting for the network`
    case "for-sign-in":
      // The library's sign-in only at its proxy; a publisher's own login page is that site's
      if (wait?.proxied || !site) return t`Needs you to sign in to your library`
      return t`Needs you to sign in at ${site}`
    case "for-check":
      return site ? t`Needs you to verify you're human on ${site}` : t`Needs you to verify you're human`
    case "blocked":
      return site ? t`${site} blocks your browser` : t`The publisher's site blocks your browser`
    case "for-permission":
      return site ? t`Needs your permission for ${site}` : t`Needs your permission for the publisher's site`
    case "manual":
      return t`Needs you to download it`
    case "skipped":
      return t`You found no PDF on its page`
    case "stopped":
      return t`You stopped getting its PDF`
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
