import { OwlitError } from "./owlit.ts"

// Whether a tab that finished loading a PDF is taken for owlit without a click: the user's PDF of a
// Library paper that lacks one comes to owlit by itself. Only when owlit is connected, the user left
// "Take PDFs I open" on, and the PDF's site is one the extension may read (it is fetched again from the
// browser's cache, with the user's cookies). owlit then decides whether it is a Library paper's.
export function takesPdfTab(tab: { url: string; contentType?: string }, state: { connected: boolean; takePdfs: boolean; permitted: boolean }): boolean {
  return state.connected && state.takePdfs && state.permitted && isPdfResponse(tab.url, tab.contentType)
}

// A PDF from the web, by its Content-Type (not its address: many PDFs are served from addresses without .pdf)
export const isPdfResponse = (url: string, contentType: string | undefined) => /^https?:\/\//i.test(url) && /^application\/(x-)?pdf\b/i.test(contentType?.trim() ?? "")

// The Content-Type of a response, from webRequest's headers
export function contentTypeOf(headers: { name: string; value?: string }[] | undefined) {
  return headers?.find((h) => h.name.toLowerCase() === "content-type")?.value
}

// Each tab's PDF in session storage under its own key, so two tabs loading at once never write over
// each other's
export const pdfTabKey = (tabId: number) => `pdfTab:${tabId}`

// Whether a tab shows the PDF kept for it: its address, but for a #page= the viewer adds. A tab that
// went on to a site the extension may not read has no response seen, so its key can name an older PDF.
export const showsPdf = (tabUrl: string, pdfUrl: string | undefined) => !!pdfUrl && tabUrl.split("#")[0] === pdfUrl.split("#")[0]

// What a tab's main-frame response does to its key: a PDF is kept by its address, anything else clears it
export function pdfTabWrite(tabId: number, url: string, headers: { name: string; value?: string }[] | undefined): { set: Record<string, string> } | { remove: string } {
  const key = pdfTabKey(tabId)
  return isPdfResponse(url, contentTypeOf(headers)) ? { set: { [key]: url } } : { remove: key }
}

// Whether owlit gave its answer for a PDF tab it was handed and refused it (not a Library paper's,
// another paper's): such a PDF isn't sent again in this browser session. A lost pairing or a failing
// owlit (no workspace open) gave none, and the next load tries again.
export const refusedByOwlit = (error: unknown) => error instanceof OwlitError && error.status !== 401 && error.status < 500
