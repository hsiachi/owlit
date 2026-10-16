import type { ExtensionWait, PdfState, WorkAnswer, WorkEnding, WorkItem } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import type { ExtensionFetcher, ExtensionPaper, Library } from "../library/library.ts"
import { siteOf } from "./route.ts"

// The papers owlit hands to its browser extension once its own routes found no copy, and the pace it
// asks for them at. owlit decides what and when: per site (the publisher's registrable domain, or the
// library proxy's host) one fetch at a time, the next a while after the last ended, so no publisher sees
// a burst from the user's browser. A fetch that stopped where only the user can get through (a check, a
// sign-in, the extension not allowed there) pauses its site, not the others, and every paper queued
// there waits for the one time the user gets through (or for one of the site's occasional tries to).
//
// In memory only: when the extension connects (its first GET /work since owlit started, since it was
// last away, or since another workspace opened), the library hands over every paper waiting for it again
// (WorkHost.connected), and a fetch that was in flight then is simply asked for again.

// Between two fetches at one site, from the end of the last. Through the proxy, longer: a campus shares
// one proxy, and it limits how often a reader may ask (Tsinghua's tlink's minute-limit page).
export const GAP_MS = 15_000
export const PROXY_GAP_MS = 30_000
// A fetch the extension never answered (the browser closed, the service worker was stopped mid-fetch) is
// asked for again after this. It must exceed the extension's slowest answer, or a fetch still going is
// handed out twice: up to three gets (the PDF's address, the page, the PDF it names) of FETCH_MS (60 s)
// each in apps/extension/src/lib/work.ts, then the upload of the PDF
export const IN_FLIGHT_MS = 5 * 60_000
// The extension counts as connected while it asked for work this recently; it asks again as soon as a
// hold of GET /work ends
export const CONNECTED_MS = 60_000
// After a fetch at a site reached nothing (the network dropped, the proxy's minute-limit page), the site
// waits this long before its next, longer each time in a row: the paper keeps its place, since nothing
// was learnt about it, and a limit that counts every request isn't asked again within the minute
// A site paused for the user tries its first paper again this long after the pause began: the user may
// have got through where the extension couldn't tell (signing in can end on a page that still looks like
// a sign-in, the proxy's own front page), and nothing else would let the site go on
export const PAUSED_RETRY_MS = 15 * 60_000
export const OFFLINE_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000]

export interface WorkOptions {
  gapMs?: number
  proxyGapMs?: number
  inFlightMs?: number
}

interface Queued {
  paper: ExtensionPaper
  // The user pressed Find PDF or Look again on it in this session
  askedFor: boolean
}

interface Paused {
  kind: ExtensionWait["kind"]
  // What the user's browser opens for it
  url: string
  // When the newest try met it, for the next try (PAUSED_RETRY_MS)
  at: number
}

interface Site {
  key: string
  proxied: boolean
  queue: Queued[]
  inFlight?: { id: string; item: Queued; at: number }
  // When its last fetch ended, for the gap before the next
  endedAt?: number
  paused?: Paused
  // Its fetches reached nothing this many times in a row; none goes out before until
  offline?: { times: number; until: number }
}

const PAUSES: Partial<Record<WorkEnding, ExtensionWait["kind"]>> = { check: "check", "sign-in": "sign-in", "no-permission": "permission" }

export interface WorkHost {
  // These papers' standing changed (queued, paused, left the queue): the window hears them again
  papers: (library: Library, ids: string[]) => void
  // The sites paused for the user changed
  waits: () => void
  // An extension began asking for work for this library, with nothing of it queued yet or not for a
  // while: the library hands over what waits for the extension
  connected: (library: Library) => void
}

export class ExtensionWork implements ExtensionFetcher {
  private readonly host: WorkHost
  private readonly options: Required<WorkOptions>
  // The workspace's library the queue belongs to; another workspace opening starts it afresh
  private library: Library | null = null
  private readonly sites = new Map<string, Site>()
  // When the last fetch ended at a site whose queue has since emptied: a paper arriving there after it
  // still waits for the gap, so papers that come one at a time (an import's lookups finishing seconds
  // apart) aren't fetched in a burst
  private readonly lastEnded = new Map<string, number>()
  // A work item's id → its site
  private readonly items = new Map<string, string>()
  private polledAt = Number.NEGATIVE_INFINITY
  private readonly waiters = new Set<() => void>()

  constructor(host: WorkHost, options: WorkOptions = {}) {
    this.host = host
    this.options = { gapMs: options.gapMs ?? GAP_MS, proxyGapMs: options.proxyGapMs ?? PROXY_GAP_MS, inFlightMs: options.inFlightMs ?? IN_FLIGHT_MS }
  }

  connected() {
    return Date.now() - this.polledAt < CONNECTED_MS
  }

