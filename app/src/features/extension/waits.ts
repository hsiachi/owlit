import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait, Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import type { WaitingItem } from "@/app/waiting-on-you"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { KIND_ICON } from "@/lib/kinds"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"

// The sites where the extension in the user's browser waits for them: one row each, with one thing to
// do, said the same atop the Library, on Home, on a paper's card and in a notification

export interface WaitWords {
  // The row's sentence after its count: "Need you to sign in to your library"
  need: string
  // The whole sentence, where no count stands before it: "23 papers need you to sign in to your library"
  what: string
  // Why, behind the row's info icon
  why: string
  // The one thing to do, on its button, before the page is open in the browser
  action: string
}

// n: the papers it holds. libraryName: the library behind the proxy, when owlit knows it (libraryNameOf).
export function waitWords(wait: Pick<ExtensionWait, "kind" | "host" | "proxied">, n: number, libraryName?: string): WaitWords {
  const { host } = wait
  switch (wait.kind) {
    case "sign-in": {
      if (wait.proxied) {
        const library = libraryName ?? t({ message: "your library", comment: "in: Need you to sign in to your library" })
        return {
          need: plural(n, { one: `Needs you to sign in to ${library}`, other: `Need you to sign in to ${library}` }),
          what: plural(n, { one: `# paper needs you to sign in to ${library}`, other: `# papers need you to sign in to ${library}` }),
          why: t`These papers come through your library's proxy, ${host}. owlit goes on by itself once you're signed in.`,
          action: t({ message: "Sign in", comment: "button: opens the sign-in page (the library's, or the site's) in the user's browser" }),
        }
      }
      return {
        need: plural(n, { one: `Needs you to sign in at ${host}`, other: `Need you to sign in at ${host}` }),
        what: plural(n, { one: `# paper needs you to sign in at ${host}`, other: `# papers need you to sign in at ${host}` }),
        why: t`${host} wants you signed in before it gives the PDFs. owlit goes on by itself once you're signed in.`,
        action: t({ message: "Sign in", comment: "button: opens the sign-in page (the library's, or the site's) in the user's browser" }),
      }
    }
    case "check":
      return {
        need: plural(n, { one: `Needs you to verify you're human on ${host}`, other: `Need you to verify you're human on ${host}` }),
        what: plural(n, { one: `# paper needs you to verify you're human on ${host}`, other: `# papers need you to verify you're human on ${host}` }),
        why: t`Open the page and verify there. owlit usually notices by itself; if it doesn't, press I've verified it.`,
        action: t({ message: "Open", comment: "button: opens the site's page with its 'verify you are human' check in the user's browser" }),
      }
    case "blocked":
      return {
        need: t`${host} blocks your browser`,
        what: plural(n, { one: `${host} blocks your browser · # paper`, other: `${host} blocks your browser · # papers` }),
        why: t`The site's firewall turned your browser away. Another network usually gets past it; owlit goes on once a page there loads.`,
        action: t({ message: "Try again", comment: "button: opens the site's page in the user's browser, to see whether it still blocks them" }),
      }
    case "permission":
      return {
        need: plural(n, { one: `Needs your permission for ${host}`, other: `Need your permission for ${host}` }),
        what: plural(n, { one: `# paper needs your permission for ${host}`, other: `# papers need your permission for ${host}` }),
        why: t`The owlit extension asks before it reads a site. Allow it on ${host} once; owlit goes on by itself.`,
        action: t({ message: "Allow", comment: "button: the owlit extension opens a page in the user's browser that asks to let it read this site" }),
      }
  }
}

// After the page is open in the browser: the button says what the user did there, and owlit tries the
// site at once (resumeWait). Only a sign-in and a check have one; a permission and a block go on by
// themselves once a page there loads.
export function doneWords(kind: ExtensionWait["kind"]): string | undefined {
  if (kind === "sign-in") return t({ message: "I've signed in", comment: "button: the user signed in in their browser; owlit tries the site again now" })
  if (kind === "check") return t({ message: "I've verified it", comment: "button: the user passed the site's 'verify you are human' check; owlit tries the site again now" })
  return undefined
}

// The site wait a paper is held under, if any
export const waitOf = (paper: Pick<Paper, "pdfState">, waits: ExtensionWait[]) => {
  const at = paper.pdfState?.extension
  const host = at?.waits && (at.waitsAt ?? at.host)
  return host ? waits.find((w) => w.host === host && w.kind === at.waits) : undefined
}

// The browser the extension lives in, as it named itself (Dia, Chrome): the one heard from last
export function browserName(paired: { browser: string; pairedAt: number; lastSeenAt?: number }[] | undefined): string {
  const last = [...(paired ?? [])].sort((a, b) => (b.lastSeenAt ?? b.pairedAt) - (a.lastSeenAt ?? a.pairedAt))[0]
  return last?.browser ?? t({ message: "your browser", comment: "in: Getting PDFs for 3 papers using your browser…, Open in your browser" })
}

