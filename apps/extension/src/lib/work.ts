import { LEGACY_WORK_ENDINGS, type PaperAnswer, type WorkEnded, type WorkEnding, type WorkItem } from "@owlit/protocol"
import { inTabItem } from "./from-tab.ts"
import { OwlitError, type ask as askOwlit } from "./owlit.ts"
import { paperOfPage, pdfLinkIn } from "./page.ts"
import { isCheck, isSignInAddress, isSsoHopAddress, refreshOf, refusesPdf, siteOf, titleOf, verdict, type Page } from "./verdict.ts"

// Fetching a paper owlit asked for (GET /work), with the user's cookies: its PDF, or one word for what
// came instead (verdict.ts). Nothing else is fetched, and what goes back to owlit is the PDF, or the word,
// the host, the page's title and where it ended; never the page's text. Pure but for what it is given,
// so a test runs it on a stubbed fetch.

// Each fetch gives up after this, reading the body included, and counts as offline: a slow network, which
// owlit backs off from and tries again, not a finding that the site has no copy. Chrome stops a service worker whose fetch takes
// longer than 30 s to start answering, so a fetch that slow ends when the worker does; owlit asks for it
// again once the restarted worker asks for work.
export const FETCH_MS = 60_000
// A page larger than this isn't read further: what the words are judged by is near its top
const PAGE_MAX_CHARS = 2_000_000
// Redirects followed by hand (get, below) before giving up on an address that keeps sending on
const MAX_HOPS = 5

export interface FetchDeps {
  fetch: typeof fetch
  // The extension may read this address's site (its host permissions, chrome.permissions.contains)
  permitted: (url: string) => Promise<boolean>
  timeoutMs?: number
  // A fetch made from inside a tab the user has open at this host's site, past its check, and where the
  // tab is: a firewall rule may refuse the extension's own requests (their Origin and Sec-Fetch-* say
  // extension) and let the site's pages through. undefined when no such tab is open.
  inTab?: (host: string) => Promise<{ fetch: typeof fetch; url: string } | undefined>
  // Where the browser last sent a fetch of this address on to (the background's webRequest listener):
  // fetch itself hides an opaque redirect's target. undefined when no redirect of it was seen, or in a
  // browser whose webRequest doesn't report the extension's own requests.
  redirectedTo?: (url: string) => string | undefined
  // owlit still waits for this item's answer (GET /work/:id): asked before each fetch made for it in a
  // tab, which may be minutes after it was handed out. undefined: always.
  wanted?: () => Promise<boolean>
}

export type Fetched = { pdf: ArrayBuffer; host: string; url: string } | WorkEnded

// redirected: a redirect led to a site the extension may not read; to: where, when the browser told.
// offline, timeout: at: the address that didn't answer, as near as the browser tells (unreached)
type Got = { kind: "pdf"; bytes: ArrayBuffer; url: string } | { kind: "page"; page: Page } | { kind: "redirected"; to?: string } | { kind: "offline"; at: string } | { kind: "timeout"; at: string }

// A paper as owlit hands it: an owlit of 0.2.x names no lane or gate
export type HandedItem = Omit<WorkItem, "lane" | "gate"> & Partial<Pick<WorkItem, "lane" | "gate">>

// The item with its lane and gate, which everything past GET /work takes as given. An owlit of 0.2.x says
// the same in host and proxied: the proxy's host, else the publisher's registrable domain.
export function asItem(item: HandedItem): WorkItem {
  const gate = item.gate ?? item.lane ?? (item.proxied ? (`proxy:${item.host}` as const) : (`site:${siteOf(item.host)}` as const))
  return { ...item, gate, lane: item.lane ?? gate }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

// The address a fetch of url got no answer from: past the redirects the browser saw it sent on by (a
// proxy that answered and sent the browser on to a publisher that doesn't), else url itself. owlit
// backs off from the publisher alone when it is the publisher that is down, and from every paper
// through the proxy when the proxy is. Redirects are kept by address, newest last, so a proxy's link
// is taken to lead where it led last.
function unreached(url: string, deps: FetchDeps): string {
  let at = url
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = deps.redirectedTo?.(at)
    if (!next) break
    at = next
  }
  return at
}

// What an unanswered fetch tells owlit: offline, at the host that didn't answer
const offlineAt = (got: { at: string }): WorkEnded => ({ ended: "offline", host: hostOf(got.at) })