  // A paper for the extension to fetch. One already queued keeps its place, and is marked as asked for
  // when the user asked now; asked for, it goes before the ones that weren't, and a site paused for the
  // user is tried once more, since the user may have got through already.
  fetch(library: Library, paper: ExtensionPaper, askedFor: boolean) {
    this.own(library)
    // A paper whose publisher (or proxy) changed since it was queued moves to that site
    for (const site of this.sites.values()) {
      if (site.key === paper.host) continue
      const at = site.queue.findIndex((q) => q.paper.paperId === paper.paperId)
      if (at >= 0) site.queue.splice(at, 1)
    }
    let site = this.sites.get(paper.host)
    if (!site) {
      site = { key: paper.host, proxied: paper.proxied, queue: [], endedAt: this.lastEnded.get(paper.host) }
      this.sites.set(paper.host, site)
    }
    site.proxied = paper.proxied
    if (site.inFlight?.item.paper.paperId === paper.paperId) site.inFlight.item.askedFor ||= askedFor
    else {
      const queued = site.queue.find((q) => q.paper.paperId === paper.paperId)
      if (queued) {
        queued.paper = paper
        queued.askedFor ||= askedFor
      } else site.queue.push({ paper, askedFor })
      sortQueue(site)
    }
    const unpaused = askedFor && !!site.paused
    if (unpaused) site.paused = undefined
    this.host.papers(library, unpaused ? ids(site) : [paper.paperId])
    this.host.waits()
    this.kick()
  }

  // Where the paper stands with the extension, while it has it
  holding(library: Library, id: string): PdfState["extension"] | undefined {
    if (library !== this.library) return undefined
    for (const site of this.sites.values()) {
      const proxied = site.proxied ? { proxied: true } : {}
      if (site.inFlight?.item.paper.paperId === id) return { host: site.key, fetching: true, ...proxied }
      if (site.queue.some((q) => q.paper.paperId === id)) return site.paused ? { host: site.key, waits: site.paused.kind, ...proxied } : { host: site.key, ...proxied }
    }
    return undefined
  }

