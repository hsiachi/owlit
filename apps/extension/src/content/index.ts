import { ext } from "../lib/browser.ts"

// On a publisher's page (and any site the user let the extension read): the page's <head>, where its
// paper's meta tags are, goes to the background, which reads it (lib/page.ts) and asks owlit whether
// the paper is in the Library. Nothing else of the page leaves it.
void ext.runtime.sendMessage({ kind: "page", html: document.head?.outerHTML ?? "", url: location.href }).catch(() => undefined)
