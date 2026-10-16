import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait } from "@owlit/protocol"
import { toast } from "sonner"
import type { WaitingItem } from "@/app/waiting-on-you"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { KIND_ICON } from "@/lib/kinds"

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
        action: t({ message: "Open the extension", comment: "button: says how to open the owlit extension in the browser" }),
      }
  }
}

// The line's one thing to do. A sign-in or a check opens its page in the user's browser, where the
// extension notices them getting through; an extension's popup can't be opened from outside the browser,
// so for being allowed the line says where its button is.
export function actOnWait(wait: ExtensionWait) {
  if (wait.kind === "permission") {
    const { host } = wait
    toast(t`Press owlit's button in your browser's toolbar, then Allow.`, { description: t`The extension asks to read ${host} for the papers waiting there.` })
    return
  }
  // The desktop app opens web links in the user's browser
  window.open(wait.url, "_blank", "noreferrer")
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
    action: { label: words.action, run: () => actOnWait(wait) },
  }
}

// The ones that wait on the user
export const siteWaitItems = (waits: ExtensionWait[], showLibrary: () => void) => waits.filter((wait) => waitsOnYou(wait)).map((wait) => siteWaitItem(wait, showLibrary))

// Since you left's line for PDFs: how many came through the user's browser while they were away, and
// what the sites still wait for. Nothing to say when none came; the sites have their own lines.
export function cameLine(came: number, waits: ExtensionWait[]): { title: string; detail?: string } | undefined {
  if (!came) return undefined
  const title = plural(came, { one: "# PDF came through your browser", other: "# PDFs came through your browser" })
  const parts = waits.map(({ kind, host, papers: n, proxied }) =>
    kind === "sign-in"
      ? proxied
        ? plural(n, { one: "# waits for your library sign-in", other: "# wait for your library sign-in" })
        : plural(n, { one: `# waits for a sign-in at ${host}`, other: `# wait for a sign-in at ${host}` })
      : kind === "check"
        ? plural(n, { one: `# waits for a check at ${host}`, other: `# wait for a check at ${host}` })
        : plural(n, { one: `# waits for the extension to be allowed on ${host}`, other: `# wait for the extension to be allowed on ${host}` }),
  )
  return parts.length ? { title, detail: parts.join(" · ") } : { title }
}