// The row's one thing to do, done in the browser the extension lives in, where the user's access is: the
// extension opens the sign-in, the check or its own Allow page there. With no extension connected, owlit
// opens a sign-in or a check in that browser itself; being allowed can only be asked from inside it, so
// a toast then says where the extension's button is.
export async function actOnWait(wait: ExtensionWait) {
  const opened = await rpc.extension.open({ kind: wait.kind, host: wait.host }).catch(toastError)
  if (opened && opened.by !== "none") {
    useOpenedWaits.setState((s) => ({ list: [...s.list.filter((o) => o.host !== wait.host), { kind: wait.kind, host: wait.host, ...(opened.browser ? { browser: opened.browser } : {}) }] }))
    return
  }
  if (opened?.by !== "none") return
  const { host } = wait
  if (wait.kind === "permission") toast(t`Press owlit's button in your browser's toolbar, then Allow.`, { description: t`The extension asks to read ${host} for the papers waiting there.` })
  // The wait went meanwhile (the user got through), or owlit can't open pages here
  else window.open(wait.url, "_blank", "noreferrer")
}

// I've signed in, I've verified it: owlit tries the site at once. A site that no longer waits went on
// already, by the extension seeing the user through.
export async function resumeWait(wait: ExtensionWait) {
  try {
    await rpc.extension.resume({ host: wait.host })
    forgetOpened(wait.host)
  } catch (e) {
    toastError(e, t`Couldn't tell owlit to go on.`)
  }
}

// A page for the user to act on by hand (a paper to download there), in the extension's browser; where
// owlit can't open pages there, the system's browser
export async function openInBrowser(url: string) {
  const opened = await rpc.extension.openPage({ url }).catch(() => undefined)
  if (!opened || opened.by === "none") window.open(url, "_blank", "noreferrer")
}

// A site the extension waits at, as a row: amber, among what waits on the user (Home's Waiting on you,
// the rail's dot), once they asked for one of its papers; otherwise grey, in a block of its own on Home
export function siteWaitItem(wait: ExtensionWait, showLibrary: () => void, libraryName?: string): WaitingItem {
  const words = waitWords(wait, wait.papers, libraryName)
  return {
    key: `papers:wait:${wait.kind}:${wait.host}`,
    place: "/library",
    icon: KIND_ICON.paper,
    tone: waitsOnYou(wait) ? "warning" : "working",
    what: words.what,
    open: { label: t({ message: "Show", comment: "verb: show the Library, where the papers wait" }), run: showLibrary },
    action: { label: words.action, run: () => void actOnWait(wait) },
  }
}

// The ones that wait on the user
export const siteWaitItems = (waits: ExtensionWait[], showLibrary: () => void, libraryName?: string) => waits.filter((wait) => waitsOnYou(wait)).map((wait) => siteWaitItem(wait, showLibrary, libraryName))

// ---- Pages opened, and the batch

// The sites whose page the user had opened in their browser, and which browser, until the site goes on:
// their row's button then says what they did there (doneWords)
export interface OpenedWait {
  kind: ExtensionWait["kind"]
  host: string
  browser?: string
}

export const useOpenedWaits = create<{ list: OpenedWait[] }>(() => ({ list: [] }))

const forgetOpened = (host: string) => useOpenedWaits.setState((s) => ({ list: s.list.filter((o) => o.host !== host) }))

// The opened sites that no longer wait, or wait for something else now (a check turned into a block), go
export function pruneOpened(waits: ExtensionWait[]) {
  const { list } = useOpenedWaits.getState()
  const kept = list.filter((o) => waits.some((w) => w.host === o.host && w.kind === o.kind))
  if (kept.length !== list.length) useOpenedWaits.setState({ list: kept })
}

// The papers the user sent to the extension in one go (Get PDFs), from when, until they stop it or put
// its summary away. Kept in the window: the block atop the Library counts them (lib/pdf-batch.ts).
export interface Batch {
  ids: string[]
  at: number
}

export const useBatch = create<{ batch: Batch | null }>(() => ({ batch: null }))

// A second Get PDFs while one runs adds to it, and keeps the first one's start
export function startBatch(ids: string[]) {
  useBatch.setState((s) => ({ batch: { ids: [...new Set([...(s.batch?.ids ?? []), ...ids])], at: s.batch?.at ?? Date.now() } }))
}

export const putAwayBatch = () => useBatch.setState({ batch: null })

// Stop: the papers still in line leave the extension's queue, and the block goes
export async function stopBatch() {
  const batch = useBatch.getState().batch
  if (!batch) return
  putAwayBatch()
  await rpc.library.stopFetchPdfs({ ids: batch.ids }).catch((e) => toastError(e, t`Couldn't stop getting the PDFs.`))
}
