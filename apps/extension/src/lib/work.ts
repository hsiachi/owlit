import type { PaperAnswer, WorkEnded, WorkItem } from "@owlit/protocol"
import { OwlitError, type ask as askOwlit } from "./owlit.ts"
import { paperOfPage, pdfLinkIn } from "./page.ts"
import { isCheck, titleOf, verdict, type Page } from "./verdict.ts"

// Fetching a paper owlit asked for (GET /work), with the user's cookies: its PDF, or one word for what
// came instead (verdict.ts). Nothing else is fetched, and what goes back to owlit is the PDF, or the word,
// the host, the page's title and where it ended; never the page's text. Pure but for what it is given,
// so a test runs it on a stubbed fetch.

// Each fetch gives up after this, reading the body included, and counts as offline: a slow network, which
// owlit backs off from and tries again, not a finding that the site has no copy. Chrome stops a service worker whose fetch takes
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
  // A fetch made from inside an open tab of this host that is past its check. A passed check stays with
  // the page that passed it: Cloudflare turns away the extension's own fetch to ACM with a 403 while the
  // ACM article open in a tab fetches the same PDF. undefined when no such tab is open.
  inTab?: (host: string) => Promise<typeof fetch | undefined>
}

export type Fetched = { pdf: ArrayBuffer; host: string; url: string } | WorkEnded

// redirected: a redirect led to a site the extension may not read
type Got = { kind: "pdf"; bytes: ArrayBuffer; url: string } | { kind: "page"; page: Page } | { kind: "redirected" } | { kind: "offline" } | { kind: "timeout" }

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
    let response: Response
    try {
      response = await deps.fetch(url, { credentials: "include", redirect: "follow", signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw error
      // A followed redirect to a site the extension may not read (a school's sign-in, a publisher reached
      // from another host) fails as a network failure does. Asked again without following, it comes
      // back as an opaque redirect, whose target the browser doesn't show; a network failure fails again.
      response = await deps.fetch(url, { credentials: "include", redirect: "manual", signal: controller.signal })
      if (response.type === "opaqueredirect") return { kind: "redirected" }
    }
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

// The PDF's own address first, when owlit knows it; then the article page, and the PDF it names. A
// check in the way is tried once more from a tab of that site the user got past it in.
export async function fetchFor(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  const got = await fetchWith(item, deps)
  if ("pdf" in got || got.ended !== "check" || !deps.inTab) return got
  const tabFetch = await deps.inTab(got.host)
  return tabFetch ? fetchWith(item, { ...deps, fetch: tabFetch, inTab: undefined }) : got
}

async function fetchWith(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  if (!(await deps.permitted(item.url))) return { ended: "no-permission", host: item.host }
  const proxy = item.proxied ? { host: hostOf(item.url), entry: item.url } : undefined
  // Where a redirect left for a site the extension may not read: through the proxy, its sign-in (a
  // signed-out proxy sends every fetch to the school's). Otherwise no copy: the browser doesn't show the
  // redirect's target, and the site asked is one the extension reads already, so a site to allow would
  // name one already allowed, which resumes at once and pauses again on the same redirect.
  // no-permission is said only above, for an address the extension may not read before it is fetched.
  const away: WorkEnded = item.proxied ? { ended: "sign-in", host: hostOf(item.url) } : { ended: "no-copy", host: item.host }
  const tried = new Set<string>()
  if (item.pdfUrl && (await deps.permitted(item.pdfUrl))) {
    tried.add(item.pdfUrl)
    const got = await get(item.pdfUrl, deps, proxy)
    if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
    // A check or a sign-in in front of the PDF is in front of the page too
    if (got.kind === "page" && stops(got.page)) return said(got.page)
    if (got.kind === "redirected" && item.proxied) return away
    if (got.kind === "timeout") return { ended: "offline", host: hostOf(item.pdfUrl) }
  }
  const got = await get(item.url, deps, proxy)
  if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
  if (got.kind === "redirected") return away
  if (got.kind === "offline" || got.kind === "timeout") return { ended: "offline", host: hostOf(item.url) }
  const { page } = got
  const named = paperOfPage(page.html, page.url)?.pdfUrl ?? pdfLinkIn(page.html, page.url)
  if (named && !tried.has(named) && !isCheck(page) && (await deps.permitted(named))) {
    const pdf = await get(named, deps, proxy)
    if (pdf.kind === "pdf") return { pdf: pdf.bytes, host: hostOf(pdf.url), url: pdf.url }
    if (pdf.kind === "page" && stops(pdf.page)) return said(pdf.page)
    if (pdf.kind === "redirected") return away
    if (pdf.kind === "timeout") return { ended: "offline", host: hostOf(named) }
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