async function get(url: string, deps: FetchDeps, proxy: Page["proxy"]): Promise<Got> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_MS)
  try {
    let response: Response
    try {
      // no-store: after the user passed a check, the browser's cache still holds the challenge page it
      // answered before, byte for byte, and hands it back for the same address
      response = await deps.fetch(url, { credentials: "include", cache: "no-store", redirect: "follow", signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw error
      // A followed redirect to a site the extension may not read (a school's sign-in, a publisher reached
      // from another host) fails as a network failure does. Asked again without following, it comes
      // back as an opaque redirect, whose target the browser doesn't show; a network failure fails again.
      response = await deps.fetch(url, { credentials: "include", cache: "no-store", redirect: "manual", signal: controller.signal })
      if (response.type === "opaqueredirect") {
        const to = deps.redirectedTo?.(url)
        return to ? { kind: "redirected", to } : { kind: "redirected" }
      }
    }
    const bytes = await response.arrayBuffer()
    // By its first bytes, or its type with the mark a little further in (some servers send a line first).
    // What goes to owlit starts at the mark: owlit takes a body as a PDF only when it begins with it.
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024))
    const typed = /^application\/(x-)?pdf\b/i.test(response.headers.get("content-type") ?? "")
    const mark = head.indexOf("%PDF-")
    if (mark === 0 || (typed && mark > 0)) return { kind: "pdf", bytes: mark ? bytes.slice(mark) : bytes, url: response.url || url }
    const html = new TextDecoder().decode(bytes.slice(0, PAGE_MAX_CHARS))
    return { kind: "page", page: { url: response.url || url, status: response.status, html, proxy, headers: response.headers } }
  } catch {
    // No answer at all: the network, or the site, is down; aborted, it was too slow
    const at = unreached(url, deps)
    return controller.signal.aborted ? { kind: "timeout", at } : { kind: "offline", at }
  } finally {
    clearTimeout(timer)
  }
}

// A fetch that goes on by hand where a redirect left for a site the extension may read after all: a
// followed fetch fails as soon as any hop in the chain is a site it may not read (doi.org on to a
// publisher's page on to its sign-in), so each readable hop is fetched anew, until one answers or one
// may not be read. A page's meta refresh is a hop too (Elsevier's linkinghub on to ScienceDirect), since
// the extension never runs the page's scripts; one to a site it may not read is a redirect there.
async function follow(url: string, deps: FetchDeps, proxy: Page["proxy"]): Promise<Got> {
  let got = await get(url, deps, proxy)
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const to = got.kind === "redirected" ? got.to : got.kind === "page" ? refreshOf(got.page) : undefined
    if (!to) break
    if (!(await deps.permitted(to))) return got.kind === "page" ? { kind: "redirected", to } : got
    got = await get(to, deps, proxy)
  }
  return got
}

// What a page that came instead says, as owlit hears it
export const said = (page: Page): WorkEnded => {
  const title = titleOf(page.html)
  return { ended: verdict(page), host: hostOf(page.url), ...(title ? { title: title.slice(0, 300) } : {}), url: page.url }
}

// The PDF's own address first, when owlit knows it; then the article page, and the PDF it names. A
// check or a block in the way is tried once more from a tab of that site the user got past it in (a
// firewall rule may refuse the extension's own requests and let the site's pages through), with the
// paper's addresses moved to where that tab is (from-tab.ts).
export async function fetchFor(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  const got = await fetchWith(item, deps)
  if ("pdf" in got || (got.ended !== "check" && got.ended !== "blocked") || !deps.inTab) return got
  const tab = await deps.inTab(got.host)
  return tab ? fetchWith(inTabItem(item, tab.url), { ...deps, fetch: tab.fetch, inTab: undefined }) : got
}

