import { plural, t } from "@lingui/core/macro"
import type { WalkStep } from "@owlit/protocol"
import type { CardView, Outcome, PopupState, SiteWait } from "./messages.ts"

// What the extension says about a click or a site, in one sentence and at most one action, and where it
// says it: the card the content script draws in the page (content/card.ts), or the popup where no card can
// be drawn. Pure but for the catalogs, so a test reads every sentence.

// Badge marks: a Library paper without its PDF (warning), a PDF owlit took (owlit's green), the click at
// work (muted); DESIGN.md's tokens in sRGB, since a badge takes no oklch. A Library paper's PDF the user
// opened that owlit couldn't save is "!" in the warning colour.
export const WAITING = "#b6873c"
export const TAKEN = "#2f7a52"
export const WORKING = "#77736c"

// The toolbar button's mark for a tab once a click's work ended; undefined leaves the mark as it was
export function badgeOf(outcome: Outcome): { text: string; color: string } | undefined {
  switch (outcome.kind) {
    case "added":
      return outcome.pdf === "saved" ? { text: "✓", color: TAKEN } : { text: "•", color: WAITING }
    case "saved":
    case "taken":
      return { text: "✓", color: TAKEN }
    case "no-pdf":
    case "not-this-paper":
    case "none-named":
    case "needs-site":
      return { text: "•", color: WAITING }
    case "not-saved":
      return { text: "!", color: WAITING }
    case "has-pdf":
    case "no-paper":
    case "unknown-pdf":
      return { text: "", color: WAITING }
    default:
      return undefined
  }
}

// The Library paper a click's work saved the PDF of, if it did
export function savedPaper(outcome: Outcome): string | undefined {
  if (outcome.kind === "saved" || outcome.kind === "taken" || (outcome.kind === "added" && outcome.pdf === "saved")) return outcome.paperId
  return undefined
}

// Where an outcome is said, in the order tried. Connecting and the workspace are decided in the popup,
// which the browser anchors to the button they belong to; everything else is said in the page, where the
// person is looking. Either one stands in when the other can't be shown: the browser's own pages and a PDF
// viewer that runs no extension script take no card, and a browser may refuse to open a popup that the
// click didn't open itself (Firefox, once the click's work has awaited anything).
export function placesFor(outcome: Outcome): ("popup" | "card")[] {
  const decided = outcome.kind === "unpaired" || outcome.kind === "pairing" || outcome.kind === "elsewhere" || outcome.kind === "no-workspace"
  return decided ? ["popup", "card"] : ["card", "popup"]
}

// Says an outcome in the first place that can show it; undefined when none could. show draws the card or
// opens the popup and answers whether it did.
export async function sayIn(outcome: Outcome, show: (place: "popup" | "card") => Promise<boolean>): Promise<"popup" | "card" | undefined> {
  for (const place of placesFor(outcome)) if (await show(place)) return place
  return undefined
}

