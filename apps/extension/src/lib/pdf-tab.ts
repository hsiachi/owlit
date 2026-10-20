import type { ExtensionPaper, PaperAnswer } from "@owlit/protocol"
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

export interface TakeDeps {
  // The PDF at the address, with the user's cookies; undefined when what came isn't a PDF or nothing came
  fetchPdf: (url: string) => Promise<ArrayBuffer | undefined>
  // The Library paper the address names by its DOI or arXiv id, if any
  lookUp: (ids: { doi?: string; arxiv?: string }) => Promise<ExtensionPaper | null>
  // Hands the PDF to owlit: to that paper (PUT /papers/:id/pdf), or for owlit to place (PUT /pdfs)
  put: (paperId: string | undefined, pdf: ArrayBuffer) => Promise<PaperAnswer>
  // The PDFs owlit has answered for in this browser session, so a reload doesn't send one again
  answered: { has: (url: string) => Promise<boolean>; add: (url: string) => Promise<void> }
}

// taken: owlit has it now; had: the paper had its PDF; refused: owlit's no (not a Library paper's,
// another paper's); seen: answered for before in this session; missed: no PDF came, or owlit couldn't
// answer, and the next load tries again
export type Taken = { taken: ExtensionPaper } | { had: ExtensionPaper } | { refused: unknown } | { seen: true } | { missed: unknown }

// A PDF tab handed to owlit. Marked answered only once owlit answered for it: a fetch that failed (a
// signed address that expired, a page that wasn't the PDF) or an owlit that went away is tried again.
export async function takePdf(url: string, ids: { doi?: string; arxiv?: string }, deps: TakeDeps): Promise<Taken> {
  if (await deps.answered.has(url)) return { seen: true }
  const pdf = await deps.fetchPdf(url)
  if (!pdf) return { missed: undefined }
  try {
    const named = ids.doi || ids.arxiv ? await deps.lookUp(ids) : null
    if (named?.hasPdf) {
      await deps.answered.add(url)
      return { had: named }
    }
    const { paper } = await deps.put(named?.id, pdf)
    await deps.answered.add(url)
    return { taken: paper }
  } catch (error) {
    if (!refusedByOwlit(error)) return { missed: error }
    await deps.answered.add(url)
    return { refused: error }
  }
}
