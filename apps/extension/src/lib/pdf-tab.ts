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
