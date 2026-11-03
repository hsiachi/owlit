import { t } from "@lingui/core/macro"
import type { ExtensionWait } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import type { WaitingItem } from "@/app/waiting-on-you"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { KIND_ICON } from "@/lib/kinds"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { waitWords } from "./wait-words"

export { waitOf, waitWords, type WaitWords } from "./wait-words"

// The sites where the extension in the user's browser waits for them: one row each, with one thing to
// do, said the same atop the Library, on Home, on a paper's card and in a notification

// After the page is open in the browser: the button says what the user did there, and owlit tries the
// site at once (resumeWait). Only a sign-in and a check have one; a permission and a block go on by
// themselves once a page there loads.
export function doneWords(kind: ExtensionWait["kind"]): string | undefined {
  if (kind === "sign-in") return t({ message: "I've signed in", comment: "button: the user signed in in their browser; owlit tries the site again now" })
  if (kind === "check") return t({ message: "I've verified it", comment: "button: the user passed the site's 'verify you are human' check; owlit tries the site again now" })
  return undefined
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
  forgetRetried(wait.host)
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
  // Noted before asking: the site's wait can go and come back (the try met the same page) before the
  // answer does
  useRetried.setState((s) => ({ list: [...s.list.filter((r) => r.host !== wait.host), { kind: wait.kind, host: wait.host, at: Date.now(), gone: false }] }))
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

// The papers to download by hand, one tab at a time: the extension opens the first one's page in its
// browser with a card that walks the user through them (Skip, Next paper). With no extension connected,
// the first one's page opens as any page to download by hand.
export async function walkManual(ids: string[], firstUrl: string) {
  const opened = await rpc.extension.walk({ ids }).catch(() => undefined)
  if (!opened || opened.by === "none") await openInBrowser(firstUrl)
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

// The opened sites that no longer wait, or wait for something else now (a check turned into a block), go.
// A site the user said they got through at is followed: its wait going marks it, and the same wait back
// soon after means owlit's try met the same page (stillWaits).
export function pruneOpened(waits: ExtensionWait[]) {
  const { list } = useOpenedWaits.getState()
  const kept = list.filter((o) => waits.some((w) => w.host === o.host && w.kind === o.kind))
  if (kept.length !== list.length) useOpenedWaits.setState({ list: kept })
  const retried = useRetried.getState().list
  const now = Date.now()
  const next = retried.filter((r) => now - r.at < RETRIED_MS).map((r) => (r.gone || waits.some((w) => w.host === r.host && w.kind === r.kind) ? r : { ...r, gone: true }))
  if (next.length !== retried.length || next.some((r, i) => r !== retried[i])) useRetried.setState({ list: next })
}

// A site where the user pressed I've signed in / I've verified it: at, when; gone, once its wait went
export interface Retried {
  kind: ExtensionWait["kind"]
  host: string
  at: number
  gone: boolean
}

// How long after I've verified it the same wait coming back counts as owlit's try meeting it again: the
// try goes at once, and an answer takes at most a minute or two (the extension's FETCH_MS per get)
const RETRIED_MS = 5 * 60_000

export const useRetried = create<{ list: Retried[] }>(() => ({ list: [] }))

const forgetRetried = (host: string) => useRetried.setState((s) => ({ list: s.list.filter((r) => r.host !== host) }))

// The row's sentence then, in place of its usual one
export function stillWords(wait: Pick<ExtensionWait, "kind" | "host" | "proxied">, libraryName?: string): string {
  const { host } = wait
  if (wait.kind === "check") return t`${host} still asks you to verify you're human`
  if (!wait.proxied) return t`${host} still asks you to sign in`
  return libraryName ? t`${libraryName} still asks you to sign in` : t`Your library still asks you to sign in`
}

// The wait is back after the user said they got through: owlit tried at once and met the same page. Said
// in the row until the user acts on it again.
export const stillWaits = (list: Retried[], wait: Pick<ExtensionWait, "kind" | "host">, now = Date.now()) => list.some((r) => r.gone && r.host === wait.host && r.kind === wait.kind && now - r.at < RETRIED_MS)

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