async function fetchWith(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  if (!(await deps.permitted(item.url))) return { ended: "no-permission", host: item.host }
  const proxy = item.proxied ? { host: hostOf(item.url), entry: item.url } : undefined
  // Where a redirect left for a site the extension may not read, and the browser said which: that site,
  // for the user to let the extension read (the publisher's, reached through the proxy or doi.org).
  // Unless it is the school's sign-in, which a signed-out proxy sends every fetch to: a site under the
  // proxy's own domain (id.tsinghua.edu.cn beside tlink), or an address that says sign in. A step of a
  // publisher's sign-in is neither: a tab walks it by itself, so it ends as a check, with no url, since
  // the address of a step is good only once and the paper's own is the one to open.
  const unreadable = (got: { to?: string }): WorkEnded | undefined => {
    if (!got.to) return undefined
    const host = hostOf(got.to)
    if (isSsoHopAddress(got.to)) return { ended: "check", host }
    if (!host || (proxy && siteOf(host) === siteOf(proxy.host)) || isSignInAddress(got.to)) return undefined
    return { ended: "no-permission", host }
  }
  // The same when the browser didn't say where: through the proxy, its sign-in. Otherwise unreadable:
  // where the paper is, and whether there is a copy, is unknown. Never a site to allow: the site asked
  // is one the extension reads already, so it would name one already allowed, which resumes at once
  // and pauses again on the same redirect.
  const away: WorkEnded = item.proxied ? { ended: "sign-in", host: hostOf(item.url) } : { ended: "unreadable", host: item.host }
  const tried = new Set<string>()
  let refused = false
  if (item.pdfUrl && (await deps.permitted(item.pdfUrl))) {
    tried.add(item.pdfUrl)
    const got = await follow(item.pdfUrl, deps, proxy)
    if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
    // A check, a block or a sign-in in front of the PDF is in front of the page too
    if (got.kind === "page" && stops(got.page)) return said(got.page)
    refused = got.kind === "page" && refusesPdf(got.page)
    if (got.kind === "redirected") {
      const site = unreadable(got)
      if (site || item.proxied) return site ?? away
    }
    if (got.kind === "timeout") return offlineAt(got)
  }
  const got = await follow(item.url, deps, proxy)
  if (got.kind === "pdf") return { pdf: got.bytes, host: hostOf(got.url), url: got.url }
  if (got.kind === "redirected") return unreadable(got) ?? away
  if (got.kind === "offline" || got.kind === "timeout") return offlineAt(got)
  const { page } = got
  const named = paperOfPage(page.html, page.url)?.pdfUrl ?? pdfLinkIn(page.html, page.url)
  if (named && !tried.has(named) && !isCheck(page) && (await deps.permitted(named))) {
    const pdf = await follow(named, deps, proxy)
    if (pdf.kind === "pdf") return { pdf: pdf.bytes, host: hostOf(pdf.url), url: pdf.url }
    if (pdf.kind === "page" && stops(pdf.page)) return said(pdf.page)
    if (pdf.kind === "redirected") return unreadable(pdf) ?? away
    if (pdf.kind === "timeout") return offlineAt(pdf)
    refused ||= pdf.kind === "page" && refusesPdf(pdf.page)
  }
  const ending = said(page)
  // The paper's page names a PDF, so alone it says nothing sure; the PDF's own answer does
  return refused && ending.ended === "unreadable" ? { ...ending, ended: "no-access" } : ending
}

// Only the user can get past it
const stops = (page: Page) => {
  const word = verdict(page)
  return word === "check" || word === "blocked" || word === "sign-in"
}

// The fetch, and its outcome handed to owlit
export async function doWork(item: WorkItem, deps: FetchDeps & ReportDeps): Promise<Fetched> {
  return report(item, await fetchFor(item, deps), deps)
}

export interface ReportDeps {
  ask: typeof askOwlit
  token: string
  // The endings this owlit takes (WorkAnswer.endings); undefined for one that names none
  endings?: readonly WorkEnding[]
}

// For an owlit that doesn't know a word yet, the one it knows that says the most of the same: an
// unreadable page was told as no copy before it had a word of its own
const NEAREST: Partial<Record<WorkEnding, WorkEnding>> = { unreadable: "no-copy" }

// The ending as this owlit can take it: an older one refuses a word it doesn't know (400), and an
// answer refused leaves the paper in flight there, handed out again and again
export function sayable(result: WorkEnded, endings: readonly WorkEnding[] | undefined): WorkEnded {
  const known = endings ?? LEGACY_WORK_ENDINGS
  if (known.includes(result.ended)) return result
  const near = NEAREST[result.ended]
  return { ...result, ended: near && known.includes(near) ? near : "no-copy" }
}

// How a fetch of owlit's item ended, told to owlit under the item's own id. An answer owlit no longer
// waits for (it names no paper owlit knows, the paper got its PDF another way, or the PDF was another
// paper's) needs nothing more.
export async function report(item: WorkItem, result: Fetched, deps: ReportDeps): Promise<Fetched> {
  const route = `/work/${encodeURIComponent(item.id)}`
  const settled = (error: unknown) => error instanceof OwlitError && [404, 409, 422].includes(error.status)
  try {
    if ("pdf" in result) await deps.ask<PaperAnswer>(`${route}?host=${encodeURIComponent(result.host)}`, { method: "POST", token: deps.token, pdf: result.pdf })
    else {
      const json = sayable(result, deps.endings)
      try {
        await deps.ask(route, { token: deps.token, json })
      } catch (error) {
        // An owlit that says nothing of its endings may still not know this one: told once more as the
        // word every owlit knows, so the paper settles there
        if (!(error instanceof OwlitError) || error.status !== 400 || json.ended === "no-copy") throw error
        await deps.ask(route, { token: deps.token, json: { ...json, ended: "no-copy" } })
      }
    }
  } catch (error) {
    if (!settled(error)) throw error
  }
  return result
}
