import type { PaperAnswer, WorkEnded, WorkItem } from "@owlit/protocol"
import { OwlitError, type ask as askOwlit } from "./owlit.ts"
import { paperOfPage, pdfLinkIn } from "./page.ts"
import { isCheck, titleOf, verdict, type Page } from "./verdict.ts"

// Fetching a paper owlit asked for (GET /work), with the user's cookies: its PDF, or one word for what
// came instead (verdict.ts). Nothing else is fetched, and what goes back to owlit is the PDF, or the word,
// the host, the page's title and where it ended; never the page's text. Pure but for what it is given,
// so a test runs it on a stubbed fetch.

// Each fetch gives up after this and counts as no copy. Chrome stops a service worker whose fetch takes
// longer than 30 s to start answering, so a fetch that slow ends when the worker does; owlit asks for it
// again once its own wait for the answer runs out.
export const FETCH_MS = 60_000
// A page larger than this isn't read further: what the words are judged by is near its top
const PAGE_MAX_CHARS = 2_000_000

export interface FetchDeps {
  fetch: typeof fetch
  // The extension may read this address's site (its host permissions, chrome.permissions.contains)
  permitted: (url: string) => Promise<boolean>
  timeoutMs?: number
}

export type Fetched = { pdf: ArrayBuffer; host: string; url: string } | WorkEnded

type Got = { kind: "pdf"; bytes: ArrayBuffer; url: string } | { kind: "page"; page: Page } | { kind: "offline" } | { kind: "timeout" }

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

async function get(url: string, deps: FetchDeps, proxy: Page["proxy"]): Promise<Got> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_MS)
  try {
    const response = await deps.fetch(url, { credentials: "include", redirect: "follow", signal: controller.signal })
    const bytes = await response.arrayBuffer()
    // By its first bytes, or its type with the mark a little further in (some servers send a line first).
    // What goes to owlit starts at the mark: owlit takes a body as a PDF only when it begins with it.
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024))
    const typed = /^application\/(x-)?pdf\b/i.test(response.headers.get("content-type") ?? "")
    const mark = head.indexOf("%PDF-")
    if (mark === 0 || (typed && mark > 0)) return { kind: "pdf", bytes: mark ? bytes.slice(mark) : bytes, url: response.url || url }
    const html = new TextDecoder().decode(bytes.slice(0, PAGE_MAX_CHARS))
    return { kind: "page", page: { url: response.url || url, status: response.status, html, proxy } }
  } catch {
    // No answer at all: the network, or the site, is down; aborted, it was too slow
    return controller.signal.aborted ? { kind: "timeout" } : { kind: "offline" }
  } finally {
    clearTimeout(timer)
  }
}

// What a page that came instead says, as owlit hears it
const said = (page: Page): WorkEnded => {
  const title = titleOf(page.html)
  return { ended: verdict(page), host: hostOf(page.url), ...(title ? { title: title.slice(0, 300) } : {}), url: page.url }
}

// The PDF's own address first, when owlit knows it; then the article page, and the PDF it names
export async function fetchFor(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  if (!(await deps.permitted(item.url))) return { ended: "no-permission", host: item.host }
  const proxy = item.proxied ? { host: hostOf(item.url), entry: item.url } : undefined
  const tried = new Set<string>()
  if (item.pdfUrl && (await deps.permitted(item.pdfUrl))) {
    tried.add(item.pdfUrl)
    const got = await get(item.pdfUrl, deps, proxy)
    if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
    // A check or a sign-in in front of the PDF is in front of the page too
    if (got.kind === "page" && stops(got.page)) return said(got.page)
  }
  const got = await get(item.url, deps, proxy)
  if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
  if (got.kind === "offline") return { ended: "offline", host: hostOf(item.url) }
  if (got.kind === "timeout") return { ended: "no-copy", host: hostOf(item.url) }
  const { page } = got
  const named = paperOfPage(page.html, page.url)?.pdfUrl ?? pdfLinkIn(page.html, page.url)
  if (named && !tried.has(named) && !isCheck(page) && (await deps.permitted(named))) {
    const pdf = await get(named, deps, proxy)
    if (pdf.kind === "pdf") return { pdf: pdf.bytes, host: hostOf(pdf.url), url: pdf.url }
    if (pdf.kind === "page" && stops(pdf.page)) return said(pdf.page)
  }
  return said(page)
}

// Only the user can get past it
const stops = (page: Page) => {
  const word = verdict(page)
  return word === "check" || word === "sign-in"
}

// The fetch, and its outcome handed to owlit. An answer owlit no longer waits for (it gave up on the
// fetch, the paper got its PDF another way, or the PDF was another paper's) needs nothing more.
export async function doWork(item: WorkItem, deps: FetchDeps & { ask: typeof askOwlit; token: string }): Promise<Fetched> {
  const result = await fetchFor(item, deps)
  const route = `/work/${encodeURIComponent(item.id)}`
  try {
    if ("pdf" in result) await deps.ask<PaperAnswer>(`${route}?host=${encodeURIComponent(result.host)}`, { method: "POST", token: deps.token, pdf: result.pdf })
    else await deps.ask(route, { token: deps.token, json: result })
  } catch (error) {
    if (!(error instanceof OwlitError) || ![404, 409, 422].includes(error.status)) throw error
  }
  return result
}
