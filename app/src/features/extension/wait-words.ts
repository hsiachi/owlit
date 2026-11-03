import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait } from "@owlit/protocol"

// What a site the extension waits at says: pure, apart from the window's state in waits.ts, so tests that
// run without a window (packages/pdf-bench) read the same words

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
export function waitWords(wait: Pick<ExtensionWait, "kind" | "at" | "proxied">, n: number, libraryName?: string): WaitWords {
  const { at: host } = wait
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
