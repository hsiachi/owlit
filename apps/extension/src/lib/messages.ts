import type { ExtensionPaper } from "@owlit/protocol"
import type { PagePaper } from "./page.ts"
import { ext } from "./browser.ts"

// What the popup and the content script say to the background, and what it answers

// unpaired: owlit is running, this browser isn't connected; pairing: owlit's window asks the user;
// offline: owlit isn't running; connected: paired and running
export type Connection =
  | { state: "unpaired"; problem?: "refused" | "expired" | "no-window" }
  | { state: "pairing" }
  | { state: "offline"; paired: boolean }
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

export interface PopupState {
  connection: Connection
  page: PageState | null
  takePdfs: boolean
  // The extension may read every publisher site the manifest lists (permissions.ts)
  knownSites: boolean
  // Sites owlit has papers waiting at that the extension may not read yet
  needs: { host: string; papers: number }[]
}

// How the button's work ended; the popup says it in one sentence
export type Outcome =
  | { kind: "added"; pdf: "saved" | "none-named" | "not-a-pdf" | "not-this-paper"; host?: string }
  | { kind: "saved" }
  | { kind: "no-pdf"; host: string }
  | { kind: "not-this-paper" }
  | { kind: "has-pdf" }
  | { kind: "no-workspace" }
  | { kind: "offline" }
  | { kind: "unpaired" }
  | { kind: "failed"; message: string }

export type Request =
  | { kind: "state"; tabId: number }
  | { kind: "connect" }
  | { kind: "add"; tabId: number }
  | { kind: "save"; tabId: number }
  | { kind: "takePdfs"; on: boolean }
  | { kind: "page"; html: string; url: string }
  // The user let the extension read this site from the popup: owlit goes on there
  | { kind: "allowed"; host: string }

// What a request is answered with
export interface Answers {
  state: PopupState
  connect: Connection
  add: Outcome
  save: Outcome
  takePdfs: null
  page: null
  allowed: null
}

export { originsOf } from "./permissions.ts"

export function send<R extends Request>(request: R): Promise<Answers[R["kind"]]> {
  return ext.runtime.sendMessage(request)
}