  // GET /work: the papers due now, held for up to holdMs while none is. Each one is in flight until its
  // answer comes (settle) or IN_FLIGHT_MS pass.
  async take(library: Library | null, holdMs: number, closed: AbortSignal): Promise<WorkItem[]> {
    // Away for longer than counts as connected, or never here: papers the plain routes missed meanwhile
    // went to no queue, and after a restart this one is empty, so the library fills it before anything
    // is due. Marked connected first, so what the library hands over is queued, not left with no PDF.
    const arrived = !this.connected() || library !== this.library
    this.polledAt = Date.now()
    if (library !== this.library) this.own(library)
    if (arrived && library) this.host.connected(library)
    const until = Date.now() + holdMs
    for (;;) {
      const due = this.due()
      const left = until - Date.now()
      if (due.length || left <= 0 || closed.aborted) {
        this.polledAt = Date.now()
        return due
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          this.waiters.delete(done)
          closed.removeEventListener("abort", done)
          resolve()
        }
        const timer = setTimeout(done, Math.min(left, this.nextDueIn()))
        this.waiters.add(done)
        closed.addEventListener("abort", done, { once: true })
      })
    }
  }

  // The work item an answer is for: its paper, or undefined when owlit doesn't know it (an answer from
  // before a restart or a workspace switch, or one that came too late)
  paperOf(id: string): { library: Library; paper: ExtensionPaper } | undefined {
    const site = this.sites.get(this.items.get(id) ?? "")
    return site?.inFlight?.id === id && this.library ? { library: this.library, paper: site.inFlight.item.paper } : undefined
  }

  // The extension's answer, once core has noted it: a PDF (ended undefined) or a word. A word that only
  // the user can get past pauses the site, its paper first in line for when they have.
  settle(id: string, ended: WorkEnding | undefined, page: { url?: string } = {}) {
    const key = this.items.get(id)
    const site = key ? this.sites.get(key) : undefined
    if (!site?.inFlight || site.inFlight.id !== id || !this.library) return
    this.items.delete(id)
    const { item } = site.inFlight
    site.inFlight = undefined
    site.endedAt = Date.now()
    const pause = ended && PAUSES[ended]
    if (ended === "offline" && site.paused) {
      // Its try reached nothing: it waits for the user as it did
      site.paused.at = site.endedAt
      site.queue.unshift(item)
      sortQueue(site)
    } else if (ended === "offline") {
      const times = (site.offline?.times ?? 0) + 1
      site.offline = { times, until: site.endedAt + OFFLINE_BACKOFF_MS[Math.min(times, OFFLINE_BACKOFF_MS.length) - 1] }
      site.queue.unshift(item)
      sortQueue(site)
      this.host.papers(this.library, [item.paper.paperId])
    } else if (pause) {
      site.offline = undefined
      site.queue.unshift(item)
      sortQueue(site)
      const url = (pause === "sign-in" && item.paper.signIn) || page.url || item.paper.url
      site.paused = { kind: pause, url, at: site.endedAt }
      this.host.papers(this.library, ids(site))
      this.host.waits()
    } else if (site.paused) {
      // A try at the paused site got through: the user did, somewhere the extension didn't see
      site.offline = undefined
      site.paused = undefined
      this.host.papers(this.library, [item.paper.paperId, ...ids(site)])
      this.host.waits()
    } else {
      site.offline = undefined
      if (!site.queue.length) {
        this.sites.delete(site.key)
        this.lastEnded.set(site.key, site.endedAt)
      }
      this.host.papers(this.library, [item.paper.paperId])
    }
    this.kick()
  }

  // POST /work/resume: the user got through at this host. Every site paused there (by its own host, or
  // under the same registrable domain) goes on at once, the papers the user asked for first.
  resume(host: string): boolean {
    const wanted = siteOf(host)
    let any = false
    for (const site of this.sites.values()) {
      if (!site.paused || (site.key !== host && siteOf(site.key) !== wanted)) continue
      site.paused = undefined
      site.endedAt = undefined
      sortQueue(site)
      any = true
      if (this.library) this.host.papers(this.library, ids(site))
    }
    if (any) {
      this.host.waits()
      this.kick()
    }
    return any
  }

  // A paper that no longer wants fetching (its PDF was placed another way, it went to the trash or was
  // folded into another): out of its queue, and out of the count of the line it waited in. One in flight
  // is left to its answer, which finds the paper gone or with its PDF.
  drop(library: Library, id: string) {
    if (library !== this.library) return
    let waitsChanged = false
    for (const site of [...this.sites.values()]) {
      const at = site.queue.findIndex((q) => q.paper.paperId === id)
      if (at < 0) continue
      site.queue.splice(at, 1)
      if (site.paused) waitsChanged = true
      if (!site.queue.length && !site.inFlight) {
        this.sites.delete(site.key)
        if (site.endedAt !== undefined) this.lastEnded.set(site.key, site.endedAt)
      }
    }
    if (waitsChanged) this.host.waits()
  }

  // The sites paused for the user, as the window shows them; a paper out for a try still waits there
  waits(): ExtensionWait[] {
    return [...this.sites.values()].flatMap((site) => {
      const waiting = paused(site)
      return site.paused && waiting.length ? [{ kind: site.paused.kind, host: site.key, papers: waiting.length, url: site.paused.url, askedFor: waiting.some((q) => q.askedFor), proxied: site.proxied }] : []
    })
  }

  // The same for the extension, which watches those sites for the user getting through
  waitsForExtension(): WorkAnswer["waits"] {
    return [...this.sites.values()].flatMap((site) => (site.paused && paused(site).length ? [{ kind: site.paused.kind, host: site.key, papers: paused(site).length, proxied: site.proxied }] : []))
  }

  dispose() {
    for (const waiter of [...this.waiters]) waiter()
  }

  private own(library: Library | null) {
    if (library === this.library) return
    this.library = library
    this.sites.clear()
    this.lastEnded.clear()
    this.items.clear()
    this.host.waits()
  }

  private gap(site: Site) {
    return site.proxied ? this.options.proxyGapMs : this.options.gapMs
  }

  // When the site's next fetch may go out: after the gap, after an offline back-off, and while it is
  // paused for the user, only for its next try
  private dueAt(site: Site) {
    return Math.max(site.endedAt === undefined ? 0 : site.endedAt + this.gap(site), site.offline?.until ?? 0, site.paused ? site.paused.at + PAUSED_RETRY_MS : 0)
  }

  private due(): WorkItem[] {
    const now = Date.now()
    const out: WorkItem[] = []
    for (const site of this.sites.values()) {
      if (site.inFlight && now - site.inFlight.at >= this.options.inFlightMs) {
        this.items.delete(site.inFlight.id)
        site.queue.unshift(site.inFlight.item)
        site.inFlight = undefined
        site.endedAt = now
      }
      if (site.inFlight || !site.queue.length) continue
      if (now < this.dueAt(site)) continue
      const item = site.queue.shift()!
      const id = randomUUID()
      site.inFlight = { id, item, at: now }
      this.items.set(id, site.key)
      const { paperId, url, pdfUrl, host, proxied } = item.paper
      out.push({ id, paperId, url, ...(pdfUrl ? { pdfUrl } : {}), host, proxied })
    }
    return out
  }

  // How long until the next site is due, or an unanswered fetch is given up on
  private nextDueIn() {
    const now = Date.now()
    let next = Number.POSITIVE_INFINITY
    for (const site of this.sites.values()) {
      if (site.inFlight) next = Math.min(next, site.inFlight.at + this.options.inFlightMs - now)
      else if (site.queue.length) next = Math.min(next, this.dueAt(site) - now)
    }
    return Math.max(0, next)
  }

  private kick() {
    for (const waiter of [...this.waiters]) waiter()
  }
}

const ids = (site: Site) => site.queue.map((q) => q.paper.paperId)

// What waits at a site, the paper out for a try included
const paused = (site: Site) => (site.inFlight ? [site.inFlight.item, ...site.queue] : site.queue)

// The papers the user asked for first, each group in the order it came
const sortQueue = (site: Site) => {
  site.queue = [...site.queue.filter((q) => q.askedFor), ...site.queue.filter((q) => !q.askedFor)]
}
