import { t } from "@lingui/core/macro"
import type { ExtensionWait, PdfRunView } from "@owlit/protocol"
import { toast } from "sonner"
import type { WaitingItem } from "@/app/waiting-on-you"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { KIND_ICON } from "@/lib/kinds"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { waitWords } from "./wait-words"

export { browserName, waitWords, type WaitWords } from "./wait-words"

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

// The row's one thing to do, done in the browser the extension lives in, where the user's access is: the
// extension opens the sign-in, the check or its own Allow page there. With no extension connected, owlit
// opens a sign-in or a check in that browser itself; being allowed can only be asked from inside it, so
// a toast then says where the extension's button is. Core notes the page opened (ExtensionWait.opened).
export async function actOnWait(wait: ExtensionWait) {
  const opened = await rpc.extension.open({ wait: wait.id }).catch(toastError)
  if (opened?.by !== "none") return
  const { at: host } = wait
  if (wait.kind === "permission") toast(t`Press owlit's button in your browser's toolbar, then Allow.`, { description: t`The extension asks to read ${host} for the papers waiting there.` })
  // The wait went meanwhile (the user got through), or owlit can't open pages here
  else window.open(wait.url, "_blank", "noreferrer")
}

// I've signed in, I've verified it: owlit tries the site at once, and core follows the wait
// (ExtensionWait.retried). A wait that is no longer up went on already, by the extension seeing the user
// through.
export async function resumeWait(wait: ExtensionWait) {
  await rpc.extension.resume({ wait: wait.id }).catch((e) => toastError(e, t`Couldn't tell owlit to go on.`))
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
    key: `papers:wait:${wait.id}`,
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

// The row's sentence when the same wait came back after the user said they got through (retried.again)
export function stillWords(wait: Pick<ExtensionWait, "kind" | "at" | "proxied">, libraryName?: string): string {
  const { at: host } = wait
  if (wait.kind === "check") return t`${host} still asks you to verify you're human`
  if (wait.kind === "blocked") return t`${host} still blocks your browser`
  if (wait.kind === "permission") return t`owlit still needs your permission for ${host}`
  if (!wait.proxied) return t`${host} still asks you to sign in`
  return libraryName ? t`${libraryName} still asks you to sign in` : t`Your library still asks you to sign in`
}

// Why, behind the same row's info icon. A block and a permission have no button of their own to press
// (doneWords): they go on by themselves.
export function stillWhy(kind: ExtensionWait["kind"]): string {
  const again = doneWords(kind)
  return again ? t`owlit tried again just now and met the same page. Open it, finish there, then press ${again}.` : t`owlit tried again just now and met the same page. It goes on by itself once a page there loads.`
}

// ---- Get PDFs, as core keeps it (ExtensionView.runs)

// Stop: the papers still in line leave the extension's queue, and the block goes
export async function stopRun(run: PdfRunView) {
  try {
    await rpc.pdfRuns.stop({ run: run.id })
    await rpc.pdfRuns.dismiss({ run: run.id })
  } catch (e) {
    toastError(e, t`Couldn't stop getting the PDFs.`)
  }
}

// Its summary put away
export const dismissRun = (run: PdfRunView) => rpc.pdfRuns.dismiss({ run: run.id }).catch(toastError)
