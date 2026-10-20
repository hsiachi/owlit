import type { ExtensionPaper, ExtensionWait } from "@owlit/protocol"
import type { PagePaper } from "./page.ts"
import { ext } from "./browser.ts"

// What the popup, the Allow page and the content script say to the background, and what it answers

// unpaired: owlit is running, this browser isn't connected; pairing: owlit's window asks the user;
// offline: owlit isn't running; elsewhere: another owlit has the port (name: what it calls itself);
// connected: paired and running
export type Connection =
  | { state: "unpaired"; problem?: "refused" | "expired" | "no-window" }
  | { state: "pairing" }
  | { state: "offline"; paired: boolean }
  | { state: "elsewhere"; name: string }
  | { state: "connected"; workspace: string | null }

export interface PageState {
  url: string
  host: string
  // The tab shows a PDF (the browser's PDF viewer)
  pdfTab: boolean
  // What the page says about its paper; undefined when it names none
  paper?: PagePaper
  // The page's paper in the open workspace's Library; null when it isn't there, undefined when owlit
  // wasn't asked (not connected, no paper)
  inLibrary?: ExtensionPaper | null
}

// A site that waits on the person, as the popup and the card say it
export interface SiteWait {
  kind: ExtensionWait["kind"]
  host: string
  papers: number
}

// owlit going on at a site once the person got through there: how many of the papers that waited came
export interface GoingOn {
  host: string
  done: number
  total: number
}

export interface PopupState {
  connection: Connection
  page: PageState | null
  takePdfs: boolean
  // The extension may read every publisher site the manifest lists (permissions.ts)
  knownSites: boolean
  // Sites owlit has papers waiting at that the extension may not read yet
  needs: { host: string; papers: number }[]
  // The sign-in or check this tab's site waits for, and owlit going on there once through
  wait?: SiteWait
  going?: GoingOn
  // What the toolbar click on this tab came to, when it opened the popup to say it
  said?: Outcome
}

// How the button's work ended, or why it couldn't start: said in one sentence (say.ts), in the page's
// card or, where none can be drawn, in the popup. paperId: the Library paper it was about, for Open.
export type Outcome =
  | { kind: "added"; pdf: "saved" | "none-named" | "not-a-pdf" | "not-this-paper" | "not-allowed"; host?: string; paperId: string }
  | { kind: "saved"; paperId: string }
  | { kind: "taken"; paperId: string; title: string }
  | { kind: "no-pdf"; host: string }
  | { kind: "not-this-paper" }
  | { kind: "has-pdf"; paperId: string }
  // In the Library without its PDF, on a page that names none
  | { kind: "none-named"; paperId: string }
  // listing: the site's name when the page lists papers (Google Scholar's results)
  | { kind: "no-paper"; listing?: string }
  // A PDF owlit can't place: no Library paper's, as far as its first pages tell
  | { kind: "unknown-pdf" }
  // The PDF's site isn't one the extension may read; Allow asks on the extension's own page
  | { kind: "needs-site"; host: string }
  | { kind: "no-workspace" }
  | { kind: "offline" }
  | { kind: "unpaired" }
  | { kind: "pairing" }
  | { kind: "connected" }
  | { kind: "elsewhere"; name: string }
  | { kind: "failed"; message: string }
  // A site waiting on the person, said when they come to it; through: they got past it, owlit goes on
  | { kind: "wait"; wait: SiteWait }
  | { kind: "through"; host: string; papers: number }

// What a card's button asks the background for
export type CardAction =
  | { kind: "open-paper"; paperId: string }
  | { kind: "open-owlit" }
  | { kind: "allow"; host: string }
  | { kind: "connect" }

// The card the content script draws in the page (content/card.ts): all its words come from the
// background, which has the catalogs
export interface CardView {
  text: string
  detail?: string
  // A button, which asks the background
  action?: { label: string; do: CardAction }
  // Stays until closed: there is something to decide or to do. Otherwise it fades after a moment.
  stays: boolean
  // The close button's name for screen readers
  close: string
  // A card the person closed isn't drawn again in this browser session (a site's wait, said on every page)
  key?: string
}

export type Request =
  | { kind: "state"; tabId: number }
  | { kind: "connect" }
  // The popup's button: the click's work again, for this tab
  | { kind: "act"; tabId: number }
  | { kind: "takePdfs"; on: boolean }
  // From the content script on every page it runs on: its head, and whether the browser is dark
  | { kind: "page"; html: string; url: string; dark?: boolean }
  // The user let the extension read this site: owlit goes on there, and a click that needed it (tabId)
  // is done again
  | { kind: "allowed"; host: string; tabId?: number }
  // A card's button
  | { kind: "card"; action: CardAction }
  | { kind: "open"; paperId?: string }
  // The popup, when it opens: the browser's light or dark, which a background can't read
  | { kind: "scheme"; dark: boolean }
  // The person closed a card that has a key
  | { kind: "closed"; key: string }

// What a request is answered with
export interface Answers {
  state: PopupState
  connect: Connection
  act: Outcome
  takePdfs: null
  page: null
  allowed: null
  card: null
  open: boolean
  scheme: null
  closed: null
}

// What the background says to a content script
export type ToPage = { kind: "card"; card: CardView | null }

export { originsOf } from "./permissions.ts"

export function send<R extends Request>(request: R): Promise<Answers[R["kind"]]> {
  return ext.runtime.sendMessage(request)
}