export function cardOf(outcome: Outcome): CardView {
  const close = t({ message: "Close", comment: "the owlit card in a web page: its close button, for screen readers" })
  const open = (paperId: string) => ({ label: t({ message: "Open", comment: "the owlit card in a web page: shows the paper in owlit" }), do: { kind: "open-paper" as const, paperId } })
  const allow = (host: string) => ({ label: t({ message: "Allow", comment: "the owlit card in a web page: let the owlit extension read this site" }), do: { kind: "allow" as const, host } })
  const couldnt = t`Couldn't save this PDF`
  const openOwlit = { label: t({ message: "Open owlit", comment: "the owlit card or popup: bring the owlit app to the front" }), do: { kind: "open-owlit" as const } }
  const keepsLooking = t`owlit keeps looking.`
  const fades = (text: string, more: Partial<CardView> = {}): CardView => ({ text, stays: false, close, ...more })
  const stays = (text: string, more: Partial<CardView> = {}): CardView => ({ text, stays: true, close, ...more })
  switch (outcome.kind) {
    case "added": {
      const host = outcome.host ?? ""
      const added = t`Added to owlit`
      switch (outcome.pdf) {
        case "saved":
          return fades(t`Added to owlit with its PDF`, { action: open(outcome.paperId) })
        case "none-named":
          return fades(added, { detail: t`The page names no PDF. owlit looks for one.`, action: open(outcome.paperId) })
        case "not-a-pdf":
          return fades(added, { detail: t`${host} gave no PDF. owlit keeps looking.`, action: open(outcome.paperId) })
        case "not-this-paper":
          return fades(added, { detail: t`The PDF on this page is another paper's. owlit keeps looking.`, action: open(outcome.paperId) })
        case "not-allowed":
          return stays(added, { detail: t`owlit doesn't have permission for ${host} yet. Allow it, and owlit saves the PDF.`, action: allow(host) })
      }
      break
    }
    case "saved":
      return fades(t`PDF saved to owlit`, { action: open(outcome.paperId) })
    case "taken":
      return fades(t`PDF saved to owlit`, { detail: outcome.title, action: open(outcome.paperId) })
    case "no-pdf": {
      const host = outcome.host
      return fades(t`${host} gave no PDF`, { detail: keepsLooking })
    }
    case "not-this-paper":
      return fades(t`This PDF is another paper's`, { detail: keepsLooking })
    case "has-pdf":
      return fades(t`In your Library, with its PDF`, { action: open(outcome.paperId) })
    // The page names no PDF, but it usually has a button that opens one, and owlit takes a PDF the user opens
    case "none-named":
      return fades(t`owlit needs this PDF`, { detail: t`Click the PDF button on this page. owlit saves the PDF when it opens.` })
    case "no-paper": {
      const listing = outcome.listing
      if (listing) return fades(t`${listing} lists papers`, { detail: t`Open one, then press the button on its page.` })
      return fades(t`This page doesn't show a paper`)
    }
    case "unknown-pdf":
      return fades(t`owlit can't tell which paper this PDF is`, { detail: t`Add the paper from its page.` })
    case "needs-site": {
      const host = outcome.host
      return stays(t`owlit needs your permission for ${host}`, { detail: t`Allow it, and owlit gets the PDF there with your access.`, action: allow(host) })
    }
    case "not-saved": {
      if (outcome.why === "off") return stays(couldnt, { detail: t`Saving PDFs you open is turned off.`, action: { label: t({ message: "Turn on", comment: "button: turns on taking the PDFs the user opens for papers in their Library" }), do: { kind: "take-pdfs" } } })
      const host = outcome.host
      return stays(couldnt, { detail: t`owlit doesn't have permission for ${host} yet. Allow it, and owlit saves this PDF.`, action: allow(host) })
    }
    case "no-workspace":
      return stays(t`owlit has no workspace open`, { detail: t`Open one in owlit, then press the button again.`, action: openOwlit })
    // Nothing in the browser can start an app that registers no address of its own, so this one has no button
    case "offline":
      return stays(t`owlit isn't open`, { detail: t`Open it, then press the button again.` })
    case "unpaired":
      return stays(t`This browser isn't connected to owlit`, { action: { label: t`Connect`, do: { kind: "connect" } } })
    case "pairing":
      return stays(t`Allow it in owlit…`)
    case "connected":
      return fades(t`Connected to owlit`)
    case "elsewhere": {
      const name = outcome.name
      return stays(t`${name} answers here instead of your owlit`, { detail: t`Quit it, and this browser goes on with your owlit.` })
    }
    // owlit's own sentence, as a headline
    case "failed":
      return stays(outcome.message.replace(/\.$/, ""), { detail: t`Press owlit's button to try again.` })
    // The app's sentences for the same waits (app/src/features/extension/waits.ts, waitWords), written the
    // same way so they are one message in the catalogs: change them together
    case "wait": {
      const { host, papers: n } = outcome.wait
      const key = `wait:${host}`
      switch (outcome.wait.kind) {
        case "permission":
          return stays(plural(n, { one: `# paper needs your permission for ${host}`, other: `# papers need your permission for ${host}` }), { action: allow(host), key })
        case "blocked":
          return stays(t`${host} blocks your browser`, {
            detail: plural(n, { one: "Another network usually gets past it; owlit goes on with # paper then.", other: "Another network usually gets past it; owlit goes on with # papers then." }),
            key,
          })
        case "check":
          return stays(plural(n, { one: `# paper needs you to verify you're human on ${host}`, other: `# papers need you to verify you're human on ${host}` }), {
            detail: t`Verify on this page; owlit goes on by itself once you have.`,
            key,
          })
        case "sign-in": {
          const signedIn = t`owlit goes on by itself once you're signed in.`
          if (outcome.wait.proxied) {
            const library = t({ message: "your library", comment: "in: Need you to sign in to your library" })
            return stays(plural(n, { one: `# paper needs you to sign in to ${library}`, other: `# papers need you to sign in to ${library}` }), { detail: signedIn, key })
          }
          return stays(plural(n, { one: `# paper needs you to sign in at ${host}`, other: `# papers need you to sign in at ${host}` }), { detail: signedIn, key })
        }
      }
      break
    }
    case "through": {
      const papers = outcome.papers
      return fades(t`You're through`, { detail: plural(papers, { one: "owlit goes on with # paper.", other: "owlit goes on with # papers." }) })
    }
  }
  return fades("")
}

