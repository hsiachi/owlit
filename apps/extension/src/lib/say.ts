import { plural, t } from "@lingui/core/macro"
import type { CardView, Outcome } from "./messages.ts"

// What the extension says about a click or a site, in one sentence and at most one action, and where it
// says it: the card the content script draws in the page (content/card.ts), or the popup where no card can
// be drawn. Pure but for the catalogs, so a test reads every sentence.

// Badge marks: a Library paper without its PDF (warning), a PDF owlit took (owlit's green), the click at
// work (muted); DESIGN.md's tokens in sRGB, since a badge takes no oklch
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
    case "has-pdf":
    case "no-paper":
    case "unknown-pdf":
      return { text: "", color: WAITING }
    default:
      return undefined
  }
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

export function cardOf(outcome: Outcome): CardView {
  const close = t({ message: "Close", comment: "the owlit card in a web page: its close button, for screen readers" })
  const open = (paperId: string) => ({ label: t({ message: "Open", comment: "the owlit card in a web page: shows the paper in owlit" }), do: { kind: "open-paper" as const, paperId } })
  const allow = (host: string) => ({ label: t({ message: "Allow", comment: "the owlit card in a web page: let the owlit extension read this site" }), do: { kind: "allow" as const, host } })
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
          return stays(added, { detail: t`Let owlit read ${host} to get its PDF with your access.`, action: allow(host) })
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
    case "none-named":
      return fades(t`In your Library, without its PDF`, { detail: t`This page names none. owlit keeps looking.`, action: open(outcome.paperId) })
    case "no-paper": {
      const listing = outcome.listing
      if (listing) return fades(t`${listing} lists papers`, { detail: t`Open one, then press the button on its page.` })
      return fades(t`This page doesn't show a paper`)
    }
    case "unknown-pdf":
      return fades(t`owlit can't tell which paper this PDF is`, { detail: t`Add the paper from its page.` })
    case "needs-site": {
      const host = outcome.host
      return stays(t`Let owlit read ${host}`, { detail: t`It gets the PDF there with your access.`, action: allow(host) })
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
    case "wait": {
      const { host, papers } = outcome.wait
      if (outcome.wait.kind === "permission")
        return stays(plural(papers, { one: `# paper waits for owlit to read ${host}`, other: `# papers wait for owlit to read ${host}` }), { action: allow(host), key: `wait:${host}` })
      const text =
        outcome.wait.kind === "check"
          ? plural(papers, { one: "# paper waits for you to pass the check here", other: "# papers wait for you to pass the check here" })
          : plural(papers, { one: "# paper waits for your sign-in here", other: "# papers wait for your sign-in here" })
      return stays(text, { detail: t`Going on once you're through.`, key: `wait:${host}` })
    }
    case "through": {
      const papers = outcome.papers
      return fades(t`You're through`, { detail: plural(papers, { one: "owlit goes on with # paper.", other: "owlit goes on with # papers." }) })
    }
  }
  return fades("")
}
