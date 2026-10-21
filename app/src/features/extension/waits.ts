import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait } from "@owlit/protocol"
import { toast } from "sonner"
import type { WaitingItem } from "@/app/waiting-on-you"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { KIND_ICON } from "@/lib/kinds"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { create } from "zustand"
import { useLibraryStore } from "@/features/library/store"

// The sites where the extension in the user's browser waits for them: one line each, with one thing to
// do, said the same on Home, atop the Library, on a paper's card and in a notification

export interface WaitWords {
  // "Sign in to your library", or "Sign in at sagepub.com" where no library proxy is in between
  what: string
  // "3 papers wait for it"
  papers: string
  // The one thing to do, on its button
  action: string
}

export function waitWords(wait: ExtensionWait): WaitWords {
  const { host, papers: n } = wait
  switch (wait.kind) {
    case "sign-in":
      return {
        what: wait.proxied ? t`Sign in to your library` : t`Sign in at ${host}`,
        papers: plural(n, { one: "# paper waits for it", other: "# papers wait for it" }),
        action: t({ message: "Sign in", comment: "button: opens the sign-in page (the library's, or the site's) in the user's browser" }),
      }
    case "check":
      return {
        what: t`Pass a check at ${host}`,
        papers: plural(n, { one: "# paper", other: "# papers" }),
        action: t({ message: "Open it", comment: "button: opens the site's page with the check in the user's browser" }),
      }
    case "permission":
      return {
        what: t`Let the owlit extension read ${host}`,
        papers: plural(n, { one: "# paper", other: "# papers" }),
        action: t({ message: "Allow…", comment: "button: the owlit extension opens a page in the user's browser that asks to let it read this site" }),
      }
  }
}

// The line's one thing to do, done in the browser the extension lives in, where the user's access is: the
// extension opens the sign-in, the check or its own Allow page there. With no extension connected, owlit
// opens a sign-in or a check in that browser itself; being allowed can only be asked from inside it, so
// the line then says where the extension's button is.
export async function actOnWait(wait: ExtensionWait) {
  const opened = await rpc.extension.open({ kind: wait.kind, host: wait.host }).catch(toastError)
  if (opened && opened.by !== "none") return follow(wait, opened.browser)
  if (opened?.by !== "none") return
  const { host } = wait
  if (wait.kind === "permission") toast(t`Press owlit's button in your browser's toolbar, then Allow.`, { description: t`The extension asks to read ${host} for the papers waiting there.` })
  // The line went away meanwhile (the user got through), or owlit can't open pages here
  else window.open(wait.url, "_blank", "noreferrer")
}

// A site the extension waits at, as a row: amber, among what waits on the user (Home's Waiting on you,
// the rail's dot), once they asked for one of its papers; otherwise grey, in a block of its own on Home
export function siteWaitItem(wait: ExtensionWait, showLibrary: () => void): WaitingItem {
  const words = waitWords(wait)
  return {
    key: `papers:wait:${wait.kind}:${wait.host}`,
    place: "/library",
    icon: KIND_ICON.paper,
    tone: waitsOnYou(wait) ? "warning" : "working",
    what: words.what,
    where: `· ${words.papers}`,
    open: { label: t({ message: "Show", comment: "verb: show the Library, where the papers wait" }), run: showLibrary },
    action: { label: words.action, run: () => void actOnWait(wait) },
  }
}

// The ones that wait on the user
export const siteWaitItems = (waits: ExtensionWait[], showLibrary: () => void) => waits.filter((wait) => waitsOnYou(wait)).map((wait) => siteWaitItem(wait, showLibrary))

// ---- What came of a click

// A site whose waiting line the person acted on, followed until they put its outcome away: the papers
// waiting there when they clicked (the queue forgets them as it goes, so the window keeps them), and the
// browser the page opened in. The Library's line says, in turn, that the page is open there, how many
// PDFs have come while the site's queue drains, and what came of it all (ExtensionWaitLines).
export interface FollowedWait {
  // all: Get them all, the papers sent to the extension in one go, at every site (host ALL_SITES)
  kind: ExtensionWait["kind"] | "all"
  host: string
  ids: string[]
  browser?: string
  at: number
  // The site's wait went once since the click: a wait there again (another check) is a new one to act on
  through?: boolean
}

export const useFollowedWaits = create<{ list: FollowedWait[] }>(() => ({ list: [] }))

function follow(wait: ExtensionWait, browser: string | undefined) {
  const ids = Object.values(useLibraryStore.getState().papers)
    .filter((p) => !p.pdf && p.pdfState?.extension?.host === wait.host)
    .map((p) => p.id)
  useFollowedWaits.setState((s) => {
    const before = s.list.find((f) => f.host === wait.host)
    // A second click on the same site (it asked again) keeps the papers counted from the first
    const all = [...new Set([...(before?.ids ?? []), ...ids])]
    const next: FollowedWait = { kind: wait.kind, host: wait.host, ids: all, ...(browser ? { browser } : {}), at: Date.now() }
    return { list: [...s.list.filter((f) => f.host !== wait.host), next] }
  })
}

// Get them all: followed like a site the person acted on, through from the start (no one site's wait
// stands for it); the papers waiting for a sign-in among them have the site's own line to act on
export const ALL_SITES = "*"
export function followBatch(ids: string[]) {
  useFollowedWaits.setState((s) => {
    const before = s.list.find((f) => f.host === ALL_SITES)
    const next: FollowedWait = { kind: "all", host: ALL_SITES, ids: [...new Set([...(before?.ids ?? []), ...ids])], at: Date.now(), through: true }
    return { list: [...s.list.filter((f) => f.host !== ALL_SITES), next] }
  })
}

export const putAwayFollowed = (host: string) => useFollowedWaits.setState((s) => ({ list: s.list.filter((f) => f.host !== host) }))

// The sites followed whose wait has gone, as through, from the waits core reports now
export function noteThrough(waits: ExtensionWait[]) {
  const { list } = useFollowedWaits.getState()
  if (!list.some((f) => !f.through && !waits.some((w) => w.host === f.host))) return
  useFollowedWaits.setState({ list: list.map((f) => (f.through || waits.some((w) => w.host === f.host) ? f : { ...f, through: true })) })
}