// The card in the tab of the walk through the manual downloads (owlit's WalkStep): which paper of how
// many, the one thing to do on its page, and the way on (Skip when there is no PDF, else the next paper);
// how many are saved so far, quietly, so a PDF saved on the page before is seen to have come. It stays
// until the walk moves on. At the end, how it went.
export function walkCard(step: WalkStep): CardView {
  const close = t({ message: "Close", comment: "the owlit card in a web page: its close button, for screen readers" })
  if (step.kind === "done") {
    const { saved, total } = step
    const text = saved === total ? plural(total, { one: "Done: saved the PDF", other: "Done: saved all # PDFs" }) : t`Done: saved ${saved} of ${total}`
    return { text, stays: true, close, action: { label: t({ message: "Open owlit", comment: "the owlit card or popup: bring the owlit app to the front" }), do: { kind: "open-owlit" } } }
  }
  const { n, total, saved, paperId } = step
  const last = n === total
  return {
    text: total === 1 ? t`One paper to download manually` : t`Paper ${n} of ${total} to download manually`,
    detail: t`Click the PDF button on this page; owlit saves it. No PDF here? Skip it.`,
    stays: true,
    close,
    steps: [
      { label: t({ message: "Skip", comment: "the owlit card in a web page: the user found no PDF for this paper on its page; owlit notes it and goes on" }), do: { kind: "walk", paperId, skip: true } },
      last
        ? { label: t({ message: "Finish", comment: "the owlit card in a web page: ends the walk through the papers to download manually, on its last paper" }), do: { kind: "walk", paperId, skip: false } }
        : { label: t({ message: "Next paper", comment: "the owlit card in a web page: goes on to the next paper to download manually, noting nothing about this one" }), do: { kind: "walk", paperId, skip: false } },
    ],
    ...(saved > 0 ? { note: t({ message: `${saved} saved`, comment: "the owlit card in a web page: how many of the papers to download manually have their PDF so far" }) } : {}),
  }
}

// The popup's line for this tab's site, below the page's paper: owlit going on there once the person got
// through, else what the site waits for. Said beside the paper's own words when it is one owlit is
// getting: going on there is what moves it next.
export function siteLine(state: Pick<PopupState, "wait" | "going">): { text: string; detail?: string } | undefined {
  if (state.going) {
    const { done, total } = state.going
    return { text: t({ message: `Going on · ${done} of ${total}`, comment: "popup: owlit fetches the papers that waited at this site; how many came so far" }) }
  }
  if (!state.wait) return undefined
  const { text, detail } = cardOf({ kind: "wait", wait: state.wait })
  return detail ? { text, detail } : { text }
}

// The popup's quiet line under a Library paper owlit is getting through the browser: how many it is
// getting, and what holds up the most of them
export function gettingLine(papers: number, wait?: SiteWait): string {
  const getting = plural(papers, { one: "The one paper owlit is getting", other: "One of the # papers owlit is getting" })
  const held = wait && heldBy(wait)
  return held ? `${getting} · ${held}` : getting
}

function heldBy({ kind, host, papers: n, proxied }: SiteWait): string | undefined {
  switch (kind) {
    case "sign-in": {
      if (!proxied) return plural(n, { one: `# still needs you to sign in at ${host}`, other: `# still need you to sign in at ${host}` })
      const library = t({ message: "your library", comment: "in: Need you to sign in to your library" })
      return plural(n, { one: `# still needs you to sign in to ${library}`, other: `# still need you to sign in to ${library}` })
    }
    case "check":
      return plural(n, { one: `# still needs you to verify you're human on ${host}`, other: `# still need you to verify you're human on ${host}` })
    case "permission":
      return plural(n, { one: `# still needs your permission for ${host}`, other: `# still need your permission for ${host}` })
    // Nothing the user does here gets past a block
    case "blocked":
      return undefined
  }
}
